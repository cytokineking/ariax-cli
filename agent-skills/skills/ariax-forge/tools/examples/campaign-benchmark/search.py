"""Run one explicit complete-snapshot CUDA search and retain the complete call."""
from __future__ import annotations
import argparse
from pathlib import Path
import shutil
import subprocess
import time
import uuid
from benchmark import read, resolve, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root',type=Path)
    parser.add_argument('--selection',required=True)
    parser.add_argument('--fasta',required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--scratch',type=Path,required=True)
    parser.add_argument('--command-id',type=uuid.UUID,required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    selection = read(resolve(root,args.selection))
    settings = selection['plan']['search']
    expected_fasta = ''.join('>' + q['query'] + '\n' + q['sequence'] + '\n' for q in selection['queries'])
    if resolve(root,args.fasta).read_text() != expected_fasta:
        raise ValueError('Query FASTA differs from frozen candidate/chain accessions')
    if args.out.exists() or args.scratch.exists():
        raise ValueError('Use fresh output and scratch directories')
    args.out.mkdir(parents=True)
    args.out = args.out.resolve()
    if not args.out.is_relative_to(root):
        raise ValueError('Search output belongs under the saved benchmark root')
    args.scratch.mkdir(parents=True)
    database = Path('/models/mmseqs2-uniref90-2026-03')
    shutil.copyfile(database/'snapshot.json',args.out/'snapshot.json')
    version = subprocess.check_output(['mmseqs','version'],text=True).strip()
    if settings['commit'] not in version and settings['version'] not in version:
        raise ValueError('Installed MMseqs2 differs from selected release: ' + version)
    argv = ['mmseqs','easy-search',str(resolve(root,args.fasta)),str(database/'uniref90'),
            str(args.out/'hits.tsv'),str(args.scratch/'search'),'--gpu','1','-a',
            '--min-seq-id',str(settings['min_identity']),'-c',str(settings['coverage']),
            '--cov-mode',str(settings['cov_mode']),'-e',str(settings['evalue']),
            '--max-seqs',str(settings['max_seqs']),'--seq-id-mode',str(settings['seq_id_mode']),
            '--threads',str(settings['threads']),'--format-output',','.join(settings['columns'])]
    started = time.perf_counter()
    with (args.out/'native.log').open('w') as stream:
        process = subprocess.run(['/usr/bin/time','-v','-o',str(args.out/'resources.txt'),*argv],
                                 stdout=stream,stderr=subprocess.STDOUT,check=False)
    elapsed = time.perf_counter()-started
    write(args.out/'run.json',{'outcome': 'succeeded' if process.returncode==0 else 'failed',
          'command_id': str(args.command_id),'returncode': process.returncode,
          'settings': settings,'actual_version': version,'argv': argv,
          'metadata_file': str((args.out/'snapshot.json').relative_to(root)),
          'tsv': str((args.out/'hits.tsv').relative_to(root)) if process.returncode==0 else None,
          'native_log': str((args.out/'native.log').relative_to(root)),
          'resources': str((args.out/'resources.txt').relative_to(root)),
          'elapsed_seconds': elapsed,'basis': 'new_complete_call',
          'submitted_candidates': 3,'submitted_chain_queries': 4,
          'operation': 'complete_UniRef90_CUDA_search','cost_usd': None,'cost_kind': 'unavailable'})
    raise SystemExit(process.returncode)


if __name__ == '__main__':
    main()
