"""Record native CLI defaults and the unmet four-worker assignment requirement."""
import argparse
import json
from pathlib import Path
import yaml

p = argparse.ArgumentParser()
p.add_argument('root', type=Path)
p.add_argument('--report', type=Path, required=True)
a = p.parse_args()
names = [r['name'] for r in yaml.safe_load((a.root / 'steps.yaml').read_text())['steps']]
assert names == ['design', 'inverse_folding', 'folding', 'design_folding', 'analysis', 'filtering']
c = {n: yaml.safe_load((a.root / 'config' / f'{n}.yaml').read_text()) for n in names}
settings = {}
for n in names[:4]:
    x = c[n]
    workers = x['data'].get('num_workers', x['data'].get('cfg', {}).get('num_workers'))
    steps = 500 if n == 'design' else 200
    samples = 10 if n == 'design' else (1 if n == 'inverse_folding' else 5)
    assert x['sampling_steps'] == steps and x['recycling_steps'] == 3
    assert x['diffusion_samples'] == samples and workers == 1
    settings[n] = dict(sampling_steps=steps, recycling_steps=3,
                      diffusion_samples=samples, observed_loader_workers=workers)
assert c['analysis']['num_processes'] == 32
assert c['filtering']['budget'] == 30 and c['filtering']['top_budget'] == 10
report = dict(state='observed_native_cli_defaults', settings=settings,
              analysis_processes=32, budget=30, native_quality_export_budget=10,
              assignment_four_worker_requirement_met=False,
              correction='Explicit --num_workers 4 required on subsequent qualification')
a.report.parent.mkdir(parents=True, exist_ok=True)
a.report.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
