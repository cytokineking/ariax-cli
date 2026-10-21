"""Finite native qualification. Diagnostics never promote a rejected campaign."""
from __future__ import annotations
import argparse
from dataclasses import fields
from contextlib import contextmanager
from collections.abc import Callable, Iterator
import csv, json, os, shutil
from pathlib import Path
import jax
import numpy as np
from campaign import save_native, load_native, run
from bindcraft import campaign as native_campaign
from bindcraft import MPNN_stage as native_mpnn
from bindcraft.af2 import AlphaFoldDesignModel, MULTIMER_POOL, MONOMER_POOL, campaign_length_bucket
from bindcraft.protein import Protein, StructurePrediction, BINDER_ALONE, ATOM_NAMES, AMINO_ACIDS, write_structure, build_atom_array, ResidueFlags, superposed_on_binder
from biotite.structure import AtomArrayStack
from biotite.structure.io import load_structure
from bindcraft.protein_preparation import initialize_design_trajectory, receptor_chain_layouts
from bindcraft.settings import read_settings, build_design_settings, select_design_and_validation_models, resolve_cyclic_offset_mode, DEFAULT_SETTINGS, target_state_names
from bindcraft import trajectory as native
from bindcraft.MPNN_stage import redesign_and_validate_binders, ensemble_mean_predictions, checks_out_of_reach, decoded_sequence_metrics, design_sequence_report
from bindcraft.proteinmpnn import ProteinMPNNSequenceModel
from bindcraft.protein_preparation import validation_target_states, frame_holding_target, states_holding_the_frame
from bindcraft.filters import design_stage_filters, evaluate_design_filters, interface_pdae_metric, confidence_stage_filters, binder_chain_sequences
from bindcraft.campaign_output import recorded_row, target_ordered_row, weighted_target_order, accepted_state_suffixes, trajectory_output_path

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, default=lambda x: np.asarray(x).tolist())+'\n')

def model_for(settings, models, *, validation=False):
    plan=native_campaign.campaign_design_plan(settings)
    return AlphaFoldDesignModel(presets=tuple(models), models=tuple(models),
        data_dir=os.environ['BINDCRAFT_AF2_PARAMS'], max_cache_size=16,
        num_recycle=settings.get('validation_recycles',3) if validation else settings.get('design_recycles',1),
        cyclic_offset_mode=resolve_cyclic_offset_mode(settings), dropout=False,
        subbatch_size=plan.subbatch_size, attention_backend=plan.attention_backend,
        use_cueq=plan.use_cueq, use_remat=plan.use_remat,
        length_bucket_size=plan.length_bucket_size,multi_chain_binders=plan.multi_chain_binders,
        target_pad_length=plan.target_pad_length,amino_acid_bias=plan.design_settings.binder.amino_acid_bias)

def dump(path, states, predictions, design, **identity):
    save_native(path,states,predictions,**identity)
    for state,prediction in predictions.items():
        write_structure(prediction.protein_complex,str(path.parent/(path.name+'-'+state+'.cif')),
                        receptor_chains=receptor_chain_layouts(design))

def stages(settings_path, output, model):
    output.mkdir(parents=True,exist_ok=False)
    settings=read_settings(settings_path); design=build_design_settings(settings)
    predictor=model_for(settings,[model]); key=jax.random.PRNGKey(settings.get('campaign_seed',7))
    predictor.key=key
    observed={}
    raw_gradient=predictor.sequence_gradients
    raw_prediction=predictor.predict
    def gradient(states, losses, **kwargs):
        before=np.asarray(predictor.key).copy(); result=raw_gradient(states,losses,**kwargs)
        observed[id(result[0])]=(before,losses,kwargs,predictor.dropout)
        return result
    def prediction(states, **kwargs):
        before=np.asarray(predictor.key).copy(); result=raw_prediction(states,**kwargs)
        observed[id(result)]=(before,None,kwargs,predictor.dropout)
        return result
    predictor.sequence_gradients=gradient; predictor.predict=prediction
    def reference(path, predictions):
        before,losses,kwargs,dropout=observed[id(predictions)]
        record,saved_states,_=load_native(path)
        advanced=predictor.key; advanced_dropout=predictor.dropout
        predictor.key=before; predictor.dropout=dropout
        fresh=raw_gradient(saved_states,losses,**kwargs)[0] if losses is not None else raw_prediction(saved_states,**kwargs)
        comparison=compare_raw(path,fresh)
        predictor.key=advanced; predictor.dropout=advanced_dropout
        write(path.parent/(path.name+'-comparison.json'),{**comparison,'random_key':before.tolist(),
            'model':model,'num_recycle':predictor.num_recycle,'dropout':dropout,
            'sequence_parameters':{k:v for k,v in kwargs.items() if k!='reference_predictions'},
            'operation':'sequence_gradients' if losses is not None else 'predict',
            'input':'saved actual native stage inputs','reference':'unwrapped native method raw outputs'})
        observed.clear()
    init_key,mutation_key=jax.random.split(key); conformation_key=jax.random.split(init_key)[1]
    states,tied,losses=initialize_design_trajectory(design,init_key)
    wild=states; trajectory=native.TrajectoryState(states,{},wild,losses)
    plan=native.build_stage_plan(design,losses,tied,predictor,wild)
    target_schedule=native.build_target_schedule(design,states,plan[0].sequence_optimizer.iterations,plan[0].name)
    records=[]
    for stage in plan:
        trajectory=native.run_stage_operations(stage.prepare,trajectory._replace(failed=()))
        predictor.dropout=stage.dropout and settings.get('design_dropout',DEFAULT_SETTINGS['design_dropout'])
        schedule=native.build_design_schedule(design,trajectory.design_target_states,trajectory.losses,
            stage.sequence_optimizer.iterations,conformation_key,target_schedule=target_schedule,design_stage=stage.name)
        states,predictions=native.run_gradient_design_stage(trajectory.protein_states,predictor,
            sequence_optimizer=stage.sequence_optimizer,design_schedule=schedule,
            select_best_round=len(design.prepared_states)<2,
            select_filtered_round=native.rotating_stage_filter_round(design,target_schedule,trajectory.protein_states,stage.name),
            **native.induced_fit_reference_arguments(trajectory.losses,trajectory.binder_alone_reference,predictor,design))
        if predictions is None: raise RuntimeError('No finite native round at '+stage.name)
        trajectory=native.run_stage_operations(stage.review,trajectory._replace(protein_states=states,predictions=predictions))
        audited,metrics=native.judge_stage(trajectory,design,target_schedule,stage.name)
        # The decision is preserved; this independent diagnostic explicitly calls the next native function.
        records.append({'stage':stage.name,'native_failed_filters':list(audited.failed),'metrics':metrics,
                        'iterations':stage.sequence_optimizer.iterations,'campaign_promoted':False})
        dump(output/stage.name,states,predictions,design,settings=settings,model=model,
             provenance='independent_native_stage_diagnostic',campaign_promoted=False,
             native_failed_filters=list(audited.failed),stage=stage.name)
        reference(output/stage.name,predictions)
        if not audited.failed: trajectory=native.run_stage_operations(stage.advance,trajectory)
        write(output/'stages.json',records)
    states,predictions,failed=native.run_mutation_polish(design,predictor,trajectory.protein_states,wild,
        trajectory.losses,trajectory.binder_alone_reference,tied,mutation_key,conformation_key,
        tuple(s.name for s in design.prepared_states),None)
    dump(output/'mutate',states,predictions,design,settings=settings,model=model,
         provenance='independent_native_stage_diagnostic',campaign_promoted=False,native_terminated=failed,stage='mutate')
    reference(output/'mutate',predictions)
    records.append({'stage':'mutate','native_terminated':failed,'campaign_promoted':False})
    write(output/'stages.json',records)

