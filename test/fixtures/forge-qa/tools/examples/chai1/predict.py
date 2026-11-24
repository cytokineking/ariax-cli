"""Run the native Chai API and retain its returned confidence arrays beside mmCIFs."""
from __future__ import annotations
import argparse
import json
import logging
from contextlib import contextmanager
from pathlib import Path
import traceback
import time
import torch
import numpy as np
from chai_lab.chai1 import run_inference

SOURCE = '66c38d1fe5c6756a89ff8596b1dea87d305ec06f'

class StrictRestraintErrors(logging.Handler):
    def emit(self, record):
        raise ValueError('Native restraint conditioning failed: '+record.getMessage())


@contextmanager
def strict_restraint_errors(enabled):
    logger=logging.getLogger('chai_lab.data.features.generators')
    handler=StrictRestraintErrors(level=logging.ERROR)
    if enabled:logger.addHandler(handler)
    try:
        yield
    finally:
        if enabled:logger.removeHandler(handler)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fasta', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--msa-directory', type=Path)
    parser.add_argument('--template-hits-path', type=Path)
    parser.add_argument('--constraint-path', type=Path)
    parser.add_argument('--num-trunk-recycles', type=int, default=3)
    parser.add_argument('--num-diffn-timesteps', type=int, default=200)
    parser.add_argument('--num-diffn-samples', type=int, default=5)
    parser.add_argument('--seed', type=int, default=7)
    parser.add_argument('--fasta-names-as-cif-chains', action='store_true')
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise FileExistsError('Choose a fresh output directory')
    if min(args.num_trunk_recycles, args.num_diffn_timesteps, args.num_diffn_samples) < 1:
        raise ValueError('Recycles, timesteps and samples must be positive')
    request = dict(fasta_file=args.fasta, output_dir=args.output,
        msa_directory=args.msa_directory, template_hits_path=args.template_hits_path,
        constraint_path=args.constraint_path, num_trunk_recycles=args.num_trunk_recycles,
        num_diffn_timesteps=args.num_diffn_timesteps, num_diffn_samples=args.num_diffn_samples,
        seed=args.seed, device='cuda:0', low_memory=True,
        fasta_names_as_cif_chains=args.fasta_names_as_cif_chains)
    record = {'source_commit': SOURCE, 'native_function': 'chai_lab.chai1.run_inference',
              'restraint_feature_errors': 'fatal when supplied constraints are present',
              'arguments': {k: str(v) if isinstance(v, Path) else v for k, v in request.items()}}
    started = time.monotonic()
    try:
        torch.cuda.set_device(0)
        torch.cuda.reset_peak_memory_stats(0)
        with strict_restraint_errors(args.constraint_path is not None):
            result = run_inference(**request)
        np.savez_compressed(args.output/'confidence.npz',
            pae=result.pae.cpu().numpy(), pde=result.pde.cpu().numpy(),
            plddt=result.plddt.cpu().numpy())
        record.update(state='succeeded', elapsed_seconds=time.monotonic()-started,
            cuda_peak_allocated_bytes=torch.cuda.max_memory_allocated(0),
            cuda_peak_reserved_bytes=torch.cuda.max_memory_reserved(0),
            torch_version=torch.__version__, structures=[p.name for p in result.cif_paths],
            msa_coverage_plot=result.msa_coverage_plot_path.name if result.msa_coverage_plot_path else None)
    except Exception:
        args.output.mkdir(parents=True, exist_ok=True)
        record.update(state='failed', traceback=traceback.format_exc())
        (args.output/'run.json').write_text(json.dumps(record, indent=2)+'\n')
        raise
    (args.output/'run.json').write_text(json.dumps(record, indent=2)+'\n')
    print(json.dumps({'state': record['state'], 'structures': record['structures'],
                      'confidence_arrays': 'confidence.npz'}))

if __name__ == '__main__':
    main()
