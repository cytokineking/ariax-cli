/** Explicitly reconcile or replay ONE previously journaled mutation with its original key. */
import { usageError } from '../args.js';
import { printJson, printKv } from '../output.js';
import { loadOperation, verifyAccount, verifyReplayInputs, lookupOperation, sendOperation,
  operationSummary, operationFailure, waitForOperation } from '../operations.js';
import { waitAndReport } from './submit.js';

export async function run(ctx) {
  const id = ctx.positionals[0];
  if (!id) throw usageError('recover: provide an operation ID from ariax operations.');
  if (ctx.flags.file || ctx.flags.f || ctx.flags.input || ctx.flags.name) {
    throw usageError('recover reuses the saved request. Submit changed inputs as a new operation.');
  }
  const operation = loadOperation(ctx.config.rootDir, id);
  await verifyAccount(ctx, operation);
  const remote = await lookupOperation(ctx, operation);
  if (!remote || remote.replay_allowed === true) {
    verifyReplayInputs(ctx, operation);
    await sendOperation(ctx, operation);
  }
  if (operation.state === 'failed') throw operationFailure(operation);
  if (ctx.flags.wait === true) {
    await waitForOperation(ctx, operation);
    return waitAndReport(ctx, operation.project_id, operation);
  }
  const data = operationSummary(operation);
  if (ctx.json) printJson({ data }); else printKv(data);
  return data;
}
