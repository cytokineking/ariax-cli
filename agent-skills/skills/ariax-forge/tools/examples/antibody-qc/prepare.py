"""Small controlled antibody QC fixtures; source sequences and changes are explicit."""
import argparse
import json
from pathlib import Path

H = 'EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS'
L = 'DIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK'
VHH = 'DVQLVESGGGSVQAGGSLRLSCAASGYIASINYLGWFRQAPGKEREGVAAVSPAGGTPYYADSVKGRFTVSLDNAENTVYLQMNSLKPEDTALYYCAAARQGWYIPLNSYGYNYWGQGTQVTVSS'

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--out', type=Path, required=True); args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    h_alert = H.replace('DGFYAMDY', 'NGTYAMDY')
    h_changed = h_alert.replace('NGTYAMDY', 'QGTYAMDY')
    records = [{'id': 'paired-alert', 'kind': 'paired', 'heavy': h_alert, 'light': L},
               {'id': 'paired-changed', 'kind': 'paired', 'heavy': h_changed, 'light': L},
               {'id': 'vhh-1zvh', 'kind': 'vhh', 'heavy': VHH}]
    for name, rows in [('batch', records), ('vhh', records[2:]), ('invalid', [{'id': 'invalid', 'kind': 'vhh', 'heavy': 'ACDE'}]), ('mixed', [records[2], {'id': 'invalid', 'kind': 'vhh', 'heavy': 'ACDE'}]), ('empty', [])]:
        (args.out / (name + '.json')).write_text(json.dumps(rows, indent=2) + '\n')
    (args.out / 'provenance.json').write_text(json.dumps({
        'paired_seed': 'Trastuzumab-like variable sequences used only as controlled sequence fixtures; no structure or efficacy reference',
        'deliberate_change': 'Heavy DGF segment in CDR3 replaced by NGT; second sequence changes that N to Q, preserving length',
        'vhh_source': 'RCSB 1ZVH polymer entity 2, author chain A, Camelus dromedarius; removed trailing RGRHHHHHH expression tag; same accepted reference entry as absolute-stability fixture',
        'vhh_url': 'https://www.rcsb.org/structure/1ZVH',
        'structural_reference': None, 'scientific_efficacy': 'unmeasured'
    }, indent=2) + '\n')

if __name__ == '__main__':main()
