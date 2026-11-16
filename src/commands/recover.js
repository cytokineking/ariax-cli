/** Explicitly reconcile or replay ONE previously journaled mutation with its original key. */
import { usageError } from '../args.js';
import { printJson, printKv } from '../output.js';
import { loadOperation, verifyAccount, verifyReplayInputs, lookupOperation, sendOperation,
  operationSummary, operationFailure, waitForOperation } from '../operations.js';
import { waitAndReport } from './submit.js';
import { checkGpuPolicy, projectGpuPolicy } from '../gpu-policy.js';
import { reportStorage, storageStatus, waitForStorage, storageWaitOptions } from '../storage.js';

export async function run(ctx) {
  const id = ctx.positionals[0];
  if (!id) throw usageError('recover: provide an operation ID from ariax operations.');
  if (ctx.flags.file || ctx.flags.f || ctx.flags.input || ctx.flags.name) {
    throw usageError('recover reuses the saved request. Submit changed inputs as a new operation.');
  }
  const operation = loadOperation(ctx.config.rootDir, id);
  if (operation.action === 'project:delete' && ctx.flags.wait) storageWaitOptions(ctx);
  await verifyAccount(ctx, operation);
  if (operation.action === 'project:delete' && operation.state === 'failed') throw operationFailure(operation);
  const remote = await lookupOperation(ctx, operation);
  if (!remote || remote.replay_allowed === true) {
    verifyReplayInputs(ctx, operation);
    if (operation.action === 'project:create') {
      await checkGpuPolicy(ctx, operation.request.body, { source: 'saved operation' });
    } else if (operation.action !== 'project:delete') {
      const projectId = operation.request.path.split('/')[4];
      const project = await projectGpuPolicy(ctx, projectId);
      await checkGpuPolicy(ctx, project, { source: 'saved policy', saved: true });
    }
    await sendOperation(ctx, operation);
  }
  if (operation.state === 'failed') throw operationFailure(operation);
  if (operation.action === 'project:delete') {
    const projectId = operation.request.path.split('/')[4];
    let data = storageStatus(operation.result, projectId);
    if (ctx.flags.wait) data = await waitForStorage(ctx, projectId, { initial: data, operationId: operation.id });
    reportStorage(ctx, data, { operationId: operation.id, ...(ctx.flags.wait ? { waitOutcome: 'complete' } : {}) });
    return data;
  }
  if (ctx.flags.wait === true) {
    await waitForOperation(ctx, operation);
    return waitAndReport(ctx, operation.project_id, operation);
  }
  const data = operationSummary(operation);
  if (ctx.json) printJson({ data }); else printKv(data);
  return data;
}
