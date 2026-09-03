/** `ariax me` — authenticated account summary (GET /api/v1/me). */
import { printData, printJson, printKv } from '../output.js';

/** @param {{ client: any, json: boolean }} ctx */
export async function run(ctx) {
  const res = await ctx.client.get('/api/v1/me');
  if (ctx.json) {
    printJson({ data: res.data, meta: res.meta, request_id: res.requestId });
    return;
  }
  const d = res.data ?? {};
  const actor = d.actor ?? {};
  const billing = d.billing ?? {};
  printKv({
    user: actor.email || actor.user_id || '-',
    authentication: actor.authentication || '-',
    scopes: Array.isArray(actor.scopes) ? actor.scopes.join(',') : '-',
    billing_account: billing.account_type || billing.account_id || '-',
    balance_usd: billing.balance_usd ?? '-',
    required_balance_usd: billing.required_balance_usd ?? '-',
    can_start_compute: billing.can_start_compute ?? '-',
    request_id: res.requestId || '-',
  });
  if (res.meta && typeof res.meta === 'object') {
    printData('');
    printKv({ ...(res.meta) });
  }
}
