"""Check the bounded B44 rejection case against saved native arrays and CIF/CSV files."""
from __future__ import annotations
import csv
import json
from pathlib import Path
import sys

import numpy as np
from campaign import load_native
from check import chain_sequences, inspect_complex, sequence
from bindcraft.filters import (binder_chain_sequences, confidence_stage_filters,
    design_stage_filters, evaluate_design_filters, interface_pdae_metric)
from bindcraft.protein import AMINO_ACIDS, ATOM_NAMES, BINDER_ALONE, recorded_number
from bindcraft.settings import build_design_settings


def rows(path):
    with path.open(newline='') as stream:
        return list(csv.DictReader(stream))


def native(path):
    record, states, predictions = load_native(path)
    if record['atom_names'] != list(ATOM_NAMES) or record['amino_acids'] != AMINO_ACIDS:
        raise ValueError('Native atom/amino-acid mapping changed')
    for complex in [*states.values(), *(p.protein_complex for p in predictions.values())]:
        for protein in complex.values():
            n = len(protein)
            if protein.atoms.shape != (n, len(ATOM_NAMES), 3) or protein.atom_mask.shape != (n, len(ATOM_NAMES)):
                raise ValueError('Native atom/residue dimensions disagree')
            if protein.flags.shape != (n,) or protein.residue_index.shape != (n,):
                raise ValueError('Native residue mapping dimensions disagree')
            if not np.isfinite(np.asarray(protein.atoms)[np.asarray(protein.atom_mask, dtype=bool)]).all():
                raise ValueError('Non-finite resolved native coordinates')
    return record, states, predictions


def compare_metrics(row, metrics):
    for name, value in metrics.items():
        if name in row and row[name] != '' and float(row[name]) != recorded_number(value):
            raise ValueError(f'Native array/CSV metric mismatch: {row["design"]} {name}')


def check(folder):
    target = chain_sequences(Path(__file__).with_name('PDL1.pdb'))['A']
    trajectories = rows(folder/'1_Trajectories/!_Trajectories.csv')
    promoted = [path for path in (folder/'2_Refolded/!_Refolded.csv', folder/'3_Ranked/!_Ranked.csv') if path.exists() and rows(path)]
    if len(trajectories) != 2 or promoted or list((folder/'3_Ranked').glob('*.cif')):
        raise ValueError('Expected exactly two rejected trajectories and no campaign promotion')
    audit = []
    for row in trajectories:
        directory = folder/'1_Trajectories'/row['design']
        record, states, predictions = native(directory/'native')
        if record['design'] != row['design'] or record['terminated'] != row['terminated'] or row['terminated'] != 'screen':
            raise ValueError('Native trajectory termination/identity changed')
        design = build_design_settings(record['settings'])
        screen_result, screen_metrics = evaluate_design_filters(design_stage_filters(design, states, 'screen'), states, predictions)
        if screen_result is True:
            raise ValueError('Recorded screen rejection is not reproducible from its arrays')
        losses = rows(directory/f'{row["design"]}_losses.csv')
        if len(losses) != 10 or any(value['phase'] != 'screen' for value in losses):
            raise ValueError('Native screen budget/stage record changed')
        binder = sequence(binder_chain_sequences(predictions['hPDL1'].protein_complex, design.designed_binder_chain))
        inspect_complex(directory/f'{row["design"]}_trajectory.cif', target, binder)
        evaluation = folder/'rejected-evaluation'/row['design']
        outcome = json.loads((evaluation/'outcome.json').read_text())
        candidates = rows(evaluation/'candidates.csv')
        if outcome['campaign_promoted'] is not False or outcome['diagnostic_filter_passes'] != 0 or outcome['prediction_count'] != 2 or len(candidates) != 2:
            raise ValueError('Rejected-evaluation count/promotion changed')
        for number, candidate in enumerate(candidates, 1):
            actual, candidate_states, candidate_predictions = native(evaluation/f'prediction{number}')
            if actual['campaign_design'] != row['design'] or actual['campaign_terminated'] != 'screen' or outcome['validation_models'] != [actual['model']]:
                raise ValueError('Candidate model/trajectory identity changed')
            if candidate['design'] != f'{row["design"]}_candidate{number}':
                raise ValueError('Candidate numbering changed')
            filters = design_stage_filters(design, candidate_states, 'final', campaign_filters=design.filters)
            full_result, metrics = evaluate_design_filters(filters, candidate_states, candidate_predictions)
            confidence_result, _ = evaluate_design_filters(confidence_stage_filters(filters), candidate_states, candidate_predictions)
            failures = confidence_result if confidence_result is not True else ([] if full_result is True else full_result)
            if candidate['outcome'] != 'rejected' or candidate['failed_filters'] != ','.join(failures):
                raise ValueError('Native rejection/CSV decision mismatch')
            compare_metrics(candidate, metrics)
            binder = sequence(candidate['Binder_Sequence'])
            complex = candidate_predictions['hPDL1'].protein_complex
            if binder_chain_sequences(complex, design.designed_binder_chain) != binder or binder_chain_sequences(candidate_states['hPDL1'], design.designed_binder_chain) != binder:
                raise ValueError('Native candidate sequence mismatch')
            inspect_complex(evaluation/'2_Refolded/Complexes'/f'{candidate["design"]}.cif', target, binder)
            monomer = chain_sequences(evaluation/'2_Refolded/BinderMonomer'/f'{candidate["design"]}_monomer.cif')
            if list(monomer.values()) != [binder] or binder_chain_sequences(candidate_predictions[BINDER_ALONE].protein_complex, design.designed_binder_chain) != binder:
                raise ValueError('Native binder-alone sequence mismatch')
            pdae = interface_pdae_metric(candidate_states, candidate_predictions, prediction_state='hPDL1', binder=design.designed_binder_chain, target='target_hPDL1')
            if (candidate['i_pDAE'] == '') != (pdae is None) or (pdae is not None and float(candidate['i_pDAE']) != recorded_number(pdae)):
                raise ValueError('Unavailable/native i_pDAE reading changed')
            audit.append({'design': candidate['design'], 'sequence': binder, 'model': actual['model'],
                'campaign_termination': row['terminated'], 'native_failed_filters': failures,
                'full_filter_audit': [] if full_result is True else full_result,
                'metrics_from_native_arrays': metrics, 'i_pDAE': pdae,
                'effective_filters': {name: {'threshold': item.threshold, 'higher': item.higher, 'mandatory': item.mandatory,
                    'required_states': sorted(item.required_states)} for name, item in filters.items()}})
    return {'trajectories': 2, 'screen_rejected': 2, 'redesign_candidates': 4, 'candidate_rejected': 4,
        'campaign_ranked': 0, 'target_residues': len(target), 'binder_residues': 31, 'candidates': audit}


if __name__ == '__main__':
    try:
        result = check(Path(sys.argv[1]))
    except (ValueError, KeyError) as error:
        raise SystemExit(str(error))
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2)+'\n')
    print('B44 native rejection arrays, metrics, sequences, identities and structures agree; no binding claim')
