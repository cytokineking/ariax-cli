# Native RF3 input and export examples

The three `*-dimer.json` files explicitly request the same two 33-residue protein
chains from the three accepted Foundry RF3 checkpoint choices. These are model
inputs; the input JSON itself supplies no confidence or acceptance evidence.

`rf3-export-request.json` shows the matched seed-7/sample-0 native output paths.
Set the request's model and filenames to the chosen checkpoint's actual sample.
Stage every declared raw file and the request before executing the exporter:

```sh
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- python /opt/interface-scores/native_handoff.py /inputs/native/rf3-export-request.json --output /workspace/interface-scores/rf3-handoff.json
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores /workspace/interface-scores/rf3-handoff.json --output /workspace/interface-scores/rf3-result.json
```

Require the returned exporter command to succeed before submitting the scorer.
Predictor execution belongs to the selected RF3 tool and explicit checkpoint;
the CPU scorer imports files and never launches or resumes that prediction.
Preserve actual supported predictor provenance and matched native files.
