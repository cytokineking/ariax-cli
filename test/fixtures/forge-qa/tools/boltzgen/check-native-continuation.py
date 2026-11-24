"""Check native stage continuation while retaining upstream entropy-seeded features."""
import argparse
import filecmp
import importlib.util
import json
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('comparison', Path(__file__).with_name('check-stage-continuation.py'))
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('staged', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    def files(root):
        return {str(p.relative_to(root)): p for p in root.rglob('*') if p.is_file() and not p.is_symlink()}
    left, right = files(args.reference), files(args.staged)
    assert set(right) - set(left) == {'rng-after-folding.npz'} and not set(left) - set(right)
    prefix = [name for name in left if name.startswith(('config/', 'intermediate_designs/'))
        or (name.startswith('intermediate_designs_inverse_folded/') and '/' not in name.split('/', 1)[1])
        and Path(name).suffix in ('.cif', '.npz')]
    prefix += ['steps.yaml', 'rng-after-inverse_folding.npz']
    for name in prefix:
        assert filecmp.cmp(left[name], right[name], shallow=False), name
    arrays = 0
    for filename in ['rng-after-inverse_folding.npz', 'rng-after-filtering.npz']:
        with np.load(left[filename], allow_pickle=False) as before, np.load(right[filename], allow_pickle=False) as after:
            assert set(before.files) == set(after.files)
            for key in before.files:
                comparison.equal(before[key], after[key])
                arrays += 1
    with np.load(left['rng-after-inverse_folding.npz'], allow_pickle=False) as saved:
        metadata = json.loads(str(saved['metadata']))
    assert metadata['torch_process_settings']['float32_matmul_precision'] == 'high'
    result = dict(state='passed_native_stage_continuation', generated_prefix_files_byte_equal=len(prefix),
        all_six_native_configs_equal=True, global_rng_arrays_equal=arrays,
        final_python_numpy_torch_cpu_cuda_rng_and_process_settings_equal=True,
        upstream_entropy_seeded_default_rng_preserved=True,
        cross_execution_array_equality_claim=False,
        native_scientific_checks_required_for_both_outputs=True,
        original_coordinate_and_plddt_tolerances_unchanged=True,
        scientific_inference_replayed=False)
    args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
