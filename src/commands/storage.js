import { usageError } from '../args.js';
import { resolveProjectId } from '../resolve.js';
import { storageStatus, reportStorage, waitForStorage, storageWaitOptions } from '../storage.js';

export async function run(ctx) {
  if (ctx.flags.wait) storageWaitOptions(ctx);
  if (ctx.positionals[0] !== 'status' || !ctx.positionals[1]) throw usageError('storage: use ariax storage status <project-id> [--wait].');
  const projectId = (await resolveProjectId(ctx.client, ctx.positionals[1])).toLowerCase();
  const response = await ctx.client.get(`/api/v1/projects/${projectId}/storage`);
  let data = storageStatus(response.data, projectId);
  if (ctx.flags.wait) data = await waitForStorage(ctx, projectId, { initial: data });
  reportStorage(ctx, data, { requestId: response.requestId, ...(ctx.flags.wait ? { waitOutcome: 'complete' } : {}) });
}