def compare_raw(saved, raw):
    record=json.loads(saved.with_suffix('.json').read_text())
    if record['atom_names']!=list(ATOM_NAMES) or record['amino_acids']!=AMINO_ACIDS: raise ValueError('Native identity mapping differs')
    if set(record['predictions'])!=set(raw): raise ValueError('Prediction state coverage differs')
    count=0; used=set()
    with np.load(saved.with_suffix('.npz'),allow_pickle=False) as arrays:
        def equal(key,value,label):
            nonlocal count
            actual=np.asarray(value); expected=arrays[key]; used.add(key)
            if expected.shape!=actual.shape or expected.dtype!=actual.dtype: raise ValueError('Native shape/dtype differs: '+label)
            if not np.array_equal(expected,actual,equal_nan=True): raise ValueError('Saved/native raw output differs: '+label)
            count+=actual.size
        for state,prediction in raw.items():
            exported=record['predictions'][state]
            if set(exported['proteins'])!=set(prediction.protein_complex) or set(exported['metrics'])!=set(prediction.metrics): raise ValueError('Native chain/metric coverage differs')
            for chain,protein in prediction.protein_complex.items():
                if set(exported['proteins'][chain])!={f.name for f in fields(Protein)}: raise ValueError('Native Protein field coverage differs')
                for field in fields(Protein):equal(exported['proteins'][chain][field.name],getattr(protein,field.name),state+'/'+chain+'/'+field.name)
            for metric,value in prediction.metrics.items():equal(exported['metrics'][metric],value,state+'/'+metric)
        state_keys={key for state in record['states'].values() for protein in state.values() for key in protein.values()}
        if set(arrays.files)!=used|state_keys: raise ValueError('Unaccounted serialized arrays')
    return {'output_array_count':len(used),'output_array_elements':count,'maximum_difference':0.0,'tolerance':0.0,'comparison':'saved diagnostic to fresh native raw output'}

def predictions(source,output):
    record,states,_=load_native(source); settings=record['settings']; design=build_design_settings(settings)
    bound=native.primary_target_state(states)
    states={**states,**native.binder_alone_state(states,bound,design.target_chain_prefix)}
    output.mkdir(parents=True,exist_ok=False); results=[]
    for model in (*MULTIMER_POOL,*MONOMER_POOL):
        predictor=model_for(settings,[model],validation=True)
        key=jax.random.PRNGKey(7); predictor.key=key
        first=predictor.predict(states,model=model)
        dump(output/(model+'-observed'),states,first,design,settings=settings,model=model,
             random_key=np.asarray(key).tolist(),prediction_settings={'num_recycle':settings.get('validation_recycles',3),'dropout':False,'softmax_weight':1.0,'one_hot_weight':1.0,'temperature':0.01,'logit_scale':2.0},
             provenance='native_explicit_diagnostic_prediction',campaign_promoted=False)
        # A fresh predictor consumes the saved actual inputs and effective prediction configuration.
        saved=output/(model+'-observed'); actual,saved_states,_=load_native(saved)
        reference=model_for(actual['settings'],[actual['model']],validation=True)
        reference.key=np.asarray(actual['random_key'],dtype=np.uint32)
        config=actual['prediction_settings']
        second=reference.predict(saved_states,model=actual['model'],**{k:v for k,v in config.items() if k not in ['num_recycle','dropout']})
        comparison=compare_raw(saved,second)
        dump(output/(model+'-reference'),saved_states,second,design,settings=settings,model=model,
             provenance='direct_native_reference',campaign_promoted=False)
        decision,metrics=evaluate_design_filters(design_stage_filters(design,saved_states,'final'),saved_states,second)
        results.append({'model':model,**comparison,'native_trajectory_final_filter_result':decision,'native_trajectory_metrics':metrics})
        write(output/'comparisons.json',results)
        del predictor,reference
        jax.clear_caches()

@contextmanager
def capture_campaign_exports(settings: dict, directory: Path) -> Iterator[None]:
    """Save the actual poses passed to native trajectory/ranking writers."""
    originals = [(module, module.write_structure) for module in (native_campaign, native)]

    def observer(writer: Callable[..., object]) -> Callable[..., object]:
        def observed(protein_complex: dict, path: str | Path, *args, **kwargs) -> object:
            destination = Path(path)
            if destination.exists():
                raise FileExistsError('Native write would overwrite retained structure: '+str(destination))
            relative = destination.relative_to(directory)
            parent = directory/'NativeStructureEvidence'
            parent.mkdir(parents=True, exist_ok=True)
            number = 1
            while True:
                evidence = parent/f'export-{number:04d}'
                try:
                    evidence.mkdir()
                    break
                except FileExistsError:
                    number += 1
            record = {'path': str(relative), 'state': 'writing',
                      'provenance': 'observed_native_structure_write',
                      'additional_predictions': 0, 'additional_alignments': 0}
            save_native(evidence/'written', {}, {'written': StructurePrediction(protein_complex, {})},
                        settings=settings, provenance=record['provenance'])
            write(evidence/'export.json', record)
            try:
                result = writer(protein_complex, path, *args, **kwargs)
                record['state'] = 'complete'
                return result
            except BaseException:
                record['state'] = 'failed'
                raise
            finally:
                write(evidence/'export.json', record)
        return observed

    for module, writer in originals:
        module.write_structure = observer(writer)
    try:
        yield
    finally:
        for module, writer in originals:
            module.write_structure = writer


@contextmanager
def capture_refold_exports() -> Iterator[None]:
    """Observe existing native calls; never invoke another prediction/alignment."""
    validation = native_mpnn.predict_validation_ensemble
    writer = native_mpnn.write_refolded_candidate
    structure_writer = native_mpnn.write_structure
    pending, active = {}, {}

    def observed_validation(structure_predictor: object, protein_states: dict, models: tuple[str, ...],
                            stage_filters: dict | None = None) -> object:
        result = validation(structure_predictor, protein_states, models, stage_filters)
        pending[id(result.predictions)] = (protein_states, result.model_predictions)
        return result

    def observed_structure(protein_complex: dict, path: str | Path, *args, **kwargs) -> object:
        if active:
            destination = Path(path)
            if destination.exists():
                raise FileExistsError('Native export would overwrite a retained CIF: '+str(destination))
            snapshot = 'written-'+str(len(active['record']['written']))
            save_native(active['directory']/snapshot, {},
                        {'written': StructurePrediction(protein_complex, {})},
                        provenance='observed_native_export', settings=active['settings'])
            active['record']['written'].append({'path': str(destination.relative_to(active['refold_folder'])),
                                                'snapshot': snapshot})
            write(active['directory']/'export.json', active['record'])
        return structure_writer(protein_complex, path, *args, **kwargs)

    def observed_writer(refold_folder: str, candidate: str, predictions: dict, prediction_state: str,
                        failed_filters: list[str], settings: dict, receptor_chains: dict | None = None,
                        design_settings: object = None, protein_states: dict | None = None) -> str | None:
        states, members = pending.pop(id(predictions))
        parent = Path(refold_folder)/'NativeEvidence'/candidate
        parent.mkdir(parents=True, exist_ok=True)
        number = 1
        while True:
            directory = parent/f'export-{number:04d}'
            try:
                directory.mkdir()
                break
            except FileExistsError:
                number += 1
        record = {'candidate': candidate, 'ensemble_member_order': list(members),
                  'prediction_state': prediction_state, 'failed_filters': failed_filters,
                  'state': 'writing', 'written': [], 'additional_predictions': 0,
                  'additional_alignments': 0}
        save_native(directory/'ensemble', states, predictions, settings=settings,
                    provenance='observed_native_export', ensemble_member_order=list(members))
        for index, (model, member) in enumerate(members.items()):
            save_native(directory/f'member-{index}', states, member, settings=settings,
                        provenance='observed_native_export', model=model)
        active.update(directory=directory, record=record, settings=settings,
                      refold_folder=Path(refold_folder))
        try:
            result = writer(refold_folder, candidate, predictions, prediction_state, failed_filters,
                            settings, receptor_chains, design_settings, protein_states)
            record['state'] = 'complete'
            return result
        except BaseException:
            record['state'] = 'failed'
            raise
        finally:
            write(directory/'export.json', record)
            active.clear()

    native_mpnn.predict_validation_ensemble = observed_validation
    native_mpnn.write_refolded_candidate = observed_writer
    native_mpnn.write_structure = observed_structure
    try:
        yield
    finally:
        native_mpnn.predict_validation_ensemble = validation
        native_mpnn.write_refolded_candidate = writer
        native_mpnn.write_structure = structure_writer


