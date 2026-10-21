"""Print or run one explicit native BoltzGen qualification example.

Stage this helper beside input-class-cases.json and every linked YAML/CIF input.
Existing output directories are refused so invocation never resumes implicitly.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shlex
import subprocess


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case_id')
    parser.add_argument('--print',dest='print_only',action='store_true')
    args=parser.parse_args()
    manifest=json.loads(Path(__file__).with_name('input-class-cases.json').read_text())
    case=next((c for c in manifest['cases'] if c['id']==args.case_id),None)
    if case is None:parser.error('Choose a case from input-class-cases.json')
    argv=case['argv']
    print(shlex.join(argv),flush=True)
    if args.print_only:return
    output=Path(argv[argv.index('--output')+1])
    if output.exists():raise SystemExit('Choose a fresh output directory; existing native results require explicit review.')
    raise SystemExit(subprocess.call(argv))


if __name__=='__main__':
    main()
