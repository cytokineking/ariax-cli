"""A native ensemble lost entirely must fail the packaged affinity entrypoint."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class AffinityEnsembleTests(unittest.TestCase):
    def test_wholly_missing_native_ensemble_is_rejected(self):
        script = Path(__file__).resolve().parents[2] / "scripts/boltz2-affinity-check.py"
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "affinity_case.json"
            output.write_text(json.dumps({"affinity_pred_value": -3, "affinity_probability_binary": 0.8}))
            result = subprocess.run([sys.executable, str(script), str(output), "--record-id", "case"],
                                    capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(result.stdout)
        self.assertIn("affinity_pred_value1", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