def redesign(source,output,variants=('negative','neutral')):
    record,states,predictions=load_native(source)
    output.mkdir(parents=True,exist_ok=False)
    for variant in variants:
        settings={**record['settings'],'mpnn_variant':variant,'sequence_candidates':2,
                  'validation_model':'multimer',
                  'design_models':['model_1_multimer_v3','model_2_multimer_v3','model_3_multimer_v3'],
                  'validation_models':['model_4_multimer_v3','model_5_multimer_v3']}
        design=build_design_settings(settings)
        selected=select_design_and_validation_models(settings,MULTIMER_POOL,MONOMER_POOL)
        predictor=model_for(settings,selected.validation_models,validation=True)
        mpnn=ProteinMPNNSequenceModel(data_dir=os.environ['BINDCRAFT_MPNN_WEIGHTS'],
            max_cache_size=16,model_name=settings['mpnn_model'],variant=variant,
            omitted_amino_acids=design.binder.omitted_amino_acids,
            amino_acid_bias=design.binder.amino_acid_bias,length_bucket_size=campaign_length_bucket(settings))
        predictor.key=mpnn.key=jax.random.PRNGKey(7)
        directory=output/variant;directory.mkdir();count=0;original=predictor.predict
        def observed(protein_states,model=None):
            nonlocal count
            key=np.asarray(predictor.key).tolist();result=original(protein_states,model=model);count+=1
            save_native(directory/f'prediction{count}',protein_states,result,model=model,
                random_key=key,settings=settings,provenance='explicit_native_redesign_diagnostic',campaign_promoted=False)
            return result
        predictor.predict=observed
        primary=next(name for name in predictions if name!=BINDER_ALONE)
        seed=7
        with capture_refold_exports():
            kept=redesign_and_validate_binders(predictions[primary].protein_complex,predictor,mpnn,
                design,selected.validation_models,binder=design.designed_binder_chain,
                target=f'{design.target_chain_prefix}_{primary}',prediction_state=primary,
                target_states=validation_target_states(design,{name:value for name,value in states.items() if name!=BINDER_ALONE},seed),
                predicted_states={name:p.protein_complex for name,p in predictions.items() if name!=BINDER_ALONE},
                binder_alone_complex=predictions[BINDER_ALONE].protein_complex if BINDER_ALONE in predictions else None,
                design_pae=predictions[primary].metrics.get('pae'),trajectory_seed=seed,design='native_stage_diagnostic',
                candidates_csv=str(directory/'candidates.csv'),project_folder=str(directory))
        candidates=list(csv.DictReader((directory/'candidates.csv').open()))
        write(directory/'outcome.json',{'variant':variant,'candidate_bound':2,'prediction_count':count,
            'native_filter_passes':sum(row['outcome']=='passed' for row in candidates),
            'native_kept_sequences':len(kept),'campaign_promoted':False,
            'design_models':list(selected.design_models),'validation_models':list(selected.validation_models),
            'source_native_termination':record.get('native_terminated')})
        del predictor,mpnn
        jax.clear_caches()

def campaign(settings_path):
    settings=read_settings(settings_path); directory=Path(settings['project_folder'])
    original=AlphaFoldDesignModel.predict
    existing=list((directory/'native-predictions').glob('prediction*.json'))
    n=max((int(p.stem.removeprefix('prediction')) for p in existing),default=0)
    def observed(self,states,model=None,**kwargs):
        nonlocal n
        key=np.asarray(self.key).tolist() if self.key is not None else None
        result=original(self,states,model=model,**kwargs); n+=1
        save_native(directory/'native-predictions'/f'prediction{n}',states,result,
            model=model,available_models=list(self.models),random_key=key,settings=settings,
            prediction_settings=kwargs,num_recycle=self.num_recycle,dropout=self.dropout,
            provenance='observed_unmodified_native_campaign_prediction')
        return result
    AlphaFoldDesignModel.predict=observed
    try:
        with capture_campaign_exports(settings, directory), capture_refold_exports():
            return run(str(settings_path))
    finally:
        AlphaFoldDesignModel.predict=original

def resume(settings_path):
    original=json.loads(settings_path.read_text());folder=Path(original['project_folder'])
    if original['max_trajectories']!=1:raise ValueError('Expected the explicit first one-attempt phase')
    table=folder/'1_Trajectories/!_Trajectories.csv'
    before=list(csv.DictReader(table.open()))
    if len(before)!=1:raise ValueError('Expected one terminal native attempt before continuation')
    snapshot=folder.parent.parent/'recovery-original'
    shutil.copytree(folder,snapshot)
    retained=[p for p in snapshot.rglob('*') if p.is_file() and
        (p.is_relative_to(snapshot/'1_Trajectories'/before[0]['design']) or p.is_relative_to(snapshot/'native-predictions'))]
    changed={**original,'max_trajectories':2,'resume':True}
    continuation=settings_path.with_name('recovery-resume.json');write(continuation,changed)
    status=campaign(continuation)
    after=list(csv.DictReader(table.open()))
    if status or len(after)!=2 or after[0]!=before[0]:raise ValueError('Native finite continuation changed prior outcome or attempt bound')
    for old in retained:
        new=folder/old.relative_to(snapshot)
        with old.open('rb') as a,new.open('rb') as b:
            while True:
                x=a.read(1024*1024);y=b.read(1024*1024)
                if x!=y:raise ValueError('Native continuation overwrote a prior unique result')
                if not x:break
    write(folder/'resume-check.json',{'initial_attempts':len(before),'continued_attempts':len(after),
        'prior_unique_files':len(retained),'every_prior_unique_byte_equal':True,'prior_rows':before,
        'original_settings':original,'explicit_continuation_settings':changed,'scientific_replay':False})

CIF_TOLERANCE = 0.00051
IDENTITY_FIELDS = ('chain_id', 'res_id', 'res_name', 'atom_name')


def array_difference(expected: np.ndarray, actual: np.ndarray) -> dict:
    """Report exact stored values; the caller supplies the acceptance decision."""
    expected, actual = np.asarray(expected), np.asarray(actual)
    result = {'expected_shape': list(expected.shape), 'actual_shape': list(actual.shape),
              'expected_dtype': str(expected.dtype), 'actual_dtype': str(actual.dtype)}
    if expected.shape != actual.shape:
        return {**result, 'equal': False, 'reason': 'shape', 'first_difference': None, 'maximum_absolute_difference': None}
    result['equal'] = expected.dtype == actual.dtype and np.array_equal(expected, actual, equal_nan=True)
    delta = actual.astype(np.float64) - expected.astype(np.float64)
    finite = np.isfinite(delta)
    result['nonfinite_delta_count'] = int((~finite).sum())
    def entry(index: object) -> dict:
        index = tuple(int(i) for i in index)
        def value(array: np.ndarray) -> float | str:
            number = float(array[index])
            return number if np.isfinite(number) else str(number)
        return {'index': list(index), 'expected': value(expected), 'actual': value(actual),
                'signed_actual_minus_expected': value(delta)}
    changed = np.argwhere(~np.isclose(expected, actual, rtol=0, atol=0, equal_nan=True))
    result['first_difference'] = entry(changed[0]) if len(changed) else None
    if np.isinf(delta).any() or finite.any():
        maximum = (tuple(np.argwhere(np.isinf(delta))[0]) if np.isinf(delta).any() else
                   np.unravel_index(np.where(finite, np.abs(delta), -1).argmax(), delta.shape))
        result['maximum_absolute_difference'] = entry(maximum)
        magnitude = float(abs(delta[maximum]))
        result['maximum_absolute_difference']['absolute_delta'] = magnitude if np.isfinite(magnitude) else str(magnitude)
    else:
        result['maximum_absolute_difference'] = None
    return result


def prediction_arrays(predictions: dict) -> dict:
    result = {}
    for state, prediction in predictions.items():
        for chain, protein in prediction.protein_complex.items():
            for field in fields(Protein):
                result[f'{state}/{chain}/{field.name}'] = np.asarray(getattr(protein, field.name))
        for metric, value in prediction.metrics.items():
            result[f'{state}/metrics/{metric}'] = np.asarray(value)
    return result


def saved_prediction_arrays(path: Path) -> dict:
    record = json.loads(path.with_suffix('.json').read_text())
    result = {}
    with np.load(path.with_suffix('.npz'), allow_pickle=False) as arrays:
        for state, prediction in record['predictions'].items():
            for chain, protein in prediction['proteins'].items():
                for field, key in protein.items():
                    result[f'{state}/{chain}/{field}'] = arrays[key]
            for metric, key in prediction['metrics'].items():
                result[f'{state}/metrics/{metric}'] = arrays[key]
    return result


