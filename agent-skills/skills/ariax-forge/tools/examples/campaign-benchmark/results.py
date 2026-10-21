"""Join explicit completed-call records for deterministic saved-result reporting."""
import argparse
from datetime import datetime
from pathlib import Path
from benchmark import read, resolve, write, number


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('root',type=Path)
    p.add_argument('--search-run',required=True)
    p.add_argument('--qc-run',required=True)
    p.add_argument('--qc-result',required=True)
    p.add_argument('--measurements',help='Saved sanitized cold-preparation/VM-interval record list')
    p.add_argument('--inclusive-hourly-usd',type=float)
    p.add_argument('--quote-source',help='Saved sanitized quote/hardware record, relative to root')
    p.add_argument('--out',type=Path,required=True)
    a = p.parse_args()
    root = a.root.resolve(strict=True)
    if a.out.exists():
        raise ValueError('Use a new results record')
    search = read(resolve(root,a.search_run))
    qc = read(resolve(root,a.qc_run))
    resolve(root,a.qc_result)
    measurements = []
    for operation, record in [('database_search',search),('backbone_qc',qc)]:
        row = {k: record.get(k) for k in ('command_id','elapsed_seconds','basis','submitted_candidates',
                                         'completed_candidates','submitted_chain_queries','cost_usd','cost_kind')}
        row['operation'] = operation
        row['outcome'] = record.get('outcome','completed_QC_checks')
        if a.inclusive_hourly_usd is not None:
            rate = number(a.inclusive_hourly_usd)
            if rate<=0 or not a.quote_source:
                raise ValueError('Positive inclusive quote and its saved source required')
            quote = read(resolve(root,a.quote_source))
            if number(quote['inclusive_hourly_usd']) != rate:
                raise ValueError('Per-call estimate differs from its saved inclusive quote')
            row.update(cost_usd=number(row['elapsed_seconds'])*rate/3600,
                       cost_kind='allocation_prorated_estimate',cost_source=a.quote_source,
                       cost_definition='Full VM rate times the recorded native-operation interval; complete executable timing requires command observations.')
        measurements.append(row)
    if a.measurements:
        for extra in read(resolve(root,a.measurements)):
            matches=[r for r in measurements if r.get('command_id')==extra.get('command_id') and r['operation']==extra['operation']] if extra.get('command_id') else []
            if matches:
                if len(matches)!=1 or set(extra)-{'operation','command_id','resource_observations','resource_source','command_elapsed_seconds','command_started_at','command_finished_at','timing_definition'}:raise ValueError('Resource join may only add observations to one exact native command')
                if extra.get('resource_source'):resolve(root,extra['resource_source'])
                row=matches[0]
                if 'command_elapsed_seconds' in extra:
                    source=read(resolve(root,extra['resource_source']))
                    if source['command_id']!=extra['command_id'] or source['container_execution']!={k:extra[k] for k in ('command_elapsed_seconds','command_started_at','command_finished_at','timing_definition')}:raise ValueError('Complete-call timing differs from exact command observation')
                    elapsed=number(extra['command_elapsed_seconds'])
                    observed=(datetime.fromisoformat(extra['command_finished_at'])-datetime.fromisoformat(extra['command_started_at'])).total_seconds()
                    if elapsed<=0 or elapsed!=observed or elapsed<number(row['elapsed_seconds']):raise ValueError('Invalid complete executable interval')
                    row['native_operation_elapsed_seconds']=row['elapsed_seconds'];row['elapsed_seconds']=elapsed
                    if a.inclusive_hourly_usd is not None:row['cost_usd']=elapsed*rate/3600
                    row['cost_definition']='Full selected VM quote times Docker StartedAt-to-FinishedAt execution interval; image preparation and caller polling are separate.'
                row.update(extra)
            else:measurements.append(extra)
    write(a.out,{'search': search,'qc_file': a.qc_result,'qc_command_id': qc['command_id'],
                 'search_run':a.search_run,'qc_run':a.qc_run,'quote_source':a.quote_source,
                 'measurement_records_source':a.measurements,
                 'measurements': measurements})


if __name__ == '__main__':
    main()
