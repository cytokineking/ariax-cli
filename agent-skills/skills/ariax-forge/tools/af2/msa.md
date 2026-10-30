# Common MSA choices

Ariax provides supplied-file, public ColabFold and user-selected compatible
server paths. Ariax does not bundle a search service or search databases.
Choose the policy before submitting sequences.

| Choice | Use | Record with results |
| --- | --- | --- |
| Supplied alignments | Upload externally prepared MSAs in the predictor's accepted format | Query/chain order, source/database date if known, copy counts, pairing method and the exact alignment files |
| Public ColabFold | Small serial MMseqs2 searches when the user accepts the service policy | Server URL, native version, query IDs, search mode, pairing mode/strategy, date and returned MSAs |
| Compatible custom server | User-selected endpoint with known access, capacity and retention policy | Endpoint, its database/version if available, authorization policy, same search/pairing settings and returned files |

For the public service, the [official policy](https://github.com/sokrypton/ColabFold#faq)
requires serial queries from one IP and asks users not to submit from
multiple computers. The [native terms notice](https://github.com/sokrypton/ColabFold/blob/84c27d9cc500489fd9b97545d2325b9d00f251d5/colabfold/utils.py)
describes limited shared capacity and possible access limits. Do not
parallelize search requests across Forge commands/VMs or retry around rate
limits. For large/private campaigns prepare MSAs externally or use an
authorized compatible service. A changing server/database can produce
different MSAs; retained alignments are the reproducible scientific input.

## Supplied ColabFold files

For a monomer A3M, the first record is the exact query; lowercase residues
represent insertions and hyphens represent aligned gaps. For complexes use
ColabFold's combined A3M format, including its header:

```text
#16,16<TAB>1,1
>101<TAB>102
AGSTAGSTAGSTAGSTGSTAGSTAGSTAGSTA
```

Here `<TAB>` represents a literal tab. The first list gives unique-chain
lengths; the second gives copy counts. Paired rows span chains, while
unpaired rows pad other chains with gaps. Do not concatenate independent
MSAs and label their rows paired without an explicit pairing method.
For a homodimer with one unique 16-residue chain, use `#16<TAB>2`.
The supplied examples contain literal tabs and preserve these identities.

In ColabFold 1.6.3, `--pair-mode` selects `unpaired`, `paired` or
`unpaired_paired` when generating alignments. `--pair-strategy` selects
`greedy` (species present in at least two chain MSAs) or `complete`
(species present in all). Supplied combined MSAs already encode pairing;
changing these flags does not regenerate or re-pair those rows. Record
their actual source settings. `--msa-mode single_sequence` removes
supplied homologs and pairing in this version.

Without templates, supplied A3M input avoids server requests. With
`--templates`, a server template search can still occur unless custom
templates are supplied. Keep private inputs on the supplied/custom path
chosen by the user. Other tools may need separate per-chain unpaired and
paired files or another schema. Follow that tool's native input guide;
preserve chain labels and pairing semantics during explicit conversion.

## One bounded server search, then saved-MSA prediction

Upload `search.fasta` and choose a fresh workspace output directory:

```sh
colabfold_batch /inputs/af2/search.fasta /workspace/msa-public-UNIQUE --msa-only --host-url https://api.colabfold.com --msa-mode mmseqs2_uniref_env --pair-mode unpaired_paired --pair-strategy greedy
```

Submit it once through `ariax forge run SESSION --tool af2 --gpus 0 -- ...`
and observe the same command ID. This pinned package's `--msa-only` path
still initializes JAX, so the AF2 image uses an assigned GPU even though it
performs no structure prediction. Keep `config.json`, `log.txt`, returned
A3Ms and the native MSA/template cache together. Check that every requested
query produced a nonempty A3M with its exact query sequence. A monomer case
does not establish complex pairing; a bounded complex case must separately
exercise the selected pairing strategy.

For a compatible custom server, replace `--host-url` with its clean base
URL. Do not embed credentials, signed query parameters or tokens in it:
native `config.json` records the host URL. ColabFold's native client expects
the compatible MMseqs2 ticket/result API and has no added Ariax credential
transport. Record unsupported authentication or API behavior as a concrete
gap. Do not switch services on failure.

Prediction can consume `/workspace/msa-public-UNIQUE/ubiquitin.a3m` in a
fresh output directory with the native flags in [the AF2 guide](../af2.md).
Retain the search run's config beside prediction config; prediction's
default server label does not establish the origin of a supplied MSA.
Select `mmseqs2_uniref` for UniRef-only search or `mmseqs2_uniref_env` for
UniRef+environmental search. The newer env-pair extension is not part of
this package's supported scope. Preserve actual settings and failures.

External search can run before renting a Forge GPU. Upload the resulting
alignments and source settings through the ordinary input API. Never put
large MSA databases or public/private sequence caches into shared model
assets. Save campaign alignments in the project, flush them and
explicitly reuse them after restoration.

The [service runner](../examples/af2/run_services.sh) takes one selected
case (`monomer`, `unpaired`, `paired`, `unpaired_paired`) and an explicit
stage (`search` or `predict`). Upload its fixture, matching manifest,
`af2_features.py`, `af2_outputs.py` and `af2_handoff.py`. Run searches serially
from one IP and retain every command ID:

```sh
sh /inputs/af2/run_services.sh /workspace/af2-public-unpaired-UNIQUE ORIGINAL_SESSION_ID https://api.colabfold.com unpaired search
sh /inputs/af2/run_services.sh /workspace/af2-public-unpaired-UNIQUE ORIGINAL_SESSION_ID https://api.colabfold.com unpaired predict
```

The search stage records its expected settings before submission, saves the
returned alignment and native feature dimensions, and caps the native search
at 15 minutes. Prediction consumes that saved A3M and refuses an existing
prediction directory. It runs model 1, seed 7, one recycle/ensemble, requested
MSA cap 32:64 and no relaxation, bounded to 30 minutes, then uses the unchanged
completion/structure/confidence/token and handoff checks. A failed case does
not submit another case. Select each next case explicitly after observing its
result. A timeout, service error or skipped native prediction remains failed;
do not replay it automatically or switch endpoints.

For template search, retain the trusted native feature cache; A3M alone omits
template features. A custom server must provide compatible API access and
authentication; an arbitrary endpoint is not guaranteed to work.