def compare_prediction_layer(path: Path, predictions: dict, arrays: dict, label: str) -> dict:
    expected, actual = saved_prediction_arrays(path), prediction_arrays(predictions)
    comparisons = []
    for name in sorted(set(expected) | set(actual)):
        if name not in expected or name not in actual:
            comparisons.append({'field': name, 'equal': False, 'reason': 'field coverage'})
            continue
        keys = []
        for value in (expected[name], actual[name]):
            key = f'array{len(arrays)}'; arrays[key] = value; keys.append(key)
        comparisons.append({'field': name, 'arrays': keys, **array_difference(expected[name], actual[name])})
    return {'layer': label, 'baseline': str(path), 'status': 'equal' if all(x['equal'] for x in comparisons) else 'different',
            'comparison_tolerance': 0, 'fields': comparisons}


def monomer_failure_context(folder: Path, candidate: str, matching: list,
                            predictions: dict, monomer: dict) -> tuple[dict, dict]:
    arrays, layers = {}, []
    for item in matching:
        layers.append(compare_prediction_layer(item[5], item[2], arrays, 'saved_raw_prediction/'+item[0]['model']))
    reconstructed_order = [item[0]['model'] for item in matching]
    root = folder/'2_Refolded/NativeEvidence'/candidate
    manifests = sorted(root.glob('export-*/export.json'))
    context = {'candidate': candidate, 'reconstructed_ensemble_member_order': reconstructed_order,
               'raw_call_files_in_order': [str(item[5]) for item in matching],
               'raw_comparison': 'saved NPZ fields against the current decoder; no new native inference',
               'native_export_member_order': None, 'layers': layers, 'cause': 'undetermined',
               'baseline_status': 'available' if len(manifests) == 1 else 'missing' if not manifests else 'ambiguous',
               'baseline_candidates': [str(path) for path in manifests]}
    baseline = json.loads(manifests[0].read_text()) if len(manifests) == 1 else None
    if baseline is not None and baseline['state'] == 'complete':
        directory = manifests[0].parent
        by_model = {item[0]['model']: item[2] for item in matching}
        for index, model in enumerate(baseline['ensemble_member_order']):
            if model in by_model:
                layers.append(compare_prediction_layer(directory/f'member-{index}', by_model[model],
                              arrays, 'saved_raw_prediction_at_native_export/'+model))
            else:
                layers.append({'layer': 'saved_raw_prediction_at_native_export/'+model,
                               'status': 'different', 'reason': 'native export member absent from reconstructed ensemble'})
        context['native_export_member_order'] = baseline['ensemble_member_order']
        ensemble = compare_prediction_layer(directory/'ensemble', predictions, arrays, 'reconstructed_ensemble')
        if baseline['ensemble_member_order'] != reconstructed_order:
            ensemble.update(status='different', member_order_equal=False)
        layers.append(ensemble)
        written = [item for item in baseline['written'] if item['path'] == 'BinderMonomer/'+candidate+'_monomer.cif']
        if len(written) == 1:
            layers.append(compare_prediction_layer(directory/written[0]['snapshot'],
                          {'written': StructurePrediction(monomer, {})},
                          arrays, 'binder_alignment'))
        else:
            layers.append({'layer': 'binder_alignment', 'status': 'unavailable', 'reason': 'native aligned export snapshot missing or ambiguous'})
    else:
        if baseline is not None:
            context['baseline_status'] = 'incomplete'
        layers.extend({'layer': name, 'status': 'unavailable',
                       'reason': 'native export snapshot missing, incomplete or ambiguous; reconstruction cannot supply that baseline'}
                      for name in ('saved_raw_prediction_at_native_export', 'reconstructed_ensemble', 'binder_alignment'))
    first = next((x for x in layers if x['status'] != 'equal'), None)
    context['first_divergent_layer'] = (first['layer'] if first and first['status'] == 'different'
                                        else 'undetermined' if first else 'serialized_cif')
    context['first_observed_difference'] = next((x['layer'] for x in layers if x['status'] == 'different'), 'serialized_cif')
    return context, arrays


def compare_cif(path: Path, complex: dict, design: object, *, context=None) -> None:
    expected = build_atom_array(complex, receptor_chains=receptor_chain_layouts(design))
    actual = load_structure(path)
    model_count = actual.stack_depth() if isinstance(actual, AtomArrayStack) else 1
    if isinstance(actual, AtomArrayStack):
        actual = actual[0]
    identities = {name: {'expected_shape': list(getattr(expected, name).shape),
                         'actual_shape': list(getattr(actual, name).shape),
                         'expected_dtype': str(getattr(expected, name).dtype),
                         'actual_dtype': str(getattr(actual, name).dtype),
                         'equal': np.array_equal(getattr(expected, name), getattr(actual, name))}
                  for name in IDENTITY_FIELDS}
    identities_equal = all(item['equal'] for item in identities.values())
    coordinates_equal = expected.coord.shape == actual.coord.shape and np.allclose(expected.coord, actual.coord, rtol=0, atol=CIF_TOLERANCE)
    if model_count == 1 and identities_equal and coordinates_equal:
        return
    details, arrays = {'first_divergent_layer': 'undetermined', 'cause': 'undetermined',
                       'reason': 'no upstream layer baselines supplied'}, {}
    if context is not None:
        try:
            details, arrays = context()
        except Exception as error:
            details['context_error'] = type(error).__name__+': '+str(error)
    report = {'cif': str(path), 'tolerance_angstrom': CIF_TOLERANCE, 'rtol': 0,
              'model_count': model_count, 'identities': identities,
              'coordinate_difference': array_difference(expected.coord, actual.coord), **details}
    for name in ('coord', *IDENTITY_FIELDS):
        for side, atom_array in (('expected', expected), ('actual', actual)):
            key = side+'_'+name; arrays[key] = np.asarray(getattr(atom_array, name))
    if expected.coord.shape == actual.coord.shape:
        arrays['signed_coordinate_delta_float64'] = actual.coord.astype(np.float64)-expected.coord.astype(np.float64)
        failing = np.argwhere(~np.isclose(expected.coord, actual.coord, rtol=0, atol=CIF_TOLERANCE))
        def vector(value: np.ndarray) -> list:
            return [float(number) if np.isfinite(number) else str(float(number)) for number in value]
        def atom_entry(index: object) -> dict | None:
            if index is None:
                return None
            atom, axis = (int(i) for i in index)
            return {'atom_index': atom, 'axis': 'xyz'[axis],
                    'expected_identity': {name: getattr(expected, name)[atom].item() for name in IDENTITY_FIELDS},
                    'actual_identity': {name: getattr(actual, name)[atom].item() for name in IDENTITY_FIELDS},
                    'expected_coordinates': vector(expected.coord[atom]), 'actual_coordinates': vector(actual.coord[atom]),
                    'signed_delta': vector(arrays['signed_coordinate_delta_float64'][atom])}
        summary = report['coordinate_difference']
        report['first_failing_coordinate'] = atom_entry(failing[0] if len(failing) else None)
        report['first_different_coordinate'] = atom_entry(summary['first_difference']['index'] if summary['first_difference'] else None)
        maximum = summary['maximum_absolute_difference']
        report['maximum_delta_coordinate'] = atom_entry(maximum['index'] if maximum else None)
    report['coordinate_pairing'] = 'same atom identities' if identities_equal else 'row indices only; identities differ'
    number = 1
    while True:
        report_path = path.with_name(path.name+f'.failure-{number:04d}.json')
        try:
            stream = report_path.open('x')
            break
        except FileExistsError:
            number += 1
    arrays_path = report_path.with_suffix('.arrays.npz')
    report['array_file'] = arrays_path.name
    with arrays_path.open('xb') as output:
        np.savez(output, **arrays)
    with stream:
        json.dump(report, stream, indent=2, allow_nan=False, default=lambda value: np.asarray(value).tolist())
        stream.write('\n')
    raise ValueError(f'CIF comparison failed at unchanged {CIF_TOLERANCE} Å: {path}; evidence {report_path}')

def observed_pose(snapshot: Path, provenance: str) -> dict:
    record, states, predictions = load_native(snapshot)
    if record.get('provenance') != provenance or states or set(predictions) != {'written'}:
        raise ValueError('Invalid observed native written-pose snapshot: '+str(snapshot))
    return predictions['written'].protein_complex


