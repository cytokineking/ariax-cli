"""Record native arrays; explicitly redesign rejected trajectories without promoting them."""
from __future__ import annotations

import argparse
import csv
from dataclasses import fields
import json
import os
from pathlib import Path

import jax
import jax.numpy as jnp
import numpy as np
from bindcraft import campaign
from bindcraft.af2 import AlphaFoldDesignModel, MONOMER_POOL, MULTIMER_POOL, campaign_length_bucket
from bindcraft.MPNN_stage import redesign_and_validate_binders
from bindcraft.protein import ATOM_NAMES, AMINO_ACIDS, BINDER_ALONE, Protein, StructurePrediction
from bindcraft.proteinmpnn import ProteinMPNNSequenceModel
from bindcraft.protein_preparation import validation_target_states
from bindcraft.settings import build_design_settings, select_design_and_validation_models
from bindcraft.trajectory import primary_target_state


def save_native(path: Path, states: dict, predictions: dict, **identity: object) -> None:
    arrays = {}
    def array(value):
        key = f'array{len(arrays)}'
        arrays[key] = np.asarray(value)
        return key
    def proteins(complex):
        return {name: {field.name: array(getattr(protein, field.name)) for field in fields(Protein)}
                for name, protein in complex.items()}
    identity_array_fields = []
    def metadata(value, location=()):
        if isinstance(value, dict):
            return {key: metadata(item, (*location, key)) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [metadata(item, (*location, index)) for index, item in enumerate(value)]
        if isinstance(value, (jax.Array, np.ndarray, np.generic)):
            key = array(value)
            identity_array_fields.append({'path': list(location), 'array': key})
            return arrays[key].tolist()
        return value
    normalized_identity = metadata(identity)
    record = {**normalized_identity, 'atom_names': list(ATOM_NAMES), 'amino_acids': AMINO_ACIDS,
              'states': {name: proteins(complex) for name, complex in states.items()},
              'predictions': {name: {'proteins': proteins(p.protein_complex),
                                    'metrics': {key: array(value) for key, value in p.metrics.items()}}
                              for name, p in predictions.items()}}
    if identity_array_fields:
        record['identity_array_fields'] = identity_array_fields
    encoded = json.dumps(record, indent=2) + '\n'
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path.with_suffix('.npz'), **arrays)
    path.with_suffix('.json').write_text(encoded)


def load_native(path: Path) -> tuple[dict, dict, dict]:
    record = json.loads(path.with_suffix('.json').read_text())
    with np.load(path.with_suffix('.npz'), allow_pickle=False) as arrays:
        def proteins(items):
            return {name: Protein(**{field: jnp.asarray(arrays[key]) for field, key in values.items()})
                    for name, values in items.items()}
        states = {name: proteins(items) for name, items in record['states'].items()}
        predictions = {name: StructurePrediction(proteins(value['proteins']),
                          {metric: jnp.asarray(arrays[key]) for metric, key in value['metrics'].items()})
                       for name, value in record['predictions'].items()}
    return record, states, predictions


def run(settings_path: str) -> int:
    original = campaign.run_trajectory
    def observed(design_settings, model, key, **kwargs):
        states, predictions, failed = original(design_settings, model, key, **kwargs)
        directory = Path(kwargs['trajectory_directory'])
        save_native(directory/'native', states, predictions,
                    settings=design_settings.settings, random_key=np.asarray(key).tolist(),
                    design=directory.name, terminated=failed, design_models=list(model.models),
                    trajectory_seed=campaign.sampled_trajectory_values(design_settings, key)[0]["trajectory_seed"])
        return states, predictions, failed
    campaign.run_trajectory = observed
    return campaign.launch_campaign(settings_path)


def evaluate(folder: Path) -> None:
    rows = list(csv.DictReader((folder/'1_Trajectories/!_Trajectories.csv').open()))
    if not 1 <= len(rows) <= 2:
        raise ValueError('Expected the declared one/two-trajectory campaign')
    for row in rows:
        if not row['terminated']:
            continue  # The native campaign already evaluated completed trajectories.
        path = folder/'1_Trajectories'/row['design']/'native'
        record, states, predictions = load_native(path)
        settings = record['settings']
        if settings['max_trajectories'] != 2 or settings['sequence_candidates'] != 2:
            raise ValueError('Rejected evaluation exceeds the declared campaign bound')
        design = build_design_settings(settings)
        selected = select_design_and_validation_models(settings, MULTIMER_POOL, MONOMER_POOL)
        predictor = AlphaFoldDesignModel(presets=selected.validation_models,
            data_dir=os.environ['BINDCRAFT_AF2_PARAMS'], max_cache_size=16,
            num_recycle=settings['validation_recycles'], dropout=False,
            subbatch_size=campaign.campaign_subbatch_size(settings, campaign.design_residue_count(settings)),
            attention_backend=settings['attention_backend'], use_cueq=settings['use_cueq'],
            length_bucket_size=campaign_length_bucket(settings))
        mpnn = ProteinMPNNSequenceModel(data_dir=os.environ['BINDCRAFT_MPNN_WEIGHTS'],
            max_cache_size=16, model_name=settings['mpnn_model'], variant=settings['mpnn_variant'],
            omitted_amino_acids=design.binder.omitted_amino_acids,
            amino_acid_bias=design.binder.amino_acid_bias,
            length_bucket_size=campaign_length_bucket(settings))
        predictor.key = mpnn.key = jnp.asarray(record['random_key'], dtype=jnp.uint32)
        output = folder/'rejected-evaluation'/row['design']
        output.mkdir(parents=True, exist_ok=False)
        counter = 0
        native_predict = predictor.predict
        def observed_predict(protein_states, model=None):
            nonlocal counter
            result = native_predict(protein_states, model=model)
            counter += 1
            save_native(output/f'prediction{counter}', protein_states, result,
                        model=model, campaign_design=row['design'], campaign_terminated=row['terminated'])
            return result
        predictor.predict = observed_predict
        primary = next(name for name in predictions if name != BINDER_ALONE)
        seed = int(record['trajectory_seed'])
        kept = redesign_and_validate_binders(predictions[primary].protein_complex, predictor, mpnn,
            design, selected.validation_models, binder=design.designed_binder_chain,
            target=f'{design.target_chain_prefix}_{primary}', prediction_state=primary,
            target_states=validation_target_states(design,
                {name: value for name, value in states.items() if name != BINDER_ALONE}, seed),
            predicted_states={name: p.protein_complex for name, p in predictions.items() if name != BINDER_ALONE},
            binder_alone_complex=predictions[BINDER_ALONE].protein_complex if BINDER_ALONE in predictions else None,
            design_pae=predictions[primary].metrics.get('pae'), trajectory_seed=seed,
            design=row['design'], candidates_csv=str(output/'candidates.csv'), project_folder=str(output))
        (output/'outcome.json').write_text(json.dumps({'design': row['design'],
            'campaign_terminated': row['terminated'], 'campaign_promoted': False,
            'diagnostic_filter_passes': len(kept), 'validation_models': list(selected.validation_models),
            'candidate_bound': 2, 'prediction_count': counter}, indent=2)+'\n')
        del predictor, mpnn


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('campaign', 'evaluate-rejected'))
    parser.add_argument('path', type=Path)
    args = parser.parse_args()
    if args.operation == 'campaign':
        raise SystemExit(run(str(args.path)))
    evaluate(args.path)
