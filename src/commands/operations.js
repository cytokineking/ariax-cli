/** `ariax operations [id]`: local inventory, or authenticated read-only reconciliation. */
import { printJson, printTable, printKv } from '../output.js';
import { listOperations, loadOperation, verifyAccount, lookupOperation, operationSummary } from '../operations.js';

export async function run(ctx) {
  const id = ctx.positionals[0];
  if (!id) {
    const summaries = listOperations(ctx.config.rootDir).map(operationSummary);
    if (ctx.json) printJson({ data: summaries });
    else printTable(['id', 'action', 'state', 'project_id'], summaries.map((item) => [item.id, item.action, item.state, item.project_id ?? '-']));
    return summaries;
  }
  const operation = loadOperation(ctx.config.rootDir, id);
  await verifyAccount(ctx, operation);
  const remote = await lookupOperation(ctx, operation);
  const data = { ...operationSummary(operation), recorded_on_server: remote !== null };
  if (ctx.json) printJson({ data }); else printKv(data);
  return data;
}
