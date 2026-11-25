/** `ariax pricing` — current hourly GPU allocation prices. */
import { usageError } from '../args.js';
import { printData, printJson, printTable } from '../output.js';
import { EXIT } from '../exit-codes.js';

export async function run(ctx) {
  const flags = ctx.flags || {};
  let gpuFilter = null;
  if (flags.gpu !== undefined) {
    const rawGpu = String(flags.gpu).trim();
    if (!rawGpu) throw usageError('pricing: --gpu must be a nonempty GPU identifier.');
    gpuFilter = /^L40$/i.test(rawGpu) ? 'L40S' : rawGpu.toUpperCase();
  }
  let gpuCountFilter = null;
  if (flags['gpu-count'] !== undefined) {
    const rawCount = String(flags['gpu-count']).trim();
    const num = Number(rawCount);
    if (!/^\d+$/.test(rawCount) || ![1, 2, 4, 8].includes(num)) {
      throw usageError('pricing: --gpu-count must be 1, 2, 4, or 8.');
    }
    gpuCountFilter = num;
  }
  const details = flags.details === true;

  const res = await ctx.client.get('/api/v1/pricing', { signal: ctx.signal, query: { channel: 'cli' } });
  const raw = res.data;
  if (raw?.billing_unit !== 'allocation_hour' || typeof raw.source !== 'string'
      || !Array.isArray(raw.rates) || raw.rates.length === 0
      || raw.rates.some(rate => !rate || typeof rate.gpu_id !== 'string'
        || ![1, 2, 4, 8].includes(rate.gpu_count) || rate.currency !== 'USD'
        || typeof rate.hourly_rate !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(rate.hourly_rate)
        || !Number.isFinite(Number(rate.hourly_rate)) || Number(rate.hourly_rate) <= 0)) {
    throw Object.assign(new Error('Pricing endpoint returned invalid hourly rates.'), { exitCode: EXIT.SERVER });
  }
  // Older servers may return both names. Keep the existing L40S rate-card
  // row when present; do not alter or combine other GPU rates.
  const collapse = rows => {
    const preferred = new Set(rows.filter(row => row?.gpu_id === 'L40S').map(row => row.gpu_count));
    const seen = new Set();
    return rows.flatMap(row => {
      if (!['L40', 'L40S'].includes(row?.gpu_id)) return [row];
      if ((row.gpu_id === 'L40' && preferred.has(row.gpu_count)) || seen.has(row.gpu_count)) return [];
      seen.add(row.gpu_count);
      return [{ ...row, gpu_id: 'L40S' }];
    });
  };
  const filterRows = rows => rows.filter(row => (
    (gpuFilter === null || String(row.gpu_id).toUpperCase() === gpuFilter)
    && (gpuCountFilter === null || row.gpu_count === gpuCountFilter)
  ));

  let promotion;
  if (raw.promotion && typeof raw.promotion === 'object') {
    if (raw.promotion.active === true || details) {
      promotion = Array.isArray(raw.promotion.rates)
        ? { ...raw.promotion, rates: filterRows(collapse(raw.promotion.rates)) }
        : { ...raw.promotion };
    } else {
      const { rates: _omittedRates, ...promoSummary } = raw.promotion;
      promotion = promoSummary;
    }
  }

  const data = {
    ...raw,
    rates: filterRows(collapse(raw.rates)),
    ...(promotion !== undefined ? { promotion } : {}),
  };
  if (ctx.json) {
    printJson({ data, meta: res.meta, request_id: res.requestId });
    return;
  }
  if (!data.rates.length) {
    printData('No matching GPU rates found.');
  } else {
    printTable(['GPU', 'GPUs', 'USD/allocation-hour'], data.rates.map(rate => [
      rate.gpu_id, rate.gpu_count,
      Number(rate.hourly_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
    ]));
  }
  printData(`Source: ${data.source}`);
  printData('Turbo standard total: single-GPU hourly price × GPU count.');
  if (data.preview_channel === 'cli') {
    printData('CLI preview. The rate locks when Ariax records the GPU allocation request.');
    if (data.promotion?.active) printData(`${data.promotion.label || 'CLI promotion'}${data.promotion.ends_at ? ` · ends ${data.promotion.ends_at}` : ''}`);
  }
}
