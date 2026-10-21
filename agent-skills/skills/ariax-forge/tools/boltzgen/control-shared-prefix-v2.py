"""Capture one native prefix while the uninterrupted six-stage process continues."""
import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import hydra.utils
from pytorch_lightning import seed_everything

spec = importlib.util.spec_from_file_location('staged', Path(__file__).with_name('run-staged-v4.py'))
staged = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staged)


def main():
    parser = argparse.ArgumentParser(description=__doc__, add_help=False)
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--prefix-copy', type=Path, required=True)
    args, native = parser.parse_known_args()
    if args.output.exists() or args.prefix_copy.exists() or not native or native[0] != 'run':
        parser.error('Require fresh output and prefix-copy paths and the complete native run arguments')
    seed_everything(args.seed, workers=True)
    instantiate = hydra.utils.instantiate
    captured = []
    def capture(*values, **kwargs):
        task = instantiate(*values, **kwargs)
        if os.environ.get('BOLTZGEN_PIPELINE_STEP') == 'inverse_folding':
            run = task.run
            def with_boundary(config):
                result = run(config)
                order = staged.names(args.output)
                staged.snapshot(args.output, args.seed, order[:2])
                shutil.copytree(args.output, args.prefix_copy)
                captured.append('inverse_folding')
                return result
            task.run = with_boundary
        return task
    hydra.utils.instantiate = capture
    staged.call_native([*native, '--output', str(args.output), '--no_subprocess'])
    assert captured == ['inverse_folding']
    staged.snapshot(args.output, args.seed, staged.names(args.output))


if __name__ == '__main__':
    main()
