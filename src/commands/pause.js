/** `ariax pause <project-id>` — state-idempotent pause. */
import { printData, printJson, printProgress } from '../output.js';
import { usageError } from '../args.js';
import { resolveProjectId } from '../resolve.js';

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean }} ctx */
export async function run(ctx) {
  const operand = ctx.positionals[0];
  if (!operand) throw usageError('pause: missing <project-id> (UUID or exact unique project name).');
  const projectId = await resolveProjectId(ctx.client, String(operand));
  const res = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/pause`);
  const d = res.data?.project ?? res.data ?? {};
  if (ctx.json) {
    printJson({ data: res.data, meta: res.meta, request_id: res.requestId });
    return;
  }
  printData(`project_id: ${d.id ?? projectId}`);
  printData(`status: ${d.status ?? d.state ?? 'pause requested'}`);
  printProgress(`request-id: ${res.requestId || '-'}`);
}
