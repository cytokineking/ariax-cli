/** `ariax status <project-id> [--wait] [--resume]` — project detail + optional wait. */
import { printJson, printKv, printProgress } from '../output.js';
import { usageError } from '../args.js';
import { resolveProjectId } from '../resolve.js';
import { loadResume, saveResume } from '../resume.js';
import { waitAndReport } from './submit.js';

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean, config: { rootDir: string } }} ctx */
export async function run(ctx) {
  const { flags } = ctx;
  let operand = ctx.positionals[0];
  if (flags.resume === true && !operand) {
    const saved = await loadResume(ctx.config.rootDir);
    if (!saved || !saved.projectId) {
      throw usageError('status: --resume found no saved wait state.');
    }
    operand = saved.projectId;
    printProgress(`Resuming wait for project ${operand} (polling only)…`);
  }
  if (!operand) throw usageError('status: missing <project-id> (UUID or exact unique project name).');
  const projectId = await resolveProjectId(ctx.client, String(operand));
  if (flags.wait === true || flags.resume === true) {
    await saveResume(ctx.config.rootDir, { projectId }, { separate: true });
    return waitAndReport(ctx, projectId);
  }
  const res = await ctx.client.get(`/api/v1/projects/${projectId}`);
  const project = res.data?.project ?? res.data ?? {};
  if (ctx.json) {
    printJson({ data: res.data, meta: res.meta, request_id: res.requestId });
    return;
  }
  printKv({
    id: project.id ?? projectId,
    name: project.name ?? '-',
    protocol: project.protocol ?? project.protocol_id ?? '-',
    status: project.status ?? project.state ?? '-',
  });
}
