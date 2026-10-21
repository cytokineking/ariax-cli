/** `ariax schema <protocol>` — fetch JSON Schema (GET /api/v1/protocols/{id}/schema). */
import fs from 'node:fs';
import { printJson, printData, printProgress } from '../output.js';
import { EXIT } from '../exit-codes.js';
import { usageError } from '../args.js';

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean }} ctx */
export async function run(ctx) {
  const protocol = ctx.positionals[0];
  if (!protocol) {
    const err = new Error('Missing protocol id. Usage: ariax schema <protocol>');
    err.exitCode = EXIT.USAGE;
    throw err;
  }
  if (ctx.positionals.length !== 1) throw usageError('schema: expected one protocol id');
  const unknown = Object.keys(ctx.flags).find((name) => !['raw', 'kind', 'output', 'o'].includes(name));
  if (unknown) throw usageError(`schema: unknown flag --${unknown}`);
  const kind = ctx.flags.kind || 'job';
  if (!['job', 'submission'].includes(kind)) throw usageError('schema: --kind must be job or submission');
  const raw = ctx.flags.raw === true;
  if (ctx.flags.kind && !raw) throw usageError('schema: --kind requires --raw');
  const res = await ctx.client.get(`/api/v1/protocols/${encodeURIComponent(protocol)}/schema`, {
    auth: true, query: raw ? { format: 'raw', kind } : undefined,
  });
  const schema = res.data && typeof res.data === 'object' && 'schema' in res.data ? res.data.schema : res.data;
  const outFile = ctx.flags.output || ctx.flags.o;
  if (outFile) {
    fs.writeFileSync(String(outFile), JSON.stringify(schema, null, 2) + '\n');
    printProgress(`Schema for "${protocol}" written to ${outFile}`);
    if (ctx.json) printJson({ data: { protocol, output: String(outFile) }, request_id: res.requestId });
    return;
  }
  if (raw) {
    printJson(schema);
    return;
  }
  if (ctx.json) {
    printJson({ data: schema, meta: res.meta, request_id: res.requestId });
    return;
  }
  printData(JSON.stringify(schema, null, 2));
}