def rigid_quantization_relation(upstream: dict, written: dict, source: str) -> dict:
    """Independently check one proper rigid motion at the saved output precision.

    Every resolved pair must preserve distance within the sum of its two output
    rounding radii. A float32 arithmetic allowance covers native centering,
    3-term matrix products and rotation roundoff. This does not change CIF atol.
    A proper-rotation fit additionally excludes reflection. No native alignment
    function or previously aligned reconstruction is used by this check.
    """
    report = {'source': source, 'status': 'unresolved',
              'method': 'all resolved pair distances plus independent proper rigid fit',
              'quantization': 'half adjacent output ULP per coordinate; source values are exact saved inputs',
              'float32_allowance': '64*eps32*(max absolute input + max absolute output + input diameter bound)'}
    if not source or set(upstream) != set(written):
        return {**report, 'reason': 'Named upstream pose and exact chain coverage required'}
    before, after, radii = [], [], []
    for chain in sorted(upstream):
        left, right = upstream[chain], written[chain]
        for field in fields(Protein):
            x, y = np.asarray(getattr(left, field.name)), np.asarray(getattr(right, field.name))
            if x.shape != y.shape or x.dtype != y.dtype:
                return {**report, 'reason': 'Upstream shape/dtype differs: '+chain+'/'+field.name}
            if field.name != 'atoms' and not np.array_equal(x, y, equal_nan=True):
                return {**report, 'reason': 'Upstream identity/non-coordinate field differs: '+chain+'/'+field.name}
        mask = np.asarray(left.atom_mask, dtype=bool)
        x, y = np.asarray(left.atoms), np.asarray(right.atoms)
        if not np.issubdtype(y.dtype, np.floating) or not np.isfinite(x).all() or not np.isfinite(y).all():
            return {**report, 'reason': 'Finite floating coordinates required'}
        # Native masks unresolved atoms to zero during a transform.
        if np.any(y[~mask] != 0):
            return {**report, 'reason': 'Unresolved written atoms are not zero'}
        low = np.nextafter(y, np.full_like(y, -np.inf)).astype(np.float64)
        high = np.nextafter(y, np.full_like(y, np.inf)).astype(np.float64)
        half_ulp = np.maximum(y.astype(np.float64)-low, high-y.astype(np.float64))/2
        before.append(x[mask].astype(np.float64))
        after.append(y[mask].astype(np.float64))
        radii.append(np.linalg.norm(half_ulp[mask], axis=-1))
    x, y, radius = np.concatenate(before), np.concatenate(after), np.concatenate(radii)
    if len(x) < 4 or not np.isfinite(radius).all():
        return {**report, 'reason': 'Insufficient finite resolved atoms'}
    xc, yc = x-x.mean(0), y-y.mean(0)
    if np.linalg.matrix_rank(xc) < 3:
        return {**report, 'reason': 'Degenerate upstream pose cannot establish handedness'}
    u, _, vt = np.linalg.svd(xc.T @ yc)
    unconstrained_determinant = float(np.linalg.det(u @ vt))
    rotation = u @ np.diag([1.0, 1.0, np.sign(unconstrained_determinant)]) @ vt
    diameter_bound = 2*float(np.max(np.linalg.norm(xc, axis=-1)))
    arithmetic = 64*np.finfo(np.float32).eps*(float(np.max(np.abs(x)))+
        float(np.max(np.abs(y)))+diameter_bound)
    allowance = radius+arithmetic
    max_pair_excess = -float('inf')
    # All pairs, in bounded blocks, including cross-chain pairs.
    for offset in range(0, len(x), 128):
        a = np.linalg.norm(x[offset:offset+128, None, :]-x[None, :, :], axis=-1)
        b = np.linalg.norm(y[offset:offset+128, None, :]-y[None, :, :], axis=-1)
        excess = np.abs(a-b)-(allowance[offset:offset+128, None]+allowance[None, :])
        max_pair_excess = max(max_pair_excess, float(np.max(excess)))
    residual = np.linalg.norm(xc @ rotation-yc, axis=-1)
    # Fitting quantized observations can move a rigid fit by their rounding
    # error; the two maximum radii bound that extra fit error conservatively.
    fit_bound = allowance+2*float(np.max(allowance))
    fit_excess = float(np.max(residual-fit_bound))
    passed = max_pair_excess <= 0 and fit_excess <= 0 and unconstrained_determinant > 0
    return {**report, 'status': 'passed' if passed else 'unresolved', 'resolved_atoms': len(x),
            'pair_count': len(x)*(len(x)-1)//2, 'maximum_pair_excess_angstrom': max_pair_excess,
            'maximum_proper_fit_excess_angstrom': fit_excess,
            'maximum_output_rounding_radius_angstrom': float(np.max(radius)),
            'float32_arithmetic_allowance_angstrom': arithmetic,
            'unconstrained_rotation_determinant': unconstrained_determinant,
            'rotation': rotation.tolist(), 'translation': (y.mean(0)-x.mean(0) @ rotation).tolist()}


def compare_observed_cif(path: Path, reconstructed: dict, design: object,
                         snapshot: Path, *, aligned: bool, provenance: str,
                         upstream: dict | None = None, upstream_source: str | None = None) -> dict:
    """Serialization and independent scientific lineage must both pass."""
    pose = observed_pose(snapshot, provenance)
    arrays = {}
    comparison = compare_prediction_layer(snapshot,
        {'written': StructurePrediction(reconstructed, {})}, arrays, 'independent_pose_reconstruction')
    differences = [item for item in comparison['fields'] if not item['equal']]
    coordinate_only = all(item['field'].endswith('/atoms')
        and item.get('expected_shape') == item.get('actual_shape')
        and item.get('expected_dtype') == item.get('actual_dtype')
        and item.get('nonfinite_delta_count') == 0 for item in differences)
    if aligned and upstream is not None and upstream_source and coordinate_only:
        lineage = rigid_quantization_relation(upstream, pose, upstream_source)
    elif not aligned and not differences and upstream is not None and upstream_source:
        direct = prediction_arrays({'written': StructurePrediction(upstream, {})})
        observed = prediction_arrays({'written': StructurePrediction(pose, {})})
        equal = set(direct) == set(observed) and all(
            direct[key].shape == observed[key].shape and direct[key].dtype == observed[key].dtype
            and np.array_equal(direct[key], observed[key], equal_nan=True) for key in direct)
        lineage = {'source': upstream_source, 'status': 'passed' if equal else 'unresolved',
                   'method': 'exact saved unaligned upstream pose'}
    else:
        lineage = {'source': upstream_source, 'status': 'unresolved',
                   'reason': 'Named saved upstream relation unavailable or non-coordinate fields differ'}
    # Strict serialization may succeed while the independent relation remains
    # unresolved. Keep both outcomes in a durable report before failing closed.
    compare_cif(path, pose, design)
    result = {'cif': str(path), 'snapshot': str(snapshot), 'strict_CIF': 'passed',
              'scientific_lineage': lineage, 'reconstructed_pose': comparison['status'],
              'aligned': aligned, 'differing_fields': [item['field'] for item in differences],
              'CIF_tolerance_angstrom': CIF_TOLERANCE, 'rtol': 0}
    number = 1
    while path.with_name(path.name+f'.reconstruction-{number:04d}.json').exists():
        number += 1
    report = path.with_name(path.name+f'.reconstruction-{number:04d}.json')
    if differences:
        paired = {key: arrays[key] for item in differences for key in item.get('arrays', [])}
        np.savez(report.with_suffix('.arrays.npz'), **paired)
    write(report, {**comparison, **result})
    if lineage['status'] != 'passed':
        raise ValueError('Scientific written-pose lineage unresolved: '+str(report))
    return result


def campaign_export_reference(folder: Path, path: Path) -> Path | None:
    root = folder/'NativeStructureEvidence'
    if not root.exists():
        return None  # Historical campaigns may predate observation; never invent a baseline.
    matches = []
    for manifest in root.glob('export-*/export.json'):
        record = json.loads(manifest.read_text())
        if record['path'] == str(path.relative_to(folder)):
            if (record.get('state') != 'complete'
                    or record.get('provenance') != 'observed_native_structure_write'
                    or record.get('additional_predictions') != 0 or record.get('additional_alignments') != 0):
                raise ValueError('Incomplete or invalid native write observation: '+str(manifest))
            matches.append(manifest.parent/'written')
    if len(matches) != 1:
        raise ValueError('Native CIF write observation missing or ambiguous: '+str(path))
    return matches[0]


