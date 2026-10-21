"""Compare complete native reference metrics across the target-mask correction."""
from pathlib import Path
import json,sys
import numpy as np
import pandas as pd
partial,original,patched=map(Path,sys.argv[1:])
def metrics(root):return pd.read_csv(next((root/'intermediate_designs').glob('aggregate_metrics_*.csv'))).sort_values('id').reset_index(drop=True)
a,b=metrics(original),metrics(patched)
pd.testing.assert_frame_equal(a,b,check_exact=True)
p=metrics(partial)
assert np.isfinite(p['seq_recovery']).all() and np.isfinite(p['native_rmsd']).all()
assert (p['native_rmsd']<=0.0006).all() and (p['native_rmsd_bb']<=0.0006).all()
columns=[c for c in p if 'lddt' in c];assert columns and all(np.isfinite(p[c]).all() for c in columns)
print(json.dumps({'full_reference_rows':len(a),'all_native_metric_columns':len(a.columns),'full_reference_before_after_exact':True,'partial_reference_rows':len(p),'partial_target_native_rmsd':p['native_rmsd'].tolist(),'partial_target_native_backbone_rmsd':p['native_rmsd_bb'].tolist(),'partial_reference_lddt_columns':columns,'no_inference_replay':True},indent=2))
