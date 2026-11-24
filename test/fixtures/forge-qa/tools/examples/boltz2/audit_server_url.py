"""Observe actual native Boltz HTTP traffic for a caller-selected public URL.

Run on the shared authorized GPU host. This wraps the unmodified native console
entry point and Requests send boundary, retaining route families and origins.
Request bodies, headers, ticket IDs and response payloads are not logged.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import runpy
import shutil
import sys
from urllib.parse import parse_qs, urlsplit

import requests


def check(path: Path, origin: str, pairing: str | None) -> dict:
    report = json.loads(path.read_text())
    events = report["events"]
    if any(event["origin"] != origin for event in events):
        raise ValueError("Native HTTP used an alternate origin or ignored the explicit URL")
    completed = [event for event in events if event.get("status_code") == 200]
    required = {("POST", "ticket/msa", "env"), ("GET", "result/download", None)}
    if pairing:
        required.add(("POST", "ticket/pair", "pair" + pairing + "-env"))
    observed = {(event["method"], event["route"], event.get("mode")) for event in completed}
    if not required <= observed or report["native_exit_code"] != 0:
        raise ValueError("Required real native submission/download behavior did not complete")
    return {**report, "required_routes_completed": True, "alternate_origins": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--audit-path", type=Path, required=True)
    parser.add_argument("--pairing", choices=("greedy", "complete"))
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("native_argv", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.origin != "https://api.colabfold.com:443":
        raise ValueError("This qualification uses the selected public service and explicit HTTPS port")
    if args.check_only:
        print(json.dumps(check(args.audit_path, args.origin, args.pairing), indent=2))
        return
    argv = args.native_argv[1:] if args.native_argv[:1] == ["--"] else args.native_argv
    if argv[:2] != ["boltz", "predict"]:
        raise ValueError("Installed native Boltz console entry point required")
    if args.audit_path.exists():
        raise ValueError("Fresh service audit path required")
    args.audit_path.parent.mkdir(parents=True, exist_ok=True)
    report = {"events": [], "native_exit_code": None, "expected_origin": args.origin,
              "scope": "Observed native HTTP; no separate service or authentication qualification"}

    def save() -> None:
        args.audit_path.write_text(json.dumps(report, indent=2) + "\n")

    original_send = requests.sessions.Session.send

    def send(session, request, **kwargs):
        url = urlsplit(request.url)
        origin = url.scheme + "://" + url.netloc
        parts = url.path.strip("/").split("/")
        route = "/".join(parts[:2]) if parts[:2] in (["ticket", "msa"], ["ticket", "pair"], ["result", "download"]) else ("ticket/status" if parts[:1] == ["ticket"] else "unexpected")
        body = request.body.decode() if isinstance(request.body, bytes) else request.body
        mode = parse_qs(body or "").get("mode", [None])[0] if request.method == "POST" else None
        event = {"method": request.method, "origin": origin, "route": route, "mode": mode}
        report["events"].append(event)
        save()
        if origin != args.origin or route == "unexpected":
            raise RuntimeError("Observed unexpected native MSA request origin or route")
        try:
            response = original_send(session, request, **kwargs)
            event["status_code"] = response.status_code
            return response
        except Exception as error:
            event["transport_error"] = type(error).__name__
            raise
        finally:
            save()

    requests.sessions.Session.send = send
    entry = shutil.which(argv[0])
    if not entry:
        raise RuntimeError("Installed native Boltz entry point missing")
    sys.argv = argv
    try:
        runpy.run_path(entry, run_name="__main__")
        report["native_exit_code"] = 0
    except SystemExit as error:
        report["native_exit_code"] = error.code if isinstance(error.code, int) else (0 if error.code is None else 1)
    finally:
        requests.sessions.Session.send = original_send
        save()
    print(json.dumps(check(args.audit_path, args.origin, args.pairing), indent=2))


if __name__ == "__main__":
    main()
