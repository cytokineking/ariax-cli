"""Observe native Boltz URL routing and explicit MSA rejection on a remote VM.

The local error endpoint substitutes only the unavailable external service.
Native Boltz code and its CLI entry point remain unchanged. Saved checks never
repeat the native command. Use the existing public ubiquitin fixture only.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlsplit

import yaml


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")


def observed_native(argv: list[str]) -> None:
    """Observe actual network calls and reject any non-loopback fallback attempt."""
    trace = os.open(os.environ.pop("B33_ENDPOINT_TRACE"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)

    def audit(event: str, args: tuple) -> None:
        if event == "socket.getaddrinfo":
            host, port = args[:2]
        elif event == "socket.connect" and args[0].family in (socket.AF_INET, socket.AF_INET6):
            host, port = args[1][:2]
        else:
            return
        local = host in ("127.0.0.1", "::1", "localhost")
        os.write(trace, (json.dumps({"event": event, "host": str(host), "port": port, "loopback": local}) + "\n").encode())
        if not local:
            raise PermissionError("B33 observed a forbidden external network attempt")

    sys.addaudithook(audit)
    entry = shutil.which(argv[0])
    if not entry:
        raise RuntimeError("Installed native Boltz entry point missing")
    sys.argv = argv
    runpy.run_path(entry, run_name="__main__")


def check(input_path: Path, out: Path) -> dict:
    record = json.loads((out / "endpoint-check.json").read_text())
    requests = json.loads((out / "endpoint-requests.json").read_text())["requests"]
    trace = [json.loads(line) for line in (out / "native-network.jsonl").read_text().splitlines()]
    target = yaml.safe_load(input_path.read_text())
    proteins = [row["protein"]["sequence"] for row in target["sequences"] if "protein" in row]
    endpoint = urlsplit(record["selected_endpoint"])
    expected_path = endpoint.path + "/ticket/msa"
    observed_sequences = []
    for request in requests:
        form = request["form"]
        query = form.get("q", [""])[0]
        observed_sequences.append([line for line in query.splitlines() if line and not line.startswith(">")])
        if request["method"] != "POST" or request["path"] != expected_path or form.get("mode") != ["env"]:
            raise ValueError("Native request did not reach the selected endpoint/path/mode")
    if not requests or any(sequences != proteins for sequences in observed_sequences):
        raise ValueError("Actual native query differs from the public fixture")
    if not trace or any(not item["loopback"] for item in trace):
        raise ValueError("Observed an external fallback attempt or no native network activity")
    if not any(item["event"] == "socket.connect" and item["port"] == endpoint.port for item in trace):
        raise ValueError("Native client did not connect to the selected endpoint")
    logs = (out / "native.stdout.log").read_text() + (out / "native.stderr.log").read_text()
    if "MMseqs2 API is giving errors" not in logs or "Failed to process" not in logs:
        raise ValueError("Native service rejection was not fully observed")
    result = out / ("boltz_results_" + input_path.stem)
    if list(result.glob("predictions/**/*.cif")) or list(result.glob("processed/msa/*.npz")) or list(result.glob("processed/records/*.json")) or list(result.glob("msa/*.csv")):
        raise ValueError("Unusable explicit endpoint produced a processed MSA or prediction")
    if record["state"] != "expected_native_rejection" or record.get("timed_out"):
        raise ValueError("Native command did not complete the expected rejection")
    return {**record, "requests": len(requests), "native_network_events": len(trace),
            "external_fallback_attempts": 0, "processed_msa_and_predictions_absent": True,
            "query_matches_public_fixture": True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("native_argv", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.check_only:
        print(json.dumps(check(args.input, args.out_dir), indent=2))
        return
    argv = args.native_argv[1:] if args.native_argv[:1] == ["--"] else args.native_argv
    if len(argv) < 3 or argv[:3] != ["boltz", "predict", str(args.input)]:
        raise ValueError("Run the installed native Boltz CLI against the selected public fixture")
    if argv[argv.index("--out_dir") + 1] != str(args.out_dir):
        raise ValueError("Native output root differs")
    if argv[argv.index("--msa_server_url") + 1] != "LOCAL_REJECTING_ENDPOINT":
        raise ValueError("Controlled unavailable endpoint placeholder required")
    args.out_dir.mkdir(parents=True, exist_ok=False)
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *values) -> None:
            pass

        def do_POST(self) -> None:
            body = self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode()
            requests.append({"method": "POST", "path": self.path, "form": parse_qs(body)})
            write(args.out_dir / "endpoint-requests.json", {"requests": requests})
            payload = b'{"status":"ERROR"}'
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = "http://127.0.0.1:" + str(server.server_port) + "/selected-unavailable"
    argv[argv.index("--msa_server_url") + 1] = endpoint
    env = {key: value for key, value in os.environ.items()
           if key.lower() not in ("http_proxy", "https_proxy", "all_proxy", "no_proxy")}
    env.update(B33_ENDPOINT_TRACE=str(args.out_dir / "native-network.jsonl"), NO_PROXY="127.0.0.1,::1,localhost")
    record = {"state": "incomplete", "selected_endpoint": endpoint, "native_argv": argv,
              "external_service_boundary": "controlled unavailable loopback endpoint; native CLI unchanged"}
    write(args.out_dir / "endpoint-requests.json", {"requests": []})
    try:
        with (args.out_dir / "native.stdout.log").open("w") as stdout, (args.out_dir / "native.stderr.log").open("w") as stderr:
            result = subprocess.run([sys.executable, __file__, "--native", *argv], env=env,
                                    stdout=stdout, stderr=stderr, timeout=150)
        # Native Boltz catches per-input preprocessing errors, so preserve its
        # real exit code and require the actual rejection plus absent outputs.
        record.update(state="expected_native_rejection", native_exit_code=result.returncode, timed_out=False)
    except subprocess.TimeoutExpired:
        record.update(state="timed_out", timed_out=True)
        raise
    finally:
        write(args.out_dir / "endpoint-check.json", record)
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    report = check(args.input, args.out_dir)
    write(args.out_dir / "endpoint-check.json", report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    if sys.argv[1:2] == ["--native"]:
        observed_native(sys.argv[2:])
    else:
        main()
