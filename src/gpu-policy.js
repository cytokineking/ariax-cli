/** Minimum availability policy for the public protein-design protocols. */
import { EXIT } from './exit-codes.js';
import { printProgress } from './output.js';
import { protocolId } from './structure-input.js';

const CORE = Object.freeze({
  bindcraft: ['H100', 'A100_80GB', 'L40', 'L40S', 'RTX6000PRO'],
  bindcraft2: ['H100', 'A100_80GB', 'L40', 'L40S', 'RTX6000PRO'],
  boltzgen: ['H100', 'A100_80GB', 'L40', 'L40S', 'RTX6000PRO'],
  pxdesign: ['H100', 'A100_80GB', 'L40', 'L40S'],
  'esmfold2-pipeline': ['H100', 'A100_80GB', 'RTX6000PRO'],
});

// Match the server's documented preference aliases for the core classes.
export function canonicalGpu(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().toUpperCase().replaceAll('-', '_');
  const aliases = {
    A100: 'A100_80GB', A10080GB: 'A100_80GB', A100_80G: 'A100_80GB',
    A10040GB: 'A100_40GB', A100_40G: 'A100_40GB',
    RTXPRO6000: 'RTX6000PRO', RTX_PRO6000: 'RTX6000PRO',
    'RTX PRO 6000': 'RTX6000PRO',
  };
  return aliases[name] ?? name;
}

function policyError(protocol, allowed, core, action, reason) {
  const error = new Error(`${reason} for ${protocol}. ${action}`);
  error.code = 'gpu_policy_validation';
  error.exitCode = EXIT.VALIDATION;
  error.action = action;
  error.details = { field: 'allowed_gpus', allowed_gpus: allowed, core_gpus: core };
  return error;
}

/** Check an explicit policy or the effective live schema default. Never changes the payload. */
export async function checkGpuPolicy(ctx, spec, { source = 'job', saved = false, advise = true } = {}) {
  const protocol = protocolId(spec?.protocol);
  if (!protocol) return;
  const core = CORE[protocol];
  const action = saved
    ? `Use ariax gpu-preferences <project-id> -f preferences.json to save an authorized policy containing a compatible core GPU (${core.join(', ')}) before restart.`
    : `Choose at least one compatible core GPU from ${core.join(', ')} within the user's memory and hourly budget constraints; do not add a GPU or broaden an existing policy without authorization.`;
  let allowed = spec.allowed_gpus;
  if (!Object.hasOwn(spec, 'allowed_gpus')) {
    const slug = protocol === 'bindcraft' ? 'bindcraft-v1.5' : protocol;
    const response = await ctx.client.get(`/api/v1/protocols/${encodeURIComponent(slug)}/schema`);
    const metadata = response.data?.schema ?? response.data;
    allowed = metadata?.json_schema?.properties?.allowed_gpus?.default;
    if (!Array.isArray(allowed)) {
      const error = new Error(`The live ${protocol} schema did not provide an allowed_gpus default; no ${source} request was sent.`);
      error.exitCode = EXIT.SERVER;
      throw error;
    }
  }
  if (!Array.isArray(allowed) || allowed.length === 0 || allowed.some((item) => typeof item !== 'string' || !item.trim())) {
    throw policyError(protocol, allowed, core, action, `${source}: allowed_gpus must be a nonempty array of GPU names`);
  }
  const selected = new Set(allowed.map(canonicalGpu));
  if (!core.some((gpu) => selected.has(gpu))) {
    throw policyError(protocol, allowed, core, action, `${source}: allowed_gpus has no compatible core GPU`);
  }
  if (advise && selected.size === 1) {
    printProgress(`GPU availability advisory: ${source} allows only ${[...selected][0]}. Consider all compatible GPU classes within the authorized memory and hourly budget limits to improve availability; priority_mode ranks choices, while Turbo and GPU count are separate settings. No GPU capacity is guaranteed.`);
  }
}

/** Read the saved allocation policy and protocol before changing or restarting it. */
export async function projectGpuPolicy(ctx, projectId) {
  const response = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  const project = response.data?.project ?? response.data;
  if (!project || typeof project !== 'object' || Array.isArray(project) || typeof (project.protocol ?? project.protocol_id) !== 'string') {
    const error = new Error('Project detail did not provide a protocol; no GPU policy mutation was sent.');
    error.exitCode = EXIT.SERVER;
    throw error;
  }
  return { ...project, protocol: project.protocol ?? project.protocol_id };
}
