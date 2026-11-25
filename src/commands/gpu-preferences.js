/** Replace a project's saved GPU policy for its next provisioning attempt. */
import { usageError } from '../args.js';
import { printData, printJson, printKv, printProgress } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { readJsonFile } from './validate.js';
import { checkGpuPolicy, projectGpuPolicy } from '../gpu-policy.js';

export const GPU_PREFERENCES_EXAMPLE = Object.freeze({
  allowed_gpus: ['L40S', 'A100_80GB'],
  priority_mode: 'cost',
});

export const help = `ariax gpu-preferences PROJECT -f preferences.json | ariax gpu-preferences --example
  PROJECT accepts a project UUID or an exact unique project name.
  Fields:
    allowed_gpus   Nonempty array of GPU IDs containing at least one compatible core GPU.
    priority_mode  "speed" | "cost" | "balanced"
  Example JSON (also printable via \`ariax gpu-preferences --example\`):
    {"allowed_gpus":["L40S","A100_80GB"],"priority_mode":"cost"}`;

export async function run(ctx) {
  const unknown = Object.keys(ctx.flags).find((flag) => !['file', 'example'].includes(flag));
  if (unknown) throw usageError(`gpu-preferences: unknown flag --${unknown}`);
  if (ctx.flags.example === true) {
    if (ctx.positionals.length > 0 || ctx.flags.file !== undefined) {
      throw usageError('gpu-preferences: --example cannot be combined with PROJECT or -f.');
    }
    if (ctx.json) printJson({ data: GPU_PREFERENCES_EXAMPLE });
    else printData(JSON.stringify(GPU_PREFERENCES_EXAMPLE, null, 2));
    return;
  }
  if (ctx.positionals.length !== 1) throw usageError('gpu-preferences: expected one PROJECT (UUID or exact unique project name).');
  const file = ctx.flags.file;
  if (typeof file !== 'string' || !file) throw usageError('gpu-preferences: provide -f preferences.json (or pass --example for sample JSON).');
  const body = readJsonFile(file);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw usageError('gpu-preferences: preferences file must contain a JSON object.');
  }
  const projectId = await resolveProjectId(ctx.client, ctx.positionals[0]);
  const project = await projectGpuPolicy(ctx, projectId);
  await checkGpuPolicy(ctx, { protocol: project.protocol, allowed_gpus: body.allowed_gpus }, { source: 'gpu-preferences' });
  const res = await ctx.client.rawRequest('PUT', `/api/v1/projects/${encodeURIComponent(projectId)}/gpu-preferences`, { body });
  if (ctx.json) {
    printJson({ data: res.data, meta: res.meta, request_id: res.requestId });
  } else {
    const preferences = res.data || {};
    printKv({
      project_id: projectId,
      priority_mode: preferences.priority_mode,
      allowed_gpus: preferences.allowed_gpus?.join(', '),
      turbo_mode: preferences.turbo_mode,
      turbo_multiples: preferences.turbo_multiples?.join(', '),
    });
    printProgress('Saved preferences apply to the next GPU provisioning attempt. Active GPU instances are not changed.');
  }
}
