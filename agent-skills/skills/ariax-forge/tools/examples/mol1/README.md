# Mol-1 candidate fixtures

**Two bounded native default cases passed; installation and restoration pending.** Discover this installed directory as
`data.examples.mol1` with `ariax skills forge --tool mol1 --json` (the `mol-1`
guide alias resolves to the same directory). Use the
[Mol-1 guide](../../mol1.md) for qualification gates, staging and the complete
checkpoint/close flow. Mol-1 is absent from the public catalog at the initial
2026-10-28 read-only check; these files do not make it available.

| File | Exact purpose |
| --- | --- |
| [monomer.json](monomer.json) | `protein-monomer` candidate: one 76-residue ubiquitin, chain A, job `ubiquitin` |
| [protein-atp.json](protein-atp.json) | `ligand-ccd` candidate: the same chain plus one `CCD_ATP`, chain B, job `ubiquitin_atp` |
| [run.py](run.py) | Standard-library remote launcher; copies input and invocation, sets scratch caches, runs the pinned native module and saves full logs/exit status |
| [NOTICE.md](NOTICE.md) | Public provenance and separate code/weight/data/service terms |

The exact ubiquitin sequence, shared with the CLI's existing
[Chai-1 monomer fixture](../chai1/monomer.fasta), is:

```text
MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG
```

The ATP pairing is constructed to exercise chemical identity and atom coverage;
it is not a deposited complex, known binding pose or evidence of ubiquitin–ATP
binding. Neither fixture carries an MSA, template, covalent constraint or external
file path. Input preparation does not contact a search service. No coordinates,
reference structure, weights or chemical database are bundled here.

The default profile explicitly selects native 20 cycles, 200 diffusion steps,
five samples and seed 101 with MSA/template/RNA MSA disabled. The smoke profile
retains 20 cycles and 200 steps but uses one sample; it is only an execution diagnostic.
Both request full confidence output. Native kernel defaults are retained; the
recorded execution covers only the selected L40/CUDA 12.8 environment.

Upload the chosen JSON and `run.py`, wait for both input IDs and the tool to be
ready, then execute in the selected remote tool. For example, after staging
`protein-atp.json` at `/inputs/mol1/protein-atp.json`:

```sh
ariax forge run "$SESSION" --tool mol1 --gpus 0 --cwd /workspace --timeout-seconds 1800 --json -- \
  python /inputs/mol1/run.py --input /inputs/mol1/protein-atp.json \
  --out-dir /workspace/mol1/ligand-default-001 --profile default
```

The helper is deliberately a no-MSA fixture runner; it disables supplied MSA
features too. For a separately qualified supplied-MSA experiment use the native
command and [input guidance](../../mol1/inputs.md), preserving every companion.
Every run needs a fresh output directory. Follow
[output inspection](../../mol1/outputs.md) for required identities, confidence
scales, mappings, error handling and retention. Both default cases completed on
an L40 with CUDA 12.8 through this launcher: monomer A had 76 tokens/602 atoms;
protein plus ATP A+B had 107 tokens/633 atoms and retained all 31 ATP heavy-atom
names/elements. The checks support finite output identity and basic geometry,
confidence scales, mappings and ranking. They do not establish biological
binding, affinity, accuracy or ATP bond/chiral/charge/pose validity. See the
[recorded scope](../../mol1.md#recorded-native-checks) for timings and limits.
The one-sample recovery smoke and archive/Files restoration are not claimed as
passed here.
