/** One durable whole-project deletion; waiting only observes the status route. */
import fs from 'node:fs';
import { usageError } from '../args.js';
import { resolveProjectId } from '../resolve.js';
import { isUUID } from '../uuid.js';
import { promptConfirm } from '../prompt.js';
import { printProgress } from '../output.js';
import { accountIdentity, createOperation, listOperations, loadOperation, operationFailure, operationPath, sendOperation, verifyAccount } from '../operations.js';
import { storageStatus, reportStorage, waitForStorage, storageWaitOptions } from '../storage.js';

export async function run(ctx) {
  if (ctx.flags.wait) storageWaitOptions(ctx);
  const operand = ctx.positionals[0];
  if (!operand) throw usageError('delete: provide a project UUID or exact unique name. Use a UUID for a deleted project.');
  const projectId = (await resolveProjectId(ctx.client, String(operand))).toLowerCase();
  const account = await accountIdentity(ctx);
  const requested = typeof ctx.flags['request-id'] === 'string' ? ctx.flags['request-id'].trim().toLowerCase() : ctx.flags['request-id'];
  if (requested !== undefined && !isUUID(requested)) throw usageError('delete: --request-id must be a UUID.');
  const route = `/api/v1/projects/${projectId}/delete`;
  let operation;
  if (requested && fs.existsSync(operationPath(ctx.config.rootDir, requested))) operation = loadOperation(ctx.config.rootDir, requested);
  if (!requested) {
    const uncertain = listOperations(ctx.config.rootDir).filter(item => item.action === 'project:delete'
      && item.request.path === route && item.state !== 'completed' && item.state !== 'failed'
      && item.api_origin === account.api_origin && item.actor_user_id === account.actor_user_id
      && item.billing_account_type === account.billing_account_type && item.billing_account_id === account.billing_account_id);
    if (uncertain.length > 1) throw usageError('Multiple saved deletion requests exist. Select the original with --request-id UUID.');
    operation = uncertain[0];
  }
  if (operation) {
    if (operation.action !== 'project:delete' || operation.request.path !== route) throw usageError('The request ID belongs to a different action or project.');
    await verifyAccount(ctx, operation);
    if (operation.state === 'failed') throw operationFailure(operation);
    printProgress(`Recovering the exact saved deletion request ${operation.id}.`);
  } else {
    const response = await ctx.client.get(`/api/v1/projects/${projectId}/storage`);
    const status = storageStatus(response.data, projectId);
    if (status.cleanup.kind === 'managed' && status.status !== 'deleted' && status.capabilities?.whole_project_delete?.allowed !== true) {
      throw usageError(`Project deletion is unavailable (${status.capabilities?.whole_project_delete?.reason ?? 'unknown'}). Abort active projects first.`);
    }
    if (!ctx.flags.yes) {
      if (!ctx.interactive || !ctx.input?.isTTY || !ctx.errorOutput?.isTTY) throw usageError('delete: pass --yes to confirm in noninteractive use.');
      const archives = status.cleanup.kind !== 'managed' ? ' Separately retained Forge archives are excluded.' : '';
      if (!await promptConfirm(`Permanently delete project ${projectId} and its current saved files?${archives} [y/N] `,
        { input: ctx.input, output: ctx.errorOutput })) throw usageError('Deletion cancelled; no mutation was sent.');
    }
    operation = createOperation(ctx, { action: 'project:delete', account, ...(requested ? { id: requested } : {}),
      request: { method: 'POST', path: route, body: status.cleanup.kind === 'managed'
        ? { expected_control_revision: status.control.revision } : {} } });
  }
  let data;
  if (operation.state === 'completed') {
    data = storageStatus((await ctx.client.get(`/api/v1/projects/${projectId}/storage`)).data, projectId);
  } else {
    data = storageStatus((await sendOperation(ctx, operation)).data, projectId);
  }
  if (ctx.flags.wait) data = await waitForStorage(ctx, projectId, { initial: data, operationId: operation.id });
  reportStorage(ctx, data, { operationId: operation.id, ...(ctx.flags.wait ? { waitOutcome: 'complete' } : {}) });
}
