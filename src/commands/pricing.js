/** `ariax pricing` — current hourly GPU allocation prices. */
import { printData, printJson, printTable } from '../output.js';
import { EXIT } from '../exit-codes.js';

export async function run(ctx) {
  const res = await ctx.client.get('/api/v1/pricing', { signal: ctx.signal });
  const data = res.data;
  if (data?.billing_unit !== 'allocation_hour' || typeof data.source !== 'string'
      || !Array.isArray(data.rates) || data.rates.length === 0
      || data.rates.some(rate => !rate || typeof rate.gpu_id !== 'string'
        || ![1, 2, 4, 8].includes(rate.gpu_count) || rate.currency !== 'USD'
        || typeof rate.hourly_rate !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(rate.hourly_rate)
        || !Number.isFinite(Number(rate.hourly_rate)) || Number(rate.hourly_rate) <= 0)) {
    throw Object.assign(new Error('Pricing endpoint returned invalid hourly rates.'), { exitCode: EXIT.SERVER });
  }
  if (ctx.json) {
    printJson({ data, meta: res.meta, request_id: res.requestId });
    return;
  }
  printTable(['GPU', 'GPUs', 'USD/allocation-hour'], data.rates.map(rate => [
    rate.gpu_id, rate.gpu_count,
    Number(rate.hourly_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
  ]));
  printData(`Source: ${data.source}`);
  printData('Turbo hourly total: (single-GPU hourly price + $1) × GPU count.');
}
