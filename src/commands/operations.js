/** `ariax operations [id] [--all-origins]`: local inventory (scoped to current API origin by default), or authenticated read-only reconciliation. */
import { usageError } from '../args.js';
import { printJson, printTable, printKv, printProgress } from '../output.js';
import { listOperations, loadOperation, verifyAccount, lookupOperation, operationSummary } from '../operations.js';

export async function run(ctx) {
  const id = ctx.positionals[0];
  const allOrigins = ctx.flags?.['all-origins'] === true;
  const opts = { legacyRootDir: ctx.config.legacyRootDir };
  if (!id) {
    const currentOrigin = new URL(ctx.config.baseUrl ?? 'https://www.ariax.bio').origin;
    const allRecords = listOperations(ctx.config.rootDir, opts);
    const records = allOrigins ? allRecords : allRecords.filter((op) => op.api_origin === currentOrigin);
    const hiddenOtherOrigins = allRecords.length - records.length;
    const summaries = records.map((op) => (
      allOrigins ? { ...operationSummary(op), api_origin: op.api_origin ?? null } : operationSummary(op)
    ));
    if (ctx.json) {
      printJson({
        data: summaries,
        meta: {
          filtered_by_origin: !allOrigins,
          api_origin: currentOrigin,
          ...(hiddenOtherOrigins > 0 ? { hidden_other_origins: hiddenOtherOrigins } : {}),
        },
      });
    } else if (allOrigins) {
      printTable(
        ['id', 'action', 'state', 'project_id', 'api_origin'],
        summaries.map((item) => [item.id, item.action, item.state, item.project_id ?? '-', item.api_origin ?? '-']),
      );
    } else {
      printTable(
        ['id', 'action', 'state', 'project_id'],
        summaries.map((item) => [item.id, item.action, item.state, item.project_id ?? '-']),
      );
      if (hiddenOtherOrigins > 0) {
        printProgress(`Showing operations for ${currentOrigin} (${hiddenOtherOrigins} from other API origins hidden; pass --all-origins to list all).`);
      }
    }
    return summaries;
  }
  if (allOrigins) {
    throw usageError('operations: --all-origins applies only when listing operations without an operation ID.');
  }
  const operation = loadOperation(ctx.config.rootDir, id, opts);
  await verifyAccount(ctx, operation);
  const remote = await lookupOperation(ctx, operation);
  const data = { ...operationSummary(operation), recorded_on_server: remote !== null };
  if (ctx.json) printJson({ data }); else printKv(data);
  return data;
}
