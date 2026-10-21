#!/usr/bin/env python3
"""Prepare finite synthetic capacity inputs, then run one explicit profile remotely.

No service submission. Synthetic variants measure workload handling, not evolutionary depth.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

ALPHABET = "ACDEFGHIKLMNPQRSTVWY"


def synthetic_variant(sequence: str, index: int) -> str:
    if index == 0:
        return sequence
    # Distinct deterministic substitutions prevent native MSA deduplication
    # from turning a deep capacity input into two effective rows.
    prefix=[]
    for _ in range(4):
        prefix.append(ALPHABET[index % 20])
        index //= 20
    return ''.join(prefix)+sequence[4:]


def prepare(profile: dict, root: Path) -> tuple[Path, Path]:
    root.mkdir(parents=True, exist_ok=False)
    directory = root / "input"
    directory.mkdir()
    cases = []
    for item in range(profile["batch"]):
        chains = {chr(65+i): ''.join(ALPHABET[(j+i+item) % 20] for j in range(length))
                  for i, length in enumerate(profile["lengths"])}
        sequences = list(chains.values())
        job = f"{profile['id']}_{item+1}"
        lines = [f"#{','.join(str(len(s)) for s in sequences)}\t{','.join('1' for s in sequences)}"]
        if len(sequences) == 1:
            lines = []
        header = '\t'.join(str(101+i) for i in range(len(sequences)))
        for n in range(profile["paired_rows"] if len(sequences)>1 else profile["unpaired_rows"]):
            lines.extend([f">{header}" if n == 0 else f">synthetic_variant_{n}",
                          ''.join(synthetic_variant(s,n) for s in sequences)])
        if len(sequences)>1:
            for i, seq in enumerate(sequences):
                for n in range(profile["unpaired_rows"]):
                    lines.extend([f">{101+i}" if n==0 else f">synthetic_chain_{i+1}_variant_{n}",
                                  '-'*sum(map(len,sequences[:i]))+synthetic_variant(seq,n)+'-'*sum(map(len,sequences[i+1:]))])
        (directory / f"{job}.a3m").write_text('\n'.join(lines)+'\n')
        cases.append({"job":job,"chains":chains,"source":{"kind":"synthetic capacity input", "homologs":False}})
    settings = {"num_models":1,"model_order":[1],"num_seeds":1,"random_seed":7,
                "num_recycles":profile["recycles"],"num_ensemble":1,"use_templates":False,
                "pair_mode":"unpaired_paired","pairing_strategy":"greedy",
                "msa_mode":"mmseqs2_uniref_env","host_url":"https://api.colabfold.com",
                "max_seq":profile["max_msa"][0],"max_extra_seq":profile["max_msa"][1],
                "num_relax":0,"stop_at_score":100}
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps({"mode":profile["mode"],"models":[1],"seeds":[7],
        "raw":True,"tokens":True,"settings":settings,"cases":cases},indent=2)+'\n')
    (root / "profile.json").write_text(json.dumps(profile,indent=2)+'\n')
    return directory, manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("matrix", type=Path)
    parser.add_argument("profile")
    parser.add_argument("root", type=Path)
    parser.add_argument("--checks", type=Path, default=Path('/inputs/af2'))
    args=parser.parse_args()
    matrix=json.loads(args.matrix.read_text())
    profile=next((x for x in matrix['capacity_profiles'] if x['id']==args.profile), None)
    if profile is None:
        parser.error('Select one declared capacity profile')
    directory, manifest=prepare(profile,args.root)
    # Inspect effective native features before inference, including deduplication.
    # Imports happen only in the AF2 image on the remote GPU VM.
    import numpy as np
    from alphafold.common import residue_constants
    from af2_features import parse, features
    depth=[]
    for case in json.loads(manifest.read_text())["cases"]:
        parsed=parse(directory/(case["job"]+'.a3m'))
        native=features(parsed,profile['mode'],max_seq=profile['max_msa'][0])
        unpaired,paired,sequences,copies,_=parsed
        observed=[seq for seq,count in zip(sequences,copies,strict=True) for _ in range(count)]
        if observed!=list(case['chains'].values()):
            raise ValueError('Synthetic capacity input changed its native sequence/register')
        axis=native['aatype']
        if axis.ndim==2:
            axis=np.argmax(axis,axis=-1)
        np.testing.assert_array_equal(axis,[residue_constants.restype_order[x] for x in ''.join(observed)])
        depth.append({'job':case['job'],'native_msa_shape':list(native['msa'].shape),
                      'unpaired_rows':None if unpaired is None else [x.count('>') for x in unpaired],
                      'paired_rows':None if paired is None else [x.count('>') for x in paired]})
    (args.root/'native-feature-depth.json').write_text(json.dumps(depth,indent=2)+'\n')
    result=args.root/'prediction'; result.mkdir()
    command=['timeout','--signal=TERM','--kill-after=30s',str(profile['timeout_minutes'])+'m',
             'colabfold_batch',str(directory),str(result),'--model-type',profile['mode'],
             '--num-models','1','--model-order','1','--num-seeds','1','--random-seed','7',
             '--num-recycle',str(profile['recycles']),'--num-ensemble','1',
             '--max-msa',':'.join(map(str,profile['max_msa'])),'--num-relax','0',
             '--pair-mode','unpaired_paired','--pair-strategy','greedy','--stop-at-score','100',
             '--disable-unified-memory','--save-all']
    (args.root/'command.json').write_text(json.dumps(command,indent=2)+'\n')
    with (result/'console.log').open('w') as log:
        subprocess.run(command,check=True,stdout=log,stderr=subprocess.STDOUT)
    with (args.root/'check.json').open('w') as log:
        subprocess.run(['python3',str(args.checks/'af2_outputs.py'),str(result),str(manifest)],
                       check=True,stdout=log)


if __name__=='__main__':
    main()
