"""Regenerate bounded campaign tables from retained native files, without inference."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import itertools
import json
import math
from pathlib import Path
import re

AMINO_ACIDS = set('ACDEFGHIKLMNPQRSTVWY')
FAMILIES = {'boltzgen': 'boltz', 'boltz2': 'boltz', 'boltz2-accelerated': 'boltz',
            'rf3': 'rf3', 'rf3_preprint_124': 'rf3', 'rf3_preprint_921': 'rf3',
            'protenix': 'protenix', 'abodybuilder2': 'immunebuilder'}


def read(path: Path):
    return json.loads(path.read_text())


def write(path: Path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n')


def resolve(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or Path(name).is_absolute():
        raise ValueError('Use a relative file under the saved benchmark root')
    relative = Path(name)
    if '..' in relative.parts:
        raise ValueError('Traversal in saved input path')
    path = root / relative
    if any(p.is_symlink() for p in [path, *path.parents] if p.is_relative_to(root)):
        raise ValueError('Saved inputs must be regular files')
    path = path.resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Saved input must be a regular file under the root')
    return path


def number(value):
    if isinstance(value, bool):
        raise ValueError('Boolean is not a numeric measurement')
    value = float(value)
    if not math.isfinite(value):
        raise ValueError('Nonfinite measurement')
    return value


def native_value(campaign: Path, score):
    path = resolve(campaign, score['source'])
    if score.get('column') is not None:
        # Use the original manifest for candidate-to-CSV matching below.
        return None
    value = read(path)
    for key in score.get('keys') or []:
        value = value[key]
    if value != score['value']:
        raise ValueError('Saved score differs from its native source: ' + score['source'])
    return value


def prepare(root: Path, plan, campaign_name: str, shortlists_name: str, out: Path):
    heads = plan.get('accepted_b70_heads')
    if not isinstance(heads, dict) or set(heads) != {'runtime', 'backend', 'cli'} or not all(
            isinstance(v, str) and re.fullmatch('[0-9a-f]{40}', v) for v in heads.values()):
        raise ValueError('Freeze the coordinator-accepted B70 heads before preparation')
    campaign = (root / campaign_name).resolve(strict=True)
    if not campaign.is_relative_to(root):
        raise ValueError('Campaign directory must be inside the benchmark root')
    original = read(resolve(campaign, 'campaign.json'))
    rows = read(resolve(root, shortlists_name))['candidates']
    index = {(r['path'], r['id']): r for r in rows}
    if len(index) != len(rows):
        raise ValueError('Duplicate candidate in B70 saved shortlist')
    selected = []
    queries = []
    qc_inputs = []
    if len(plan['cohort']) != 3 or Counter(c['path'] for c in plan['cohort']) != {'minibinder': 2, 'antibody': 1}:
        raise ValueError('The finite benchmark requires two minibinders and one antibody')
    if len({(c['path'],c['id']) for c in plan['cohort']}) != 3:
        raise ValueError('The finite cohort needs distinct explicit candidate identities')
    for spec in plan['cohort']:
        row = index[(spec['path'], spec['id'])]
        state = row['states'][spec['state']]
        raw = [r for r in original['candidates'] if (r['path'], r['id']) == (row['path'], row['id'])]
        if len(raw) != 1 or raw[0]['native_decision'] != row['native_decision'] or raw[0]['generation'] != row['generation']:
            raise ValueError('Shortlist changed the original native decision or generation record')
        if raw[0]['states'][spec['state']]['chains'] != state['chains']:
            raise ValueError('Shortlist changed the native molecule identity')
        for role in spec['query_roles']:
            chain = state['chains'][role]
            if chain['kind'] != 'protein' or chain['sequence'] != spec['expected_sequences'][role]:
                raise ValueError('Frozen candidate sequence changed: ' + spec['id'] + '/' + role)
            if not chain['sequence'] or set(chain['sequence']) - AMINO_ACIDS:
                raise ValueError('Expected canonical nonempty protein sequence')
            queries.append({'query': 'q%03d' % (len(queries) + 1), 'candidate': row['id'],
                            'path': row['path'], 'role': role, 'sequence': chain['sequence']})
        originals = raw[0]['states'][spec['state']]['observations']
        if len(originals) != len(state['observations']):
            raise ValueError('Shortlist omitted a native observation')
        for observation, source in zip(state['observations'], originals):
            expected = FAMILIES.get(observation['model_family'])
            if expected is None or observation['family'] != expected or source['model_family'] != observation['model_family']:
                raise ValueError('Invalid predictor-family identity')
            if observation['task'] != source['task'] or observation['native_rank'] != source.get('native_rank'):
                raise ValueError('Shortlist changed the native task or rank')
            if read(resolve(campaign, source['run_record'])) != observation['run_record']:
                raise ValueError('Saved run record differs from native provenance')
            resolve(campaign, observation['structure'])
            if observation['structure'] != source['structure'] or set(source['scores']) != set(observation['scores']):
                raise ValueError('Shortlist changed native structure or score fields')
            for name, score in observation['scores'].items():
                if score['source'] != source['scores'][name]['file'] or any(
                        score.get(k) != source['scores'][name].get(k) for k in ('units', 'direction', 'keys', 'column')):
                    raise ValueError('Shortlist changed native score meaning')
                if score.get('column') is not None:
                    match = source['scores'][name]['match']
                    with resolve(campaign, score['source']).open(newline='') as stream:
                        native_rows = [r for r in csv.DictReader(stream) if all(r.get(k) == v for k,v in match.items())]
                    if len(native_rows) != 1 or native_rows[0][score['column']] != score['value']:
                        raise ValueError('CSV score differs from exact native candidate')
                else:
                    native_value(campaign, score)
        for comparison in state['comparisons']:
            families = comparison['families']
            suitable = {o['family'] for o in state['observations'] if o['task'] == comparison['task']}
            if len(families) != 2 or len(set(families)) != 2 or not set(families).issubset(suitable):
                raise ValueError('Pose comparison requires two observed same-task families')
            if comparison.get('review_threshold_angstrom') != plan['qc']['pose_review_angstrom']:
                raise ValueError('Pose review cutoff changed from the frozen plan')
            rmsd = comparison['rmsd_angstrom']
            expected_agreement = None if rmsd is None else number(rmsd) <= plan['qc']['pose_review_angstrom']
            if comparison.get('pose_agreement') != expected_agreement:
                raise ValueError('Saved agreement differs from its raw RMSD and declared cutoff')
        qc = [o for o in originals if o['model_family'] == spec['qc_model_family']]
        if len(qc) != 1:
            raise ValueError('QC needs one declared same-candidate native structure')
        qc_inputs.append({'candidate': row['id'], 'path': row['path'],
                          'structure': str(Path(campaign_name) / qc[0]['structure']),
                          'chain_map': {r: qc[0]['chains'][r] for r in spec['query_roles']},
                          'sequences': spec['expected_sequences']})
        selected.append({'spec': spec, 'row': row})
    selection = {'schema': 'campaign-benchmark-v1', 'plan': plan,
          'campaign': campaign_name, 'shortlists': shortlists_name, 'selected': selected,
          'queries': queries, 'excluded': [{'path': r['path'], 'id': r['id'],
          'native_decision': r['native_decision']} for r in rows if (r['path'], r['id']) not in
          {(c['path'], c['id']) for c in plan['cohort']}]}
    if out is None:
        return selection
    if out.exists():
        raise ValueError('Use a fresh preparation directory')
    out.mkdir(parents=True)
    write(out / 'selection.json', selection)
    write(out / 'qc-input.json', qc_inputs)
    (out / 'queries.fasta').write_text(''.join('>' + q['query'] + '\n' + q['sequence'] + '\n' for q in queries))


def edit_distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j-1] + (left != right)))
        previous = current
    return previous[-1]


def table(out: Path, name: str, rows, columns):
    write(out / (name + '.json'), rows)
    with (out / (name + '.tsv')).open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, delimiter='\t', lineterminator='\n')
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(row.get(k), sort_keys=True, allow_nan=False)
                             if isinstance(row.get(k), (dict,list)) else row.get(k) for k in columns})



def input_closure(root: Path, selection_name: str, results_name: str, selection, results):
    """List the complete saved native closure using ordinary paths and sizes."""
    files={resolve(root,selection_name),resolve(root,results_name)}
    folders=[root/selection['campaign'],resolve(root,selection['shortlists']).parent,
             resolve(root,selection_name).parent]
    if results.get('qc_file'):folders.append(resolve(root,results['qc_file']).parent)
    search=results.get('search',{})
    if search.get('metadata_file'):folders.append(resolve(root,search['metadata_file']).parent)
    for key in ('search_run','qc_run','measurement_records_source','quote_source'):
        if results.get(key):files.add(resolve(root,results[key]))
    for measurement in results.get('measurements',[]):
        if measurement.get('cost_source'):files.add(resolve(root,measurement['cost_source']))
    for folder in folders:
        if any(p.is_symlink() for p in [folder,*folder.parents] if p.is_relative_to(root)):
            raise ValueError('Input closure requires ordinary saved directories')
        folder=folder.resolve(strict=True)
        if not folder.is_relative_to(root):raise ValueError('Input closure leaves the saved root')
        for path in folder.rglob('*'):
            if path.is_symlink():raise ValueError('Input closure requires regular saved files')
            if path.is_file():files.add(resolve(root,str(path.relative_to(root))))
    return [{'path':str(p.relative_to(root)),'size_bytes':p.stat().st_size} for p in sorted(files)]


def report(root: Path, selection_name: str, results_name: str, out: Path):
    selection = read(resolve(root, selection_name))
    plan = selection['plan']
    if prepare(root, plan, selection['campaign'], selection['shortlists'], None) != selection:
        raise ValueError('Selection differs from original retained files')
    results = read(resolve(root, results_name))
    closure = input_closure(root, selection_name, results_name, selection, results)
    candidates = []
    scores = []
    qc_rows = []
    agreement = []
    diversity = []
    assays = []
    qc_result = read(resolve(root, results['qc_file'])) if results.get('qc_file') else []
    qc_index = {r['candidate']: r for r in qc_result}
    if len(qc_index) != len(qc_result) or set(qc_index) - {s['row']['id'] for s in selection['selected']}:
        raise ValueError('Unexpected or duplicate QC candidate')
    for selected in selection['selected']:
        spec, row = selected['spec'], selected['row']
        state = row['states'][spec['state']]
        ident, path = row['id'], row['path']
        candidates.append({'candidate': ident, 'path': path, 'state': spec['state'],
                           'native_decision': row['native_decision'], 'generation': row['generation'],
                           'candidate_denominator': 2 if path == 'minibinder' else 1})
        qc_rows.append({'candidate': ident, 'path': path, 'criterion': 'canonical_frozen_sequence',
                        'passed': True, 'value': True, 'threshold': True, 'basis': 'B70 identity-checked saved output'})
        if path == 'minibinder':
            value = number(row['generation']['native_metrics']['GLU_fraction'])
            sequence = state['chains']['binder']['sequence']
            if abs(value - sequence.count('E') / len(sequence)) > 1e-8:
                raise ValueError('Native GLU fraction differs from the selected sequence')
            qc_rows.append({'candidate': ident, 'path': path, 'criterion': 'native_GLU_fraction',
                            'passed': value <= plan['qc']['minibinder_max_glu_fraction'], 'value': value,
                            'threshold': plan['qc']['minibinder_max_glu_fraction'], 'basis': 'retained native GLU fraction; lower passes'})
        q = qc_index.get(ident)
        if q is not None:
            if not isinstance(q['passed'],bool) or q['path'] != path:
                raise ValueError('QC requires an explicit boolean result for the same path')
            if q['passed'] and ({c['role']: c['sequence'] for c in q['chains']} != spec['expected_sequences'] or
                               any(c['backbone_fraction']!=1 or c['nonfinite_atoms'] or c['missing_atoms'] for c in q['chains'])):
                raise ValueError('QC pass differs from its saved sequence/backbone ledger')
        qc_rows.append({'candidate': ident, 'path': path, 'criterion': 'complete_finite_backbone',
                        'passed': q['passed'] if q is not None else None,
                        'value': q, 'threshold': plan['qc']['minimum_backbone_fraction'],
                        'basis': 'new N/CA/C/O check' if q is not None else 'unmeasured'})
        for obs in state['observations']:
            expected = FAMILIES.get(obs['model_family'])
            if expected != obs['family']:
                raise ValueError('Related models cannot become independent families')
            for name, value in obs['scores'].items():
                scores.append({'candidate': ident, 'path': path, 'family': expected,
                               'model': obs['run_record']['model'], 'score': name, **value,
                               'native_rank': obs['native_rank'], 'native_rank_context': obs['native_rank_context'],
                               'command_id': obs['run_record']['command_id'], 'basis': 'retained_B70_observation'})
        for comparison in state['comparisons']:
            if len(set(comparison['families'])) != 2:
                raise ValueError('Repeated family in pose comparison')
            agreement.append({'candidate': ident, 'path': path, 'state': spec['state'],
                              'basis': 'retained_B70_pose_comparison',
                              'comparison_denominator': len(state['comparisons']),
                              'family_denominator': len({o['family'] for o in state['observations'] if o['task']==comparison['task']}),
                              **comparison})
        if not state['comparisons']:
            agreement.append({'candidate': ident, 'path': path, 'state': spec['state'],
                              'reason': 'insufficient_same_task_distinct_families'})
        assays.append({'candidate': ident, 'path': path, **plan['assays'],
                       'experimental_endpoint': None, 'experimental_hit_rate': None})
    for candidate in candidates:
        checks = [r['passed'] for r in qc_rows if r['candidate'] == candidate['candidate']]
        qc_rows.append({'candidate': candidate['candidate'], 'path': candidate['path'],
                        'criterion': 'declared_joint_QC',
                        'passed': False if False in checks else None if None in checks else True,
                        'basis': 'Conjunction of path-specific declared checks; technical completeness for antibody, with experimental acceptance unmeasured.'})
    qc_summary = []
    for path, criterion in sorted({(r['path'],r['criterion']) for r in qc_rows}):
        group = [r for r in qc_rows if (r['path'],r['criterion']) == (path,criterion)]
        measured = [r for r in group if r['passed'] is not None]
        passed = sum(r['passed'] is True for r in measured)
        qc_summary.append({'path': path, 'criterion': criterion, 'selected': len(group),
                           'measured': len(measured), 'passed': passed, 'missing': len(group)-len(measured),
                           'fraction_of_measured': passed / len(measured) if measured else None,
                           'fraction_of_selected': passed / len(group) if len(measured) == len(group) else None})
    for path, role in sorted({(q['path'], q['role']) for q in selection['queries']}):
        group = [q for q in selection['queries'] if (q['path'],q['role']) == (path,role)]
        for a,b in itertools.combinations(group, 2):
            distance = edit_distance(a['sequence'],b['sequence'])
            diversity.append({'path': path, 'role': role, 'candidate_a': a['candidate'], 'candidate_b': b['candidate'],
                              'length_a': len(a['sequence']), 'length_b': len(b['sequence']),
                              'edit_distance': distance, 'normalized_edit_distance': distance / max(len(a['sequence']),len(b['sequence'])),
                              'exact_duplicate': a['sequence'] == b['sequence'], 'candidate_denominator': len(group), 'pair_denominator': len(group)*(len(group)-1)//2})
        if len(group) < 2:
            diversity.append({'path': path, 'role': role, 'candidate_denominator': len(group),
                              'pair_denominator': 0, 'reason': 'one_candidate_no_within_role_pair'})
    search = results.get('search', {'outcome': 'unmeasured'})
    if search['outcome'] not in ('succeeded','failed','unmeasured'):
        raise ValueError('Search needs an explicit terminal or unmeasured outcome')
    hits = []
    query_index = {q['query']: q for q in selection['queries']}
    if search['outcome'] == 'succeeded':
        if search['settings'] != plan['search'] or search['returncode'] != 0 or not search['command_id']:
            raise ValueError('Search provenance differs from the frozen native settings')
        resolve(root,search['native_log'])
        resolve(root,search['resources'])
        metadata = read(resolve(root, search['metadata_file']))
        if metadata['release'] != '2026_03' or metadata['representatives'] != 121494192:
            raise ValueError('Unexpected database snapshot')
        seen_hits = set()
        with resolve(root, search['tsv']).open(newline='') as stream:
            for fields in csv.reader(stream, delimiter='\t'):
                if len(fields) != len(plan['search']['columns']):
                    raise ValueError('Unexpected native TSV width')
                hit = dict(zip(plan['search']['columns'],fields))
                query = query_index[hit['query']]
                key = (hit['query'],hit['target'])
                if key in seen_hits:
                    raise ValueError('Duplicate native query/accession pair')
                seen_hits.add(key)
                if not hit['target'].startswith('UniRef90_'):
                    raise ValueError('Expected complete UniRef90 accession')
                for field in ('fident','qcov','tcov','evalue','bits'):
                    hit[field] = number(hit[field])
                if hit['fident'] + 0.00051 < plan['search']['min_identity'] or min(hit['qcov'],hit['tcov']) + 0.00051 < plan['search']['coverage'] or hit['evalue'] > plan['search']['evalue'] * 1.001:
                    raise ValueError('Native hit falls outside frozen cutoffs')
                if int(hit['qlen']) != len(query['sequence']):
                    raise ValueError('Search query accession/length mismatch')
                start, end = int(hit['qstart']), int(hit['qend'])
                if not 1 <= start <= end <= len(query['sequence']) or hit['qaln'].replace('-','') != query['sequence'][start-1:end]:
                    raise ValueError('Native aligned query differs from the exact chain sequence')
                if len(hit['qaln']) != len(hit['taln']) or len(hit['qaln']) != int(hit['alnlen']):
                    raise ValueError('Native aligned strings/length differ')
                hits.append({**hit, 'candidate': query['candidate'], 'role': query['role']})
    search_summary = []
    for query in selection['queries']:
        found = [h for h in hits if h['query'] == query['query']]
        search_summary.append({**query, 'hit_rows': len(found) if search['outcome']=='succeeded' else None,
                               'outcome': search['outcome'], 'settings': plan['search'],
                               'command_id': search.get('command_id'), 'query_denominator': len(query_index),
                               'max_seqs_prefilter_limit': 300, 'biological_novelty': 'unmeasured'})
    throughput = []
    for run in results.get('measurements', []):
        if run['basis'] not in ('retained_observation','new_complete_call','cold_preparation','recovery_consumer'):
            raise ValueError('Explicit measurement basis required')
        elapsed = None if run.get('elapsed_seconds') is None else number(run['elapsed_seconds'])
        if elapsed is not None and elapsed < 0:
            raise ValueError('Elapsed wall interval must be nonnegative')
        submitted = run['submitted_candidates']
        if not isinstance(submitted,int) or isinstance(submitted,bool) or submitted < 0:
            raise ValueError('Explicit candidate denominator required')
        cost = run.get('cost_usd')
        if cost is not None:
            cost = number(cost)
            if cost < 0 or run['cost_kind'] not in ('observed_VM_interval','allocation_prorated_estimate') or not run.get('cost_source'):
                raise ValueError('Cost needs a declared source and accounting interval')
            resolve(root,run['cost_source'])
        throughput.append({**run, 'cost_usd': cost,
                           'submitted_candidates_per_hour': submitted*3600/elapsed if elapsed and elapsed>0 else None,
                           'cost_per_submitted_candidate_usd': cost/submitted if cost is not None and submitted else None})
    for path in ('minibinder','antibody'):
        throughput.append({'path': path, 'operation': 'original_generation', 'basis': 'retained_observation',
                           'selected_candidates': 2 if path=='minibinder' else 1,
                           'submitted_candidates': None, 'elapsed_seconds': None,
                           'cost_usd': None, 'cost_kind': 'unavailable',
                           'reason': 'Selected B70 shortlist does not isolate complete original-generation time/cost; no generator rerun.'})
    if out.exists():
        raise ValueError('Use a fresh report directory')
    out.mkdir(parents=True)
    tables = {'candidates': candidates, 'throughput-cost': throughput, 'qc': qc_rows,
              'qc-fractions': qc_summary, 'sequence-diversity': diversity, 'database-hits': hits,
              'database-search': search_summary, 'family-agreement': agreement, 'native-scores': scores,
              'assays': assays, 'exclusions': selection['excluded']}
    for name, rows in tables.items():
        columns = sorted({k for row in rows for k in row})
        table(out,name,rows,columns or plan['search']['columns'])
    write(out / 'report.json', {'schema': 'campaign-benchmark-v1', 'plan': plan, 'tables': tables,
          'search_execution': search, 'qc_command_id': results.get('qc_command_id'),
          'input_closure': closure, 'report_files': [name+suffix for name in tables for suffix in ('.json','.tsv')]+['report.json','report.md'],
          'limits': 'Finite diagnostic selection after generation. Score scales remain native. No experimental hit rate, biological novelty or training-overlap inference.'})
    (out / 'report.md').write_text('# Bounded campaign benchmark\n\n'
        'Three preselected public candidates span two paths. All native decisions and raw score meanings remain in the tables. '
        'Timing uses each declared complete-call interval. Cost estimates identify their accounting source.\n\n'
        'QC fractions retain selected and measured denominators for each criterion. Sequence distances compare the same role within a path. '
        'Database hits refer to UniRef90 2026_03 and the saved settings. Assay endpoints remain unmeasured.\n\n'
        + '\n'.join('- [' + name + '](' + name + '.tsv)' for name in tables) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation',required=True)
    p = sub.add_parser('prepare')
    p.add_argument('root',type=Path)
    p.add_argument('--plan',type=Path,required=True)
    p.add_argument('--campaign',required=True)
    p.add_argument('--shortlists',required=True)
    p.add_argument('--out',type=Path,required=True)
    p = sub.add_parser('report')
    p.add_argument('root',type=Path)
    p.add_argument('--selection',required=True)
    p.add_argument('--results',required=True)
    p.add_argument('--out',type=Path,required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    if args.operation == 'prepare':
        prepare(root,read(args.plan),args.campaign,args.shortlists,args.out)
    else:
        report(root,args.selection,args.results,args.out)
    print(json.dumps({'operation': args.operation,'output': str(args.out)}))


if __name__ == '__main__':
    main()
