#!/usr/bin/env python3
"""Offline integration checks through CLI discovery and packaged helper entrypoints.

Protect against wrong target registers, shape-compatible chain/sample mismatches,
missing native sidecars, and invalid affinity values reaching scientific review.
GPU inference cannot economically exercise these deliberately corrupt handoffs.
No inference is simulated; optional native ipSAE checks use a synthetic complex.
"""
import argparse
import copy
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def execute(argv, success=True):
    result = subprocess.run([str(a) for a in argv], capture_output=True, text=True)
    if success:
        assert result.returncode == 0, result.stderr or result.stdout
    else:
        assert result.returncode != 0, f"invalid input accepted: {argv}"
        assert not result.stdout.strip(), "rejected input printed a success payload"
        assert result.stderr.strip(), "rejection lost its diagnostic"
        assert "Traceback" not in result.stderr, result.stderr
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=ROOT / "bin/ariax.js")
    parser.add_argument("--ipsae-script", type=Path)
    args = parser.parse_args()
    discovery = json.loads(execute(["node", args.cli, "skills", "forge", "--json"]).stdout)["data"]
    examples = Path(discovery["examples"]["science"])
    refs = discovery["references"]
    outcomes = []

    def helper(name, argv, success=True):
        result = execute([sys.executable, refs[name], *argv], success)
        return json.loads(result.stdout) if success else None

    with tempfile.TemporaryDirectory(prefix="forge-science-check-") as temporary:
        temp = Path(temporary)
        fbc = temp / "freebindcraft"
        shutil.copytree(examples / "freebindcraft", fbc)
        target = json.loads((fbc / "target.json").read_text())
        pdb = (fbc / "target.pdb").read_text()

        def fbc_check(name, settings, text=pdb, family="miniprotein", success=False):
            (fbc / "target.json").write_text(json.dumps(settings))
            (fbc / "target.pdb").write_text(text)
            data = helper("freebindcraft-preflight", ["--settings", fbc / "target.json",
                          "--pdb", fbc / "target.pdb", "--family", family], success)
            outcomes.append(name)
            return data

        data = fbc_check("target-author-register", target, success=True)
        assert data["target_residues"] == 3 and data["chains"] == ["A"]
        assert not data["atom_completeness_checked"]
        peptide = {**target, "lengths": [8, 30]}
        fbc_check("linear-peptide-family", peptide, family="peptide", success=True)
        fbc_check("wrong-family", peptide)
        fbc_check("sequence-offset-as-author-hotspot", {**target, "target_hotspot_residues": "A1"})
        fbc_check("hotspot-in-unselected-chain", {**target, "target_hotspot_residues": "B56"})
        fbc_check("missing-selected-chain", {**target, "chains": "B"})
        fbc_check("noninteger-accepted-goal", {**target, "number_of_final_designs": True})
        lines = pdb.splitlines(keepends=True)
        atom = next(i for i, line in enumerate(lines) if line.startswith("ATOM"))
        bad = lines.copy(); bad[atom] = bad[atom][:26] + "A" + bad[atom][27:]
        fbc_check("insertion-code-hotspot", target, "".join(bad))
        bad = lines.copy(); bad[atom] = bad[atom][:30] + "     nan" + bad[atom][38:]
        fbc_check("nonfinite-target-coordinate", target, "".join(bad))
        fbc_check("multiple-target-models", target, "MODEL        1\n" + pdb + "ENDMDL\nMODEL        2\n" + pdb)

        for predictor in ("af3", "boltz2"):
            original = examples / predictor
            d = temp / predictor

            def reset():
                if d.exists(): shutil.rmtree(d)
                shutil.copytree(original, d)
                return json.loads((d / "handoff.json").read_text())

            def handoff(name, change=None, success=False):
                m = reset()
                if change: change(m, d)
                (d / "handoff.json").write_text(json.dumps(m))
                result = helper("ipsae-preflight", [d / "handoff.json"], success)
                outcomes.append(predictor + "-" + name)
                return result

            valid = handoff("matched", success=True)
            assert valid["residues"] == 4 and valid["chain_order"] == ["A", "B"]
            handoff("wrong-sequence", lambda m, _: m["sequences"].update(A="GA"))
            handoff("wrong-register", lambda m, _: m["residues"][0].__setitem__(1, 9))
            sample_field = "rank" if predictor == "boltz2" else "index"
            handoff("wrong-sample", lambda m, _: m["sample"].update({sample_field: 1}))
            handoff("missing-summary", lambda m, d: (d / m["files"]["summary"]).unlink())

            def confidence(change):
                def mutate(m, d):
                    path = d / m["files"]["pae"]
                    data = json.loads(path.read_text())
                    change(data)
                    path.write_text(json.dumps(data))
                return mutate

            def structure(change):
                def mutate(m, d):
                    path = d / m["files"]["structure"]
                    path.write_text(change(path.read_text()))
                return mutate

            handoff("missing-CB", structure(lambda s: "\n".join(line for line in s.splitlines()
                    if not (line.startswith("ATOM") and line.split()[3] == "CB"))))
            if predictor == "af3":
                handoff("boolean-in-numeric-PAE", confidence(lambda data: data["pae"][0].__setitem__(1, True)))
                handoff("token-chain-order", confidence(lambda data: data["token_chain_ids"].reverse()))
                handoff("token-register", confidence(lambda data: data["token_res_ids"].__setitem__(0, 2)))
                handoff("atom-confidence-shape", confidence(lambda data: data["atom_plddts"].pop()))
                handoff("atom-id-order", structure(lambda s: s.replace("ATOM 1 N N", "ATOM 99 N N")))
                handoff("atom-chain-order", confidence(lambda data: data["atom_chain_ids"].__setitem__(0, "B")))
            else:
                handoff("asym-index-map", lambda m, _: m.update(chain_indices={"A": 1, "B": 0}))
                handoff("PAE-shape", lambda m, d: np.savez(d / m["files"]["pae"], pae=np.ones((3, 3))))
                handoff("PAE-nonfinite", lambda m, d: np.savez(d / m["files"]["pae"], pae=np.full((4, 4), np.nan)))
                handoff("pLDDT-scale", lambda m, d: np.savez(d / m["files"]["plddt"], plddt=[80, 80, 80, 80]))
                handoff("missing-pLDDT", lambda m, d: (d / m["files"]["plddt"]).unlink())
                # Native does a global path substitution, including directory names.
                m = reset()
                bad_dir = temp / "has-pae-in-name"
                shutil.copytree(d, bad_dir)
                helper("ipsae-preflight", [bad_dir / "handoff.json"], success=False)
                outcomes.append("boltz2-sidecar-directory-substitution")

            if args.ipsae_script:
                m = reset()
                execute([sys.executable, args.ipsae_script.resolve(), d / m["files"]["pae"],
                         d / m["files"]["structure"], "10", "10"])
                stem = d / "toy_model_0_10_10"
                for suffix in (".txt", "_byres.txt", ".pml"):
                    assert Path(str(stem) + suffix).stat().st_size > 0
                rows = [line.split() for line in Path(str(stem) + ".txt").read_text().splitlines() if line.strip()]
                header, values = rows[0], rows[1:]
                table = {(r[0], r[1], r[4]): dict(zip(header, r)) for r in values}
                assert len(table) == 3
                assert math.isclose(float(table[("A", "B", "asym")]["ipSAE"]), 0.365778, abs_tol=1e-6)
                assert math.isclose(float(table[("B", "A", "asym")]["ipSAE"]), 0.052289, abs_tol=1e-6)
                assert math.isclose(float(table[("A", "B", "max")]["LIS"]), 0.6042, abs_tol=1e-4)
                expected_pair = 0.6 if predictor == "boltz2" else 0.7
                assert math.isclose(float(table[("B", "A", "asym")]["ipTM_af"]), expected_pair)
                byres = [line for line in Path(str(stem) + "_byres.txt").read_text().splitlines() if line.strip()]
                assert len(byres) == 5
                outcomes.append(predictor + "-native-directional-scores")

        # Exercise AF2 with the existing qualified fixture instead of duplicating it.
        af2 = temp / "af2"
        shutil.copytree(Path(discovery["examples"]["ipsae"]), af2)
        m = {"predictor": "af2", "run_id": "synthetic-fixture", "input_id": "synthetic-GG-GG", "seed": "synthetic",
             "sample": {"record_id": "toy", "index": 0}, "pae_units": "angstrom", "plddt_scale": "0-100",
             "files": {"structure": "toy.pdb", "pae": "scores.json"}, "chain_order": ["A", "B"],
             "sequences": {"A": "GG", "B": "GG"},
             "residues": [[c, r, "GLY"] for c in ("A", "B") for r in (1, 2)]}
        (af2 / "handoff.json").write_text(json.dumps(m))
        helper("ipsae-preflight", [af2 / "handoff.json"])
        outcomes.append("af2-qualified-fixture-preflight")

        affinity = temp / "affinity_affinity.json"
        data = json.loads((examples / "affinity/affinity_affinity.json").read_text())
        affinity.write_text(json.dumps(data))
        valid = helper("boltz2-affinity-check", [affinity, "--record-id", "affinity"])
        assert valid["predicted_pIC50"] == 9 and len(valid["ensemble_components"]) == 4
        outcomes.append("affinity-values-and-units")
        helper("boltz2-affinity-check", [affinity, "--record-id", "different-input"], success=False)
        outcomes.append("affinity-input-identity")
        for name, change in [
            ("missing-value", lambda d: d.pop("affinity_pred_value")),
            ("nonfinite-value", lambda d: d.update(affinity_pred_value=float("nan"))),
            ("boolean-probability", lambda d: d.update(affinity_probability_binary=True)),
            ("out-of-range-probability", lambda d: d.update(affinity_probability_binary=1.2)),
            ("incomplete-ensemble", lambda d: d.pop("affinity_pred_value2")),
        ]:
            bad = copy.deepcopy(data); change(bad)
            affinity.write_text(json.dumps(bad))
            helper("boltz2-affinity-check", [affinity, "--record-id", "affinity"], success=False)
            outcomes.append("affinity-" + name)

    print(json.dumps({"passed": len(outcomes), "cases": outcomes,
                      "native_ipsae": bool(args.ipsae_script), "inference_run": False}, indent=2))


if __name__ == "__main__":
    main()
