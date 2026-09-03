/** `ariax protocols` — list public protocol metadata (GET /api/v1/protocols). */
import { printJson, printTable } from '../output.js';
import { envelopeList } from '../http.js';

/** @param {{ client: any, flags: Record<string, any>, json: boolean }} ctx */
export async function run(ctx) {
  const res = await ctx.client.get('/api/v1/protocols', { auth: true });
  if (ctx.json) {
    printJson({ data: res.data, meta: res.meta, request_id: res.requestId });
    return;
  }
  const { list } = envelopeList(res.raw ?? res.data, ['protocols', 'items']);
  if (list.length === 0) {
    const { printData } = await import('../output.js');
    printData('No protocols available.');
    return;
  }
  printTable(
    ['id', 'name', 'description'],
    list.map((p) => [p.id ?? p.protocol ?? '-', p.name ?? p.title ?? '-', short(p.description ?? p.summary ?? '')]),
  );
}

function short(s) {
  const t = String(s || '');
  return t.length > 80 ? t.slice(0, 77) + '...' : t;
}
