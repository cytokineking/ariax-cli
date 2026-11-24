"""Run the pinned upstream template preprocessor before an explicit prediction."""
import argparse,json,runpy
from pathlib import Path
import biotite.structure.info
p=argparse.ArgumentParser();p.add_argument('--query-json',required=True,type=Path);p.add_argument('--output-json',required=True,type=Path);p.add_argument('--work-dir',required=True,type=Path);p.add_argument('--structure-directory',required=True,type=Path);a=p.parse_args()
a.work_dir.mkdir(parents=True,exist_ok=False)
biotite.structure.info.set_ccd_path('/models/openfold3/ccd/components.bcif')
config={'template_preprocessor_settings':{'structure_directory':str(a.structure_directory),'output_directory':str(a.work_dir/'metadata'),'cache_directory':str(a.work_dir/'cache'),'create_logs':True,'log_directory':str(a.work_dir/'logs')}}
runner=a.work_dir/'runner.yaml';runner.write_text(json.dumps(config,indent=2)+'\n')
upstream_output=a.work_dir/'upstream-processed-query.json'
module=runpy.run_path('/opt/openfold3/scripts/data_preprocessing/preprocess_template_alignments_new_of3.py')
module['main'].main(args=['--input_set_path',str(a.query_json),'--output_set_path',str(upstream_output),'--input_set_type','predict','--runner_yaml',str(runner)],standalone_mode=False)
# Native direct-CIF preprocessing adds the cache path but retains fields that
# the native input validator declares mutually exclusive. Keep its raw JSON.
value=json.loads(upstream_output.read_text())
for query in value['queries'].values():
    for chain in query['chains']:
        if chain.get('template_alignment_file_path') and chain.get('template_cif_paths'):
            chain['template_cif_paths']=None;chain['template_cif_chain_ids']=None
a.output_json.write_text(json.dumps(value,indent=2)+'\n')
print('Native preprocessed query:',a.output_json)
