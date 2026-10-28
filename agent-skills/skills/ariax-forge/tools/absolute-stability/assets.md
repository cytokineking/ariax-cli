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

Both assets have `LICENSE`, `BASE-LICENSE`, source model README and
`source.json` metadata. Weights are mounted read-only; inference uses the named
assets without downloading models or a Foldseek binary. HF/registry credentials
stay outside workloads.

SaProt uses Foldseek `10-941cd33`, Linux amd64 AVX2 CPU. The `foldseek`
asset must expose `/models/foldseek/bin/foldseek` and support
`structureto3didescriptor -v 0 --threads 1 --chain-name-mode 1 INPUT OUTPUT.tsv`.
Its four TSV fields are header, AA sequence, 3Di sequence and geometry.
The adapter reads the exact input basename before the chain suffix, preserving
spaces and optional titles. It interleaves AA/lowercase 3Di for SaProt.
The saved-TSV consumer validator also compares sequence to the retained
input.

The [selected ESM3 card](https://huggingface.co/biohub/esm3-sm-open-v1/blob/47f0545b2b6daf26a93439a3cd610f4f7f3d5478/README.md)
and Biohub's [ESM3 README](https://github.com/Biohub/esm/blob/43b4548b86762edfa747b07d5f440aad3c33acee/_assets/ESM3_README.md)
declare MIT for this base. Retain the
[MIT notice](https://github.com/Biohub/esm/blob/43b4548b86762edfa747b07d5f440aad3c33acee/LICENSE.md)
and its copyright/permission text when redistributing. The source also references Biohub's
[Acceptable Use Policy](https://biohub.org/acceptable-use-policy/).

The ESM3 image uses [MIT SDK 3.3.0 source](https://github.com/Biohub/esm/tree/c94ed8d763bbd7088b296949e5b401e8ea12073a)
with its [MIT notice](https://github.com/Biohub/esm/blob/c94ed8d763bbd7088b296949e5b401e8ea12073a/LICENSE.md).
The loader uses the public Transformers tokenizer and local named base path,
preserving the base model, six fine-tuned checkpoints, architecture, native
heads and equations. Other SDK releases can carry different terms; keep the
selected SDK and model notices with the assets.

The SaProt base and fine-tuned model cards declare MIT; their notices stay
with the assets. SaProt's separate image has no ESM SDK.