def refold_export_reference(folder: Path, candidate: str, matching: list,
                            predictions: dict) -> tuple[Path | None, dict]:
    manifests = sorted((folder/'2_Refolded/NativeEvidence'/candidate).glob('export-*/export.json'))
    if not manifests:
        return None, {'baseline': 'missing; independent reconstruction remains required'}
    if len(manifests) != 1:
        raise ValueError('Ambiguous native refold export baseline: '+candidate)
    manifest = manifests[0]
    record = json.loads(manifest.read_text())
    order = [item[0]['model'] for item in matching]
    if (record.get('state') != 'complete' or record.get('candidate') != candidate
            or record.get('prediction_state') != matching[0][4] or record.get('additional_predictions') != 0
            or record.get('additional_alignments') != 0 or record['ensemble_member_order'] != order):
        raise ValueError('Native export completion/member order differs: '+candidate)
    comparisons = []
    def require_states(snapshot: Path, expected: dict) -> None:
        _, actual, _ = load_native(snapshot)
        if set(actual) != set(expected):
            raise ValueError('Native export input-state coverage differs')
        for state, complex in expected.items():
            if set(actual[state]) != set(complex):
                raise ValueError('Native export input-chain coverage differs')
            for chain, protein in complex.items():
                for field in fields(Protein):
                    left, right = np.asarray(getattr(protein, field.name)), np.asarray(getattr(actual[state][chain], field.name))
                    if left.dtype != right.dtype or not np.array_equal(left, right, equal_nan=True):
                        raise ValueError('Native export input-state field differs: '+state+'/'+chain+'/'+field.name)
    for index, item in enumerate(matching):
        comparisons.append(compare_prediction_layer(item[5], item[2], {}, 'raw_decoder/'+order[index]))
        member = manifest.parent/f'member-{index}'
        metadata = json.loads(member.with_suffix('.json').read_text())
        if metadata.get('provenance') != 'observed_native_export' or metadata.get('model') != order[index]:
            raise ValueError('Invalid native raw-member observation: '+str(member))
        require_states(member, item[1])
        comparisons.append(compare_prediction_layer(member, item[2], {}, 'native_member/'+order[index]))
    ensemble = manifest.parent/'ensemble'
    metadata = json.loads(ensemble.with_suffix('.json').read_text())
    if metadata.get('provenance') != 'observed_native_export' or metadata.get('ensemble_member_order') != order:
        raise ValueError('Invalid native ensemble observation: '+str(ensemble))
    require_states(ensemble, matching[0][1])
    comparisons.append(compare_prediction_layer(ensemble, predictions, {}, 'native_ensemble'))
    if any(item['status'] != 'equal' for item in comparisons):
        raise ValueError('Raw/member/ensemble native lineage differs: '+candidate)
    return manifest.parent, {'baseline': 'observed_native_export', 'raw_member_ensemble_exact': True,
                             'input_states_exact': True, 'ensemble_member_order': order}


def refold_written_reference(directory: Path, path: Path, folder: Path) -> Path:
    record = json.loads((directory/'export.json').read_text())
    matches = [item for item in record['written'] if item['path'] == str(path.relative_to(folder/'2_Refolded'))]
    if len(matches) != 1:
        raise ValueError('Native refold written-pose snapshot missing or ambiguous: '+str(path))
    snapshot = directory/matches[0]['snapshot']
    if not snapshot.is_relative_to(directory) or snapshot.parent != directory:
        raise ValueError('Invalid native snapshot path')
    return snapshot


def campaign_structure_checks(output: Path, scientific_audits: list[dict]) -> list[dict]:
    linked = {item['cif'] for audit in scientific_audits for item in audit.get('CIF_reference_checks', [])
              if item['scientific_lineage']['status'] == 'passed'}
    audits = []
    for root in output.glob('campaigns/*/NativeStructureEvidence'):
        folder = root.parent
        written_paths = set()
        for manifest in root.glob('export-*/export.json'):
            record = json.loads(manifest.read_text())
            path = folder/record['path']
            snapshot = campaign_export_reference(folder, path)
            if path.suffix.lower() != '.cif':
                continue
            design = build_design_settings(json.loads(snapshot.with_suffix('.json').read_text())['settings'])
            compare_cif(path, observed_pose(snapshot, 'observed_native_structure_write'), design)
            if str(path) not in linked:
                write(path.with_name(path.name+'.lineage-unresolved.json'), {'strict_CIF': 'passed',
                    'scientific_lineage': 'unresolved', 'reason': 'No independently checked saved upstream pose'})
                raise ValueError('Observed writer serialization alone does not establish scientific lineage: '+str(path))
            written_paths.add(path)
        for manifest in (folder/'2_Refolded/NativeEvidence').glob('*/export-*/export.json'):
            record = json.loads(manifest.read_text())
            if record.get('state') != 'complete':
                raise ValueError('Incomplete native refold export')
            written_paths.update(folder/'2_Refolded'/item['path'] for item in record['written'])
        actual = set(folder.rglob('*.cif'))
        if actual != written_paths:
            raise ValueError('Native campaign CIF observation coverage differs: '+str(folder))
        audits.append({'campaign': str(folder.relative_to(output)), 'all_CIF_writes_observed': True,
                       'CIF_files': len(actual), 'trajectory_and_ranking_CIF_files':
                       sum(1 for path in actual if '2_Refolded' not in path.relative_to(folder).parts)})
    return audits


def compare_csv(row,expected):
    for name,value in recorded_row(expected).items():
        if name not in row:raise ValueError('Native CSV metric missing: '+name)
        if value is None:
            if row[name]!='':raise ValueError('Unavailable native CSV value changed: '+name)
        elif isinstance(value,(float,int)):
            if float(row[name])!=float(value):raise ValueError('Native numeric CSV value differs: '+name)
        elif row[name]!=str(value):raise ValueError('Native CSV identity/per-state value differs: '+name)

def initial_fixed_check(record,states,design):
    if record.get('provenance')=='independent_native_stage_diagnostic':
        key=jax.random.PRNGKey(record['settings'].get('campaign_seed',7));targets=None
    else:
        key=np.asarray(record['random_key'],dtype=np.uint32)
        _,targets=native_campaign.sampled_trajectory_values(design,key)
    initial,_,_=initialize_design_trajectory(design,jax.random.split(key)[0],targets)
    fixed_count=0
    for state,complex in initial.items():
        if state not in states or set(complex)!=set(states[state]):raise ValueError('Initial/final chain mapping changed')
        for chain,p in complex.items():
            final=states[state][chain];fixed=(np.asarray(p.flags)&int(ResidueFlags.DESIGN))==0
            if len(p)!=len(final) or not np.array_equal(np.asarray(p.residue_index),np.asarray(final.residue_index)):raise ValueError('Initial/final residue identity changed')
            if not np.array_equal(np.asarray(p.sequence).argmax(-1)[fixed],np.asarray(final.sequence).argmax(-1)[fixed]):raise ValueError('Originally fixed native sequence changed during design')
            fixed_count+=int(fixed.sum())
    return fixed_count

def campaign_checks(output):
    audits=[]
    for table in output.rglob('1_Trajectories/!_Trajectories.csv'):
        rows=list(csv.DictReader(table.open()));folder=table.parent.parent
        if not rows:
            audits.append({'campaign':str(folder.relative_to(output)),'terminal_trajectories':0,'status':'incomplete'})
            continue
        if len(rows)>2:raise ValueError('Campaign exceeded the declared finite attempt bound')
        for row in rows:
            directory=table.parent/row['design'];record,states,predictions=load_native(directory/'native')
            if record['design']!=row['design'] or (record['terminated'] or '')!=row['terminated']:raise ValueError('Campaign trajectory identity/termination differs')
            design=build_design_settings(record['settings']);stage=row['terminated'] or 'final'
            original_fixed=initial_fixed_check(record,states,design)
            decision,metrics=evaluate_design_filters(design_stage_filters(design,states,stage),states,predictions)
            final_result,final_metrics=evaluate_design_filters(design_stage_filters(design,states,'final',campaign_filters=design.filters),states,predictions)
            if not row['terminated'] and decision is not True:raise ValueError('Completed native campaign fails its saved final stage gate')
            if not row['terminated']:
                scored=native_campaign.scored_trajectory_metrics(design,states,predictions)
                compare_csv(row,target_ordered_row(scored,weighted_target_order(design.prepared_states)))
            primary=next(name for name in target_state_names(design) if name in predictions)
            framed=states_holding_the_frame({name:state for name,state in states.items() if name!=BINDER_ALONE},frame_holding_target(design),design.target_chain_prefix)
            suffixes=accepted_state_suffixes(design.prepared_states,predictions)
            cif_checks=[]
            for state,prediction in predictions.items():
                suffix='_monomer' if state==BINDER_ALONE else suffixes.get(state,'')
                complex=prediction.protein_complex if state==primary or state in framed else superposed_on_binder(prediction.protein_complex,predictions[primary].protein_complex)
                path=Path(trajectory_output_path(str(directory),'trajectory'+suffix+'.cif'))
                snapshot=campaign_export_reference(folder,path)
                if snapshot is None:
                    compare_cif(path,complex,design)
                else:
                    cif_checks.append(compare_observed_cif(path,complex,design,snapshot,
                        aligned=state!=primary and state not in framed,provenance='observed_native_structure_write',
                        upstream=prediction.protein_complex,upstream_source=str(directory/'native')+'#'+state))
            audits.append({'campaign':str(folder.relative_to(output)),'trajectory':row['design'],
                'native_terminated':record['terminated'],'native_stage_result':decision,'native_stage_metrics':metrics,
                'filter_reproduces_termination':decision is not True if row['terminated'] else None,
                'native_full_final_filter_result':final_result,'native_full_final_metrics':final_metrics,
                'original_fixed_sequence_residues':original_fixed,'cif_structures':len(predictions),'CIF_reference_checks':cif_checks,
                'settings':record['settings'],'states':{name:{chain:len(p) for chain,p in complex.items()} for name,complex in states.items()}})
    return audits

