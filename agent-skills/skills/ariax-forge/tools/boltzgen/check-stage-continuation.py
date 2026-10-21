"""Compare the complete uninterrupted and staged native outputs exactly."""
import argparse
import filecmp
import json
from pathlib import Path
import numpy as np
import pandas as pd


def equal(a, b):
    if isinstance(a, np.ndarray):
        assert isinstance(b, np.ndarray) and a.dtype == b.dtype and a.shape == b.shape
        if a.dtype.fields:
            for field in a.dtype.names:
                equal(a[field], b[field])
        elif a.dtype.hasobject:
            for x, y in zip(a.flat, b.flat):
                equal(x, y)
        elif a.dtype.kind in 'fc':
            assert np.array_equal(a, b, equal_nan=True)
        else:
            assert np.array_equal(a, b)
    elif isinstance(a, dict):
        assert isinstance(b, dict) and set(a) == set(b)
        for k in a:
            equal(a[k], b[k])
    elif isinstance(a, (list, tuple)):
        assert type(a) is type(b) and len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    elif isinstance(a, (float, np.floating)) and np.isnan(a):
        assert np.isnan(b)
    else:
        assert a == b


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('reference', type=Path)
    p.add_argument('staged', type=Path)
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args()
    def files(root):
        return {str(p.relative_to(root)): p for p in root.rglob('*')
                if p.is_file() and not p.is_symlink()}
    left, right = files(a.reference), files(a.staged)
    boundaries = {'rng-after-inverse_folding.npz', 'rng-after-folding.npz'}
    assert set(right) - set(left) == boundaries and not set(left) - set(right)
    counts = dict(npz_files=0, npz_arrays=0, csv_files=0, byte_equal_files=0)
    excluded = []
    for name, x in left.items():
        y = right[name]
        if x.suffix == '.npz':
            with np.load(x, allow_pickle=True) as xx, np.load(y, allow_pickle=True) as yy:
                assert set(xx.files) == set(yy.files), name
                for key in xx.files:
                    try:
                        equal(xx[key], yy[key])
                    except AssertionError as error:
                        raise AssertionError(name + ':' + key) from error
                    counts['npz_arrays'] += 1
            counts['npz_files'] += 1
        elif x.suffix == '.csv':
            pd.testing.assert_frame_equal(pd.read_csv(x), pd.read_csv(y), check_exact=True)
            counts['csv_files'] += 1
        elif x.suffix == '.pdf':
            excluded.append(name)  # Native report generation timestamps are not scientific arrays.
        else:
            assert filecmp.cmp(x, y, shallow=False), name
            counts['byte_equal_files'] += 1
    report = dict(state='passed_exact_continuation', **counts,
                  final_python_numpy_torch_cpu_cuda_rng_equal=True,
                  complete_raw_arrays_equal_including_nans=True,
                  native_cifs_configs_masks_flags_equal=True,
                  native_csv_rows_values_equal=True, excluded_timestamped_reports=excluded,
                  completed_boundary_states_preserved=sorted(boundaries), inference_replayed=False)
    a.report.parent.mkdir(parents=True, exist_ok=True)
    a.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
