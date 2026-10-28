# Legacy JMS scoring, prediction and design

Check `ariax forge catalog --tool jms-legacy --json` for available models and
resources. Discover this guide and its examples with
`ariax skills forge --tool jms-legacy --json`.
The legacy TensorFlow models use pinned Joint_Model_Stability source and the
original TrMRF/TrROS checkpoints. Historical reproduction of the unavailable
r9_900 structure and results remains unverified. These objectives have no
established experimental stability or binding accuracy.

| Model | Supported operations |
| --- | --- |
| trmrf-a | Fixed-backbone score, original five-block 100-channel notebook model |
| trmrf-3 | Fixed-backbone score, original three-block 101-channel model |
| trmrf-5 | Fixed-backbone score and design, original five-block 101-channel model |
| trros | Fixed-backbone score/design, single-sequence/MSA geometry prediction, hallucination |
| joint | TrMRF-5 plus TrROS fixed-backbone score/design and hallucination |

Set `EXAMPLES` to `data.examples["jms-legacy"]` from scoped skill discovery.
`SESSION` is your authorized session UUID. The bundled 6MRR chain A has 68
residues. Use an explicit chain with consecutive canonical residues and finite,
complete N/CA/C coordinates. Resolve alternate locations and insertion codes
before intake. A scoring/design FASTA contains one canonical sequence with the
same length as the backbone; output preserves both candidate and backbone
identities. MSA prediction requires equal aligned lengths, an ungapped first
query, and explicit `--msa`; gaps in subsequent rows retain their positions.
Lowercase A3M insertions are not removed. The two-row example is synthetic.

```sh
ariax forge tools add "$SESSION" --tools jms-legacy --json
ariax forge tools wait "$SESSION" jms-legacy --timeout 7200 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/6MRR-A.pdb" --path jms-legacy/6MRR-A.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/6MRR-A.fasta" --path jms-legacy/6MRR-A.fasta --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/two-sequence.fasta" --path jms-legacy/two-sequence.fasta --json
```

Require the host available, tool ready and every input ready. Use a fresh output
directory for each operation, select an assigned GPU and retain command IDs.
The examples use seed 7, feat-drop 0, one sequence, 100 design iterations and a
hard switch at iteration 50. Choose hardware from the deployed requirements;
these small inputs do not establish larger-input capacity.

```sh
ariax forge run "$SESSION" --tool jms-legacy --gpus 0 --timeout-seconds 1800 --json -- jms-legacy score --model joint --pdb /inputs/jms-legacy/6MRR-A.pdb --chain A --fasta /inputs/jms-legacy/6MRR-A.fasta --seed 7 --output /workspace/jms-legacy/joint-score
ariax forge run "$SESSION" --tool jms-legacy --gpus 0 --timeout-seconds 1800 --json -- jms-legacy predict --model trros --fasta /inputs/jms-legacy/two-sequence.fasta --msa --seed 7 --output /workspace/jms-legacy/msa-predict
ariax forge run "$SESSION" --tool jms-legacy --gpus 0 --timeout-seconds 1800 --json -- jms-legacy design --model trros --pdb /inputs/jms-legacy/6MRR-A.pdb --chain A --fasta /inputs/jms-legacy/6MRR-A.fasta --iterations 100 --num 1 --hard-switch 50 --seed 7 --output /workspace/jms-legacy/fixed-design
```

`score` accepts all five model selectors. Single-sequence prediction uses one
FASTA record and omits `--msa`. Fixed-backbone design supports trmrf-5, trros
and joint. For length-conditioned hallucination use trros or joint with
`--length 20`, without PDB, chain or FASTA; it prepares the original native
background unless an explicit matching background NPY is supplied. This
changes the objective and does not infer stability from a known backbone.

`scores.json` records source, checkpoint, input identity, conditioning and
scores. TrMRF is mean conditional amino-acid NLL in nats, with epsilon 1e-8;
TrMRF-3/5 use seqid 1 by default. TrROS fixed-backbone loss is categorical
geometry cross entropy, averaged over the five member losses. Cross entropy
of averaged predictions is a different quantity. Joint fixed-backbone loss
adds TrMRF and geometry CE at unit weights. Hallucination instead uses the
native negative-KL background objective and, for joint, TrMRF geometry from
member predictions. Design also retains generated FASTA and loss history;
prediction retains geometry distributions. Keep every generated file with
scores.json and the exact argv, seeds and input mapping.

Observe `forge command`, `forge watch` and `forge logs` until each command
succeeds. A client wait timeout leaves the command running; inspect the
original command ID before deciding on an explicit new operation.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/jms-legacy --checkpoint "$CHECKPOINT" --json
```

Use the completed checkpoint UUID returned by sync. Preserve complete output
directories, including arrays and FASTA. Follow the [Files guide](../outputs.md)
for saved links, remote export, restoration and session closure, and
[project controls](../SKILL.md#project-controls-and-resume) for pause and same-project resume.
