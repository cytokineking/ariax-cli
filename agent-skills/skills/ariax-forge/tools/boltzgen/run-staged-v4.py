"""Execute complete native stages with an explicit RNG state at host boundaries."""
import argparse
import json
from pathlib import Path
import random
import sys
import numpy as np
import torch
import yaml
from pytorch_lightning import seed_everything
from boltzgen.cli.boltzgen import main as native_main


def names(root):
    return [step['name'] for step in yaml.safe_load((root / 'steps.yaml').read_text())['steps']]


def snapshot(root, seed, completed):
    numpy_state = np.random.get_state()
    metadata = {'seed': seed, 'output_root': str(root), 'stage_order': names(root),
                'completed_stages': completed, 'python_state': random.getstate(),
                'numpy_generator': numpy_state[0], 'cuda_device_count': torch.cuda.device_count(),
                'torch_process_settings': {
                    'float32_matmul_precision': torch.get_float32_matmul_precision(),
                    'grad_enabled': torch.is_grad_enabled(),
                    'num_threads': torch.get_num_threads(),
                    'cudnn_benchmark': torch.backends.cudnn.benchmark,
                    'cudnn_deterministic': torch.backends.cudnn.deterministic}}
    arrays = {'metadata': np.asarray(json.dumps(metadata)),
              'numpy_keys': numpy_state[1], 'numpy_position': np.asarray(numpy_state[2]),
              'numpy_has_gauss': np.asarray(numpy_state[3]),
              'numpy_cached_gauss': np.asarray(numpy_state[4]),
              'torch_cpu': torch.get_rng_state().cpu().numpy()}
    for index, state in enumerate(torch.cuda.get_rng_state_all()):
        arrays['torch_cuda_' + str(index)] = state.cpu().numpy()
    target = root / ('rng-after-' + completed[-1] + '.npz')
    if target.exists():
        raise ValueError('RNG boundary already recorded; review before any continuation')
    temporary = target.with_suffix('.pending.npz')
    np.savez_compressed(temporary, **arrays)
    temporary.replace(target)
    return target


def restore(path, root, seed):
    with np.load(path, allow_pickle=False) as saved:
        metadata = json.loads(str(saved['metadata']))
        if (metadata['seed'] != seed or metadata['output_root'] != str(root)
            or metadata['stage_order'] != names(root)
            or metadata['cuda_device_count'] != 1 or torch.cuda.device_count() != 1):
            raise ValueError('RNG boundary belongs to another native invocation')
        completed = metadata['completed_stages']
        if completed != names(root)[:len(completed)] or not completed:
            raise ValueError('Recorded stage order differs')
        # Flush the earlier seed_everything CUDA callback before applying the
        # saved state. PyTorch otherwise appends its deferred seed after the
        # queued set_rng_state callback at the first CUDA initialization.
        torch.cuda.init()
        settings = metadata['torch_process_settings']
        torch.set_float32_matmul_precision(settings['float32_matmul_precision'])
        torch.set_grad_enabled(settings['grad_enabled'])
        torch.set_num_threads(settings['num_threads'])
        torch.backends.cudnn.benchmark = settings['cudnn_benchmark']
        torch.backends.cudnn.deterministic = settings['cudnn_deterministic']
        version, internal, gaussian = metadata['python_state']
        random.setstate((version, tuple(internal), gaussian))
        np.random.set_state((metadata['numpy_generator'], saved['numpy_keys'],
            int(saved['numpy_position']), int(saved['numpy_has_gauss']), float(saved['numpy_cached_gauss'])))
        torch.set_rng_state(torch.from_numpy(saved['torch_cpu'].copy()))
        torch.cuda.set_rng_state_all([torch.from_numpy(saved['torch_cuda_0'].copy())])
    return completed


def call_native(argv):
    sys.argv = ['boltzgen', *argv]
    native_main()


def main():
    parser = argparse.ArgumentParser(description=__doc__, add_help=False)
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--through')
    parser.add_argument('--resume-state', type=Path)
    parser.add_argument('--uninterrupted', action='store_true')
    args, native = parser.parse_known_args()
    if not 0 <= args.seed < 2**32 or torch.cuda.device_count() != 1:
        parser.error('require a 32-bit seed and one visible GPU')
    if any(flag in native for flag in ('--steps', '--reuse', '--no_subprocess')):
        parser.error('stage selection and replay are controlled by this explicit helper')
    seed_everything(args.seed, workers=True)
    if args.resume_state:
        if native or args.uninterrupted:
            parser.error('continuation takes the saved config, with no new native arguments')
        completed = restore(args.resume_state, args.output, args.seed)
    else:
        if not native or native[0] != 'run' or args.output.exists():
            parser.error('first invocation requires run and an absent output directory')
        completed = []
        if args.uninterrupted:
            if args.through:
                parser.error('uninterrupted control executes every native stage')
            call_native([*native, '--output', str(args.output), '--no_subprocess'])
            order = names(args.output)
            path = snapshot(args.output, args.seed, order)
            print(json.dumps({'state': 'native_pipeline_complete', 'completed_stages': order,
                              'rng_state': str(path)}), flush=True)
            return
        call_native(['configure', *native[1:], '--output', str(args.output)])
    order = names(args.output)
    through = args.through or order[-1]
    if through not in order or order.index(through) < len(completed):
        parser.error('continuation must execute a later complete native stage')
    selected = order[len(completed):order.index(through) + 1]
    call_native(['execute', str(args.output), '--steps', *selected, '--no_subprocess'])
    completed = order[:order.index(through) + 1]
    path = snapshot(args.output, args.seed, completed)
    print(json.dumps({'state': 'native_pipeline_complete' if completed == order else 'native_stages_complete',
                      'completed_stages': completed, 'remaining_stages': order[len(completed):],
                      'rng_state': str(path), 'scientific_inference_replayed': False}), flush=True)


if __name__ == '__main__':
    main()
