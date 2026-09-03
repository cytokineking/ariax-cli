/**
 * `ariax restart <project-id> [--wait]`
 * Restart with an internally generated request identifier.
 */
import { printData, printJson, printProgress } from '../output.js';
import { usageError } from '../args.js';
import { resolveProjectId } from '../resolve.js';
import { waitAndReport } from './submit.js';
import { accountIdentity, createOperation, sendOperation, waitForOperation } from '../operations.js';

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean, config: { rootDir: string } }} ctx */
export async function run(ctx) {
  const { flags } = ctx;
  const operand = ctx.positionals[0];
  if (!operand) throw usageError('restart: missing <project-id> (UUID or exact unique project name).');
  const projectId = await resolveProjectId(ctx.client, String(operand));
  const operation = createOperation(ctx, {
    action: 'project:restart', account: await accountIdentity(ctx),
    request: { method: 'POST', path: `/api/v1/projects/${encodeURIComponent(projectId)}/restart`, body: {} },
  });
  const res = await sendOperation(ctx, operation);
  const d = res.data?.project ?? res.data ?? {};
  if (ctx.json) {
    if (flags.wait !== true) {
      printJson({ data: res.data, meta: { ...res.meta, local_operation_id: operation.id }, request_id: res.requestId });
    }
  } else {
    printData(`project_id: ${d.id ?? projectId}`);
    printData(`status: ${d.status ?? d.state ?? 'restart accepted'}`);
  }
  if (flags.wait === true) {
    if (operation.state === 'in_progress') await waitForOperation(ctx, operation);
    printProgress(`Restart accepted for ${projectId}; waiting…`);
    return waitAndReport(ctx, projectId, operation);
  }
  return { projectId, operationId: operation.id };
}
