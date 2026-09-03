/** Replace a project's saved GPU policy for its next provisioning attempt. */
import { usageError } from '../args.js';
import { printJson, printKv, printProgress } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { readJsonFile } from './validate.js';

export async function run(ctx) {
  if (ctx.positionals.length !== 1) throw usageError('gpu-preferences: expected one project UUID or exact unique name.');
  const unknown = Object.keys(ctx.flags).find((flag) => flag !== 'file');
  if (unknown) throw usageError(`gpu-preferences: unknown flag --${unknown}`);
  const file = ctx.flags.file;
  if (typeof file !== 'string' || !file) throw usageError('gpu-preferences: provide -f preferences.json.');
  const body = readJsonFile(file);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw usageError('gpu-preferences: preferences file must contain a JSON object.');
  }
  const projectId = await resolveProjectId(ctx.client, ctx.positionals[0]);
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