def redesign_checks(output):
    audits=[]
    tables=[(p,p.parent,True) for p in output.rglob('candidates.csv')
            if 'redesign' in p.relative_to(output).parts]
    tables.extend((p,p.parent.parent,False) for p in output.rglob('campaigns/*/2_Refolded/!_Refolded.csv'))
    for table,folder,diagnostic in tables:
        rows=list(csv.DictReader(table.open()))
        if not diagnostic and len(rows)>20:raise ValueError('Native campaign exceeded finite redesign bound')
        array_folder=folder if diagnostic else folder/'native-predictions'
        saved=[(p.with_suffix(''),load_native(p.with_suffix(''))) for p in sorted(array_folder.glob('prediction*.json'),key=lambda p:int(p.stem.removeprefix('prediction')))]
        proposal_stop = None
        if diagnostic:
            if not saved:
                raise ValueError('Native redesign predictions are missing')
            settings = saved[0][1][0]['settings']
            candidate_bound = settings.get('sequence_candidates', DEFAULT_SETTINGS['sequence_candidates'])
            accepted_limit = settings.get('enough_passing_sequences', DEFAULT_SETTINGS['enough_passing_sequences']) or candidate_bound
            if not 1 <= len(rows) <= candidate_bound:
                raise ValueError('Native MPNN proposal count exceeds its saved bounds')
            accepted_at = [index + 1 for index, row in enumerate(rows) if row['outcome'] == 'passed']
            expected_count = accepted_at[accepted_limit - 1] if len(accepted_at) >= accepted_limit else candidate_bound
            if len(rows) != expected_count:
                raise ValueError('Native MPNN proposals lack the saved acceptance or exhaustion stopping decision')
            outcome = json.loads((folder/'outcome.json').read_text())
            kept_limit = settings.get('kept_sequences', DEFAULT_SETTINGS['kept_sequences'])
            if (outcome['candidate_bound'] != candidate_bound
                    or outcome['native_filter_passes'] != len(accepted_at)
                    or outcome['native_kept_sequences'] != min(len(accepted_at), kept_limit)):
                raise ValueError('Saved redesign outcome disagrees with native proposal rows')
            proposal_stop = {'candidate_bound': candidate_bound, 'observed_candidates': len(rows),
                'accepted_sequence_limit': accepted_limit, 'accepted_candidates': len(accepted_at),
                'reason': 'accepted_sequence_limit' if len(accepted_at) >= accepted_limit else 'candidate_bound'}
        for row in rows:
            matching=[]
            for source_path,(record,states,predictions) in saved:
                design=build_design_settings(record['settings']);primary=next(name for name in states if name!=BINDER_ALONE)
                selected=select_design_and_validation_models(record['settings'],MULTIMER_POOL,MONOMER_POOL)
                if record.get('model') not in selected.validation_models:continue
                if binder_chain_sequences(predictions[primary].protein_complex,design.designed_binder_chain)==row['Binder_Sequence']:
                    matching.append((record,states,predictions,design,primary,source_path))
            if not 1<=len(matching)<=2:raise ValueError('Native proposal/model mapping is missing or ambiguous')
            record,states,_,design,primary,_=matching[0]
            models={item[0]['model']:item[2] for item in matching}
            if len(models)!=len(matching):raise ValueError('Duplicate native validation model')
            selected=select_design_and_validation_models(record['settings'],MULTIMER_POOL,MONOMER_POOL)
            if set(models)-set(selected.validation_models) or set(models)&set(selected.design_models):raise ValueError('Validation model was not held out')
            predictions=ensemble_mean_predictions(states,models)
            filters=design_stage_filters(design,states,'final',campaign_filters=design.filters)
            decision,metrics=evaluate_design_filters(filters,states,predictions)
            metrics.update(decoded_sequence_metrics(states[primary],design.designed_binder_chain))
            early=[]
            for item in matching:
                confidence,_=evaluate_design_filters(confidence_stage_filters(filters),item[1],item[2])
                if confidence is not True:early=list(confidence);break
            if len(models)<len(selected.validation_models) and not early and not checks_out_of_reach(filters,states,models,len(selected.validation_models)):raise ValueError('Incomplete native ensemble lacks a stopping decision')
            failures=early or ([] if decision is True else list(decision))
            if row['failed_filters']!=','.join(failures) or row['outcome']!=('rejected' if failures else 'passed'):raise ValueError('Native confidence-first decision differs')
            compare_csv(row,metrics)
            compare_csv(row,design_sequence_report(predictions,prediction_state=primary,binder=design.designed_binder_chain,
                target=design.target_chain_prefix+'_'+primary,receptor_chains=receptor_chain_layouts(design)))
            pdae=interface_pdae_metric(states,predictions,prediction_state=primary,binder=design.designed_binder_chain,target=design.target_chain_prefix+'_'+primary)
            compare_csv(row,{'i_pDAE':pdae})
            baseline,lineage=refold_export_reference(folder,row['design'],matching,predictions)
            if baseline is not None and json.loads((baseline/'export.json').read_text())['failed_filters']!=failures:
                raise ValueError('Observed native export filter decision differs')
            suffixes=accepted_state_suffixes(design.prepared_states,predictions)
            framed=states_holding_the_frame({name:state for name,state in states.items() if name!=BINDER_ALONE},frame_holding_target(design),design.target_chain_prefix)
            cif_checks=[]
            for state,prediction in predictions.items():
                if state==BINDER_ALONE:continue
                aligned=state!=primary and state not in framed
                complex=superposed_on_binder(prediction.protein_complex,predictions[primary].protein_complex) if aligned else prediction.protein_complex
                path=folder/'2_Refolded/Complexes'/(row['design']+suffixes.get(state,'' if state==primary else '_'+state)+'.cif')
                if baseline is None:
                    compare_cif(path,complex,design)
                else:
                    cif_checks.append(compare_observed_cif(path,complex,design,refold_written_reference(baseline,path,folder),
                        aligned=aligned,provenance='observed_native_export',upstream=prediction.protein_complex,
                        upstream_source=str(baseline/'ensemble')+'#'+state))
            if BINDER_ALONE in predictions:
                monomer=superposed_on_binder(predictions[BINDER_ALONE].protein_complex,predictions[primary].protein_complex)
                path=folder/'2_Refolded/BinderMonomer'/(row['design']+'_monomer.cif')
                if baseline is None:
                    compare_cif(path,monomer,design,context=lambda: monomer_failure_context(folder,row['design'],matching,predictions,monomer))
                else:
                    cif_checks.append(compare_observed_cif(path,monomer,design,refold_written_reference(baseline,path,folder),
                        aligned=True,provenance='observed_native_export',upstream=predictions[BINDER_ALONE].protein_complex,
                        upstream_source=str(baseline/'ensemble')+'#'+BINDER_ALONE))
            audits.append({'scope':'explicit diagnostic' if diagnostic else 'native campaign','variant':folder.name,'candidate':row['design'],'native_failed_filters':failures,
                'native_proposal_stop':proposal_stop,
                'native_full_filter_result':decision,'native_metrics':metrics,'i_pDAE':pdae,'models':list(models),
                'cif_structures':len(predictions),'native_export_lineage':lineage,'CIF_reference_checks':cif_checks,
                **({'campaign_promoted':False} if diagnostic else {'native_outcome':row['outcome']})})
    return audits

