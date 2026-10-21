# Named stability assets and access

Each asset keeps its compatible base and all six fine-tuned checkpoints.
The fine-tuned source is [Yehlin/absolute-stability](https://huggingface.co/Yehlin/absolute-stability),
revision `e2b3ecdd2cb3ded6adc62cc703d7f3fa4ab0e5a0`.

`stability-esm3` contains `base/` for
[esm3-sm-open-v1](https://huggingface.co/biohub/esm3-sm-open-v1),
revision `47f0545b2b6daf26a93439a3cd610f4f7f3d5478`, including the native
`data/weights/esm3_sm_open_v1.pth`, structure encoder/decoder and function
decoder. The selected MIT SDK 3.3.0 loader uses this local directory.

`esm3dg_weights/ESM3dG_weights_1_lora.ckpt` through `_3_lora.ckpt` form
`esm3-base`; `ESM3dG_weights_augmented_1_lora.ckpt` through
`_augmented_3_lora.ckpt` form `esm3-augmented`.

`stability-saprot` contains Transformers `base/` for
[SaProt_650M_AF2](https://huggingface.co/westlake-repl/SaProt_650M_AF2),
revision `d9b9ad00ef61c0990e611b2b43f2231c7de24b38`: `config.json`,
`pytorch_model.bin`, tokenizer config, special-token map and `vocab.txt`.
The alternative fair-esm `.pt` base is not consumed by the selected loader.

`saprotdg_weights/SaProtdG_weights_1_lora.ckpt` through `_3_lora.ckpt` form
`saprot-base`; `SaProtdG_weights_augmented_1_lora.ckpt` through
`_augmented_3_lora.ckpt` form `saprot-augmented`.

Both assets have `LICENSE`, `BASE-LICENSE`, source model README and ordinary
`source.json` metadata. Asset preparation and private publication belong to
the host/control plane. HF/registry credentials stay outside workloads; completed
weights are mounted read-only. Inference does not download models or a Foldseek binary.

B34 documents Foldseek `10-941cd33`, Linux amd64 AVX2 CPU. Its `foldseek`
asset must expose `/models/foldseek/bin/foldseek` and support
`structureto3didescriptor -v 0 --threads 1 --chain-name-mode 1 INPUT OUTPUT.tsv`.
Its four TSV fields are header, AA sequence, 3Di sequence and geometry.
B36 reads the exact input basename before the chain suffix, preserving
spaces and optional titles. It interleaves AA/lowercase 3Di for SaProt.
The saved-TSV consumer validator also compares sequence to the retained
input. B34's bounded native fixture/source handoff is accepted by the master.
B36 supplies no competing Foldseek bundle.

On October 4, 2026, direct retrieval of the
[selected ESM3 card](https://huggingface.co/biohub/esm3-sm-open-v1/blob/47f0545b2b6daf26a93439a3cd610f4f7f3d5478/README.md)
and Biohub's [ESM3 README](https://github.com/Biohub/esm/blob/43b4548b86762edfa747b07d5f440aad3c33acee/_assets/ESM3_README.md)
confirmed MIT for this base. The
[MIT notice](https://github.com/Biohub/esm/blob/43b4548b86762edfa747b07d5f440aad3c33acee/LICENSE.md)
permits use and redistribution with copyright/permission notices retained.
Interpretation: the current public base route permits commercial hosted
inference and private copies. The source also references Biohub's
[Acceptable Use Policy](https://biohub.org/acceptable-use-policy/).
Earlier cached non-commercial model excerpts were stale.

The ESM3 image now selects [MIT SDK 3.3.0 source](https://github.com/Biohub/esm/tree/c94ed8d763bbd7088b296949e5b401e8ea12073a)
with its [genuine MIT notice](https://github.com/Biohub/esm/blob/c94ed8d763bbd7088b296949e5b401e8ea12073a/LICENSE.md).
Its separate environment uses Python 3.12.10, Torch 2.5.1 CUDA 12.4,
Transformers 4.48.1, PEFT 0.14.0, Hub 0.34.4 and Accelerate 1.6.0.
The explicit SDK patch selects the public Transformers tokenizer dependency
and local named base path. The original base, six checkpoints, architecture,
native heads and equations are preserved. Full CUDA/checkpoint compatibility passed the assigned October 6 native
matrix; see qualification for its bounded scope. The retired SDK's older license was not relabeled.
No separate Ariax grant is established as necessary for this public MIT route.

B36's checker consumed B34's exported native descriptor and matched chain A,
76 amino acids, 76 3Di symbols and 152 interleaved characters. The author AA
mapping, insertion 127A and exported coordinates also match. The exported
invocation used a directory path with spaces. The master accepted B34's
bounded native fixture/source/guide handoff at R
`19a6bd41f7b7bdd75a75308cb6e84790737663c7`, C
`0e290676847f04fa8fdb4667f592202a8b8bec3c`, with cleanup confirmed. That earlier
pass consumed the exported native file. The October 6 campaign then executed the accepted binary and the selected pretrained ensembles.

The SaProt base and fine-tuned model cards declare MIT; their notices stay
with the assets. SaProt's separate image has no ESM SDK. The native campaign
used Python 3.11.10 and replaced inherited Ninja 1.11.1.1 with Linux 1.11.1.3
after an observed build dependency failure. Both targets and all four selected
ensembles passed their assigned native matrix. B55 subsequently delivered the
existing private images and complete assets.

The October 6 campaign also executed the real accepted Foldseek binary on
PDB/CIF with author AA, insertion 127A and filenames containing spaces. It
matched mappings and coordinates exactly and fed all native SaProt cases.


| Named asset | Archive bytes |
| --- | ---: |
| stability-esm3 | 5,595,566,080 |
| stability-saprot | 2,719,918,080 |
| foldseek | 29,450,240 |

Authenticated object HEAD/GET and actual complete installation passed. The
installed asset trees contain 5,595,501,856; 2,719,886,670; and 29,438,585 bytes,
respectively. All four three-member ensembles used these assets during the
new native matrix. No changed image, model payload or publication destination
is required for this completion.
