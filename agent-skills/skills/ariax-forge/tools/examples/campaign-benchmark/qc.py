"""Check exact candidate sequence and finite N/CA/C/O coverage in saved structures."""
from __future__ import annotations
import argparse
import math
from pathlib import Path
import time
import uuid
import gemmi
from benchmark import read, resolve, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root',type=Path)
    parser.add_argument('--input',required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--command-id',type=uuid.UUID,required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    if args.out.exists():
        raise ValueError('Use a fresh QC directory')
    args.out.mkdir(parents=True)
    started = time.perf_counter()
    records = []
    for item in read(resolve(root,args.input)):
        chains = []
        try:
            structure = gemmi.read_structure(str(resolve(root,item['structure'])))
            if len(structure) != 1:
                raise ValueError('Expected one explicitly selected structural model')
            for role, name in item['chain_map'].items():
                native = [c for c in structure[0] if c.name == name]
                if len(native) != 1:
                    raise ValueError('Missing or ambiguous native chain: ' + name)
                residues = [r for r in native[0] if gemmi.find_tabulated_residue(r.name).is_amino_acid()]
                sequence = ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code.upper() for r in residues)
                missing = []
                nonfinite = []
                complete = 0
                for i,r in enumerate(residues,1):
                    atoms = [a for a in r if a.altloc in ('\x00','A')]
                    absent = [n for n in ('N','CA','C','O') if sum(a.name==n for a in atoms)!=1]
                    if absent:
                        missing.append({'sequence_position': i,'author_number': r.seqid.num,
                                        'insertion': r.seqid.icode.strip(),'atoms': absent})
                    else:
                        complete += 1
                    for atom in r:
                        if not all(math.isfinite(x) for x in (atom.pos.x,atom.pos.y,atom.pos.z)):
                            nonfinite.append({'sequence_position': i,'atom': atom.name})
                chains.append({'role': role,'native_chain': name,'sequence': sequence,
                               'expected_sequence': item['sequences'][role],
                               'sequence_matches': sequence == item['sequences'][role],
                               'residues': len(residues),'complete_backbone_residues': complete,
                               'backbone_fraction': complete/len(residues) if residues else None,
                               'missing_atoms': missing,'nonfinite_atoms': nonfinite})
            passed = bool(chains) and all(c['sequence_matches'] and c['residues'] and
                                         c['backbone_fraction']==1 and not c['nonfinite_atoms'] for c in chains)
            reason = None
        except (ValueError,RuntimeError,OSError) as error:
            passed = False
            reason = str(error)
        records.append({'candidate': item['candidate'],'path': item['path'],
                        'structure': item['structure'],'passed': passed,'reason': reason,
                        'chains': chains,'method': 'exact-sequence finite N/CA/C/O coverage',
                        'gemmi_version': gemmi.__version__})
    write(args.out/'result.json',records)
    write(args.out/'run.json',{'command_id': str(args.command_id),
          'elapsed_seconds': time.perf_counter()-started,'basis': 'new_complete_call',
          'submitted_candidates': len(records),'completed_candidates': len(records),
          'qc_passed_candidates': sum(r['passed'] for r in records),
          'operation': 'backbone_qc','cost_usd': None,'cost_kind': 'unavailable'})


if __name__ == '__main__':
    main()