def check(output):
    checked=[]; structures=0;fixed_residues=0;decisions=[];final_audits=[];fasta_audits=[];flank_audits=[]
    input_formats={}
    fixtures=output/'fixtures'
    if (fixtures/'PDL1.pdb').exists() and (fixtures/'PDL1.cif').exists():
        pdb=load_structure(fixtures/'PDL1.pdb');cif=load_structure(fixtures/'PDL1.cif')
        for field in ['chain_id','res_id','res_name','atom_name']:
            if not np.array_equal(getattr(pdb,field),getattr(cif,field)):raise ValueError('PDB/mmCIF input identity differs: '+field)
        if not np.array_equal(pdb.coord,cif.coord):raise ValueError('PDB/mmCIF input coordinates differ')
        input_formats={'atoms':len(pdb),'all_atom_identities_and_coordinates_equal':True}
    for path in output.rglob('*.npz'):
        if not path.with_suffix('.json').exists(): continue
        record,states,predictions=load_native(path.with_suffix(''))
        for complex in [*states.values(),*(p.protein_complex for p in predictions.values())]:
            for p in complex.values():
                n=len(p)
                if p.atoms.shape!=(n,len(record['atom_names']),3) or p.atom_mask.shape!=(n,len(record['atom_names'])): raise ValueError('Atom shape differs')
                if p.flags.shape!=(n,) or p.residue_index.shape!=(n,): raise ValueError('Residue mapping differs')
                if not np.isfinite(np.asarray(p.atoms)[np.asarray(p.atom_mask,dtype=bool)]).all(): raise ValueError('Resolved coordinate is unavailable')
        for state,prediction in predictions.items():
            if state in states:
                for chain,p in prediction.protein_complex.items():
                    if chain not in states[state]:raise ValueError('Prediction chain mapping differs')
                    original=states[state][chain]
                    fixed=(np.asarray(original.flags)&int(ResidueFlags.DESIGN))==0
                    if len(original)!=len(p) or not np.array_equal(np.asarray(original.residue_index),np.asarray(p.residue_index)):raise ValueError('Prediction residue mapping differs')
                    if not np.array_equal(np.asarray(original.sequence).argmax(-1)[fixed],np.asarray(p.sequence).argmax(-1)[fixed]):raise ValueError('Fixed native sequence changed')
                    fixed_residues+=int(fixed.sum())
            cif=path.parent/(path.stem+'-'+state+'.cif')
            if cif.exists():
                design=build_design_settings(record['settings'])
                compare_cif(cif,prediction.protein_complex,design)
                structures+=1
        stage=record.get('stage')
        if stage:
            design=build_design_settings(record['settings'])
            original_fixed=initial_fixed_check(record,states,design)
            decision,metrics=evaluate_design_filters(design_stage_filters(design,states,stage),states,predictions)
            failure=[] if decision is True else list(decision)
            if 'native_failed_filters' in record and failure!=record['native_failed_filters']:raise ValueError('Native stage decision changed')
            if 'native_terminated' in record and (bool(failure)!=(record['native_terminated'] is not None)):raise ValueError('Native mutation decision changed')
            decisions.append({'path':str(path.relative_to(output)),'stage':stage,'native_failed_filters':failure,
                'metrics':metrics,'original_fixed_sequence_residues':original_fixed})
        if 'settings' in record:
            design=build_design_settings(record['settings'])
            for target in design.prepared_states:
                if not target.path or Path(target.path).suffix.lower() not in ['.fasta','.fa','.faa'] or target.name not in states:continue
                original=Protein.from_fasta(target.path,target.chains or 'A')
                actual=states[target.name][target.target_chain]
                mapping=dict(zip(np.asarray(original.residue_index).tolist(),np.asarray(original.sequence).argmax(-1).tolist()))
                expected=np.asarray([mapping[int(index)] for index in np.asarray(actual.residue_index)])
                if not np.array_equal(expected,np.asarray(actual.sequence).argmax(-1)):raise ValueError('FASTA crop/flank residue mapping changed')
                fasta_audits.append({'path':str(path.relative_to(output)),'state':target.name,
                    'source_length':len(original),'actual_length':len(actual),'source_residue_indices':np.asarray(actual.residue_index).tolist()})
            if record.get('trajectory_seed') is not None and any(target.path and Path(target.path).suffix.lower() in ['.fasta','.fa','.faa'] for target in design.prepared_states):
                expanded=validation_target_states(design,{name:state for name,state in states.items() if name!=BINDER_ALONE},record['trajectory_seed'])
                for target in design.prepared_states:
                    if not target.path or Path(target.path).suffix.lower() not in ['.fasta','.fa','.faa'] or target.name not in expanded:continue
                    original=Protein.from_fasta(target.path,target.chains or 'A');actual=expanded[target.name][target.target_chain]
                    mapping=dict(zip(np.asarray(original.residue_index).tolist(),np.asarray(original.sequence).argmax(-1).tolist()))
                    expected=np.asarray([mapping[int(index)] for index in np.asarray(actual.residue_index)])
                    if not np.array_equal(expected,np.asarray(actual.sequence).argmax(-1)):raise ValueError('Native FASTA validation-flank mapping changed')
                    flank_audits.append({'path':str(path.relative_to(output)),'state':target.name,'design_length':len(states[target.name][target.target_chain]),
                        'validation_length':len(actual),'source_residue_indices':np.asarray(actual.residue_index).tolist(),
                        'operation':'native validation target preparation only; no held-out prediction or campaign promotion'})
        if record.get('provenance') in ['native_explicit_diagnostic_prediction','direct_native_reference','explicit_native_redesign_diagnostic']:
            design=build_design_settings(record['settings'])
            filters=design_stage_filters(design,states,'final',campaign_filters=design.filters)
            decision,metrics=evaluate_design_filters(filters,states,predictions)
            primary=next(name for name in states if name!=BINDER_ALONE)
            pdae=interface_pdae_metric(states,predictions,prediction_state=primary,
                binder=design.designed_binder_chain,target=design.target_chain_prefix+'_'+primary)
            final_audits.append({'path':str(path.relative_to(output)),'native_final_filter_result':decision,
                'native_metrics':metrics,'i_pDAE':pdae,'model':record.get('model'),
                'effective_filters':{name:{'threshold':value.threshold,'higher':value.higher,
                    'mandatory':value.mandatory,'required_states':sorted(value.required_states)} for name,value in filters.items()}})
        checked.append(str(path.relative_to(output)))
    if not checked: raise ValueError('No complete native arrays')
    campaign_audits=campaign_checks(output);redesign_audits=redesign_checks(output)
    observed_structure_audits=campaign_structure_checks(output,[*campaign_audits,*redesign_audits])
    all_structures=structures+sum(row.get('cif_structures',0) for row in [*campaign_audits,*redesign_audits])
    report_path=output/'array-check.json'
    number=1
    while report_path.exists():
        report_path=output/f'array-check-recheck-{number:04d}.json';number+=1
    write(report_path,{'native_array_files':len(checked),'checked':checked,'cif_structures':all_structures,
        'standalone_cif_structures':structures,
        'cif_coordinate_tolerance_angstrom':.00051,'fixed_residues':fixed_residues,
        'native_stage_decisions':decisions,'native_final_filter_audits':final_audits,
        'campaign_audits':campaign_audits,'redesign_audits':redesign_audits,'fasta_identity_audits':fasta_audits,
        'fasta_validation_preparation_audits':flank_audits,
        'observed_structure_audits':observed_structure_audits,'structure_input_format_check':input_formats})
    print('Native atom/residue arrays and finite resolved coordinates passed:',len(checked))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('operation',choices=['campaign','resume','stages','predictions','redesign','check']);p.add_argument('path',type=Path);p.add_argument('--output',type=Path);p.add_argument('--model',choices=MULTIMER_POOL)
    p.add_argument('--variant',choices=['negative','neutral'],help='One explicit redesign diagnostic; default audits both variants')
    a=p.parse_args()
    if a.operation=='campaign': raise SystemExit(campaign(a.path))
    elif a.operation=='resume': resume(a.path)
    elif a.operation=='stages': stages(a.path,a.output,a.model)
    elif a.operation=='predictions': predictions(a.path,a.output)
    elif a.operation=='redesign': redesign(a.path,a.output,(a.variant,) if a.variant else ('negative','neutral'))
    else: check(a.path)
