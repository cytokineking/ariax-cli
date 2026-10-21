"""Inspect every retained RF3 sample and its selected native output without inference."""
from __future__ import annotations
import argparse
import contextlib
import sys
import csv
import importlib.util
import json
from pathlib import Path
import gemmi

spec = importlib.util.spec_from_file_location('foundry_outputs', '/opt/forge-foundry/foundry_outputs.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def consume(root: Path, case_id: str, expected_samples: int = 1) -> dict:
    fixture = Path(__file__).resolve().parent
    case = next(c for c in json.loads((fixture / 'cases.json').read_text()) if c['id'] == case_id)
    expected = json.loads((fixture / case['expected']).read_text())
    example = case['output_stem']
    directory = root / example
    with (directory / (example + '_ranking_scores.csv')).open() as handle:
        ranking = list(csv.DictReader(handle))
    intended = {(7, sample) for sample in range(expected_samples)}
    actual = {(int(row['seed']), int(row['sample'])) for row in ranking}
    if len(ranking) != expected_samples or actual != intended:
        raise ValueError('Native ranking differs from the explicitly requested seed/sample count')
    if any(row.get('early_stopped', '').lower() in {'true', '1'} for row in ranking):
        raise ValueError('Native early stop did not produce every requested complete sample')

    def inspect(stem: Path) -> tuple[dict, list, dict, dict]:
        structure = Path(str(stem) + '_model.cif')
        summary = Path(str(stem) + '_summary_confidences.json')
        full = Path(str(stem) + '_confidences.json')
        result = checker.inspect_structure(structure, expected)
        result['confidence'] = checker.inspect_confidence(summary, full, result)
        atoms = [[c.name, r.seqid.num, r.name, a.name,
                  round(a.pos.x, 3), round(a.pos.y, 3), round(a.pos.z, 3)]
                 for c in gemmi.read_structure(str(structure))[0] for r in c for a in r]
        return result, atoms, json.loads(summary.read_text()), json.loads(full.read_text())

    wanted_dirs = {f'seed-{seed}_sample-{sample}' for seed, sample in intended}
    if {p.name for p in directory.glob('seed-*_sample-*')} != wanted_dirs:
        raise ValueError('Missing, additional or mismatched native sample directory')
    top, coords, summary, full = inspect(directory / example)
    samples, selected = [], []
    for seed, sample_id in sorted(intended):
        name = f'{example}_seed-{seed}_sample-{sample_id}'
        result, sample_coords, sample_summary, sample_full = inspect(directory / f'seed-{seed}_sample-{sample_id}' / name)
        samples.append({'seed': seed, 'sample': sample_id, 'state': 'passed', 'structure': result})
        if (coords, summary, full) == (sample_coords, sample_summary, sample_full):
            selected.append({'seed': seed, 'sample': sample_id})
    if len(selected) != 1:
        raise ValueError('Selected structure/confidence does not identify one complete native sample')
    # The native writer selects the maximum score, preserving input order on ties.
    first = max(ranking, key=lambda row: float(row["ranking_score"]))
    if selected[0] != {'seed': int(first['seed']), 'sample': int(first['sample'])}:
        raise ValueError('Selected output differs from the native maximum-score sample')
    return {'case': case_id, 'native_samples': samples, 'ranking': ranking,
            'selected_matches_sample': True, 'selected_sample': selected[0],
            'structure': top, 'accuracy_claim': False,
            'output_files': sorted(str(p.relative_to(root)) for p in root.rglob('*') if p.is_file())}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--case', required=True)
    parser.add_argument('--expected-samples', type=int, default=1)
    parser.add_argument("--report", type=Path, help="Atomically save the full report outside the native output tree")
    args = parser.parse_args()
    if args.expected_samples < 1:
        parser.error('positive explicit sample count required')
    result = consume(args.root, args.case, args.expected_samples)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        temporary=args.report.with_name(args.report.name+".part")
        temporary.write_text(json.dumps(result, indent=2, allow_nan=False)+"\n")
        temporary.replace(args.report)
        print(json.dumps({"case":args.case,"report":str(args.report),"expected_samples":args.expected_samples}))
    else:
        print(json.dumps(result, indent=2, allow_nan=False))
