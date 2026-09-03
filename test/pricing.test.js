import assert from 'node:assert/strict';
import { it } from 'node:test';
import { main } from '../src/main.js';

const data = {
  source: 'database', billing_unit: 'allocation_hour',
  proration: 'elapsed_seconds / 3600', availability_guaranteed: false,
  rates: [
    { gpu_id: 'H100', gpu_count: 1, currency: 'USD', hourly_rate: '6.000000', turbo: false },
    { gpu_id: 'H100', gpu_count: 4, currency: 'USD', hourly_rate: '28.000000', turbo: true },
  ],
};

async function invoke(args, fetchImpl) {
  const oldOut = process.stdout.write, oldErr = process.stderr.write;
  let stdout = '', stderr = '';
  process.stdout.write = chunk => { stdout += chunk; return true; };
  process.stderr.write = chunk => { stderr += chunk; return true; };
  try {
    const code = await main(['pricing', ...args], { NO_UPDATE_NOTIFIER: '1' }, { fetchImpl });
    return { code, stdout, stderr };
  } finally { process.stdout.write = oldOut; process.stderr.write = oldErr; }
}

it('fetches current pricing each invocation and preserves the JSON envelope and exact rates', async () => {
  let calls = 0;
  for (const hourly_rate of ['28.000000', '29.125001']) {
    const updated = { ...data, rates: [data.rates[0], { ...data.rates[1], hourly_rate }] };
    const result = await invoke(['--json'], async (url, options) => {
      calls++;
      assert.equal(new URL(url).pathname, '/api/v1/pricing');
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return Response.json({ data: updated, request_id: 'prices' });
    });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { data: updated, request_id: 'prices' });
    assert.equal(result.stderr, '');
  }
  assert.equal(calls, 2);
});

it('shows single and Turbo allocation totals with units and pricing source', async () => {
  for (const source of ['database', 'python', 'frontend_fallback']) {
    const result = await invoke(['--no-json'], async () => Response.json({ data: { ...data, source } }));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /USD\/allocation-hour/);
    assert.match(result.stdout, /H100\s+1\s+6\.00/);
    assert.match(result.stdout, /H100\s+4\s+28\.00/);
    assert.ok(result.stdout.includes(`Source: ${source}`));
    assert.ok(result.stdout.includes('(single-GPU hourly price + $1) × GPU count'));
    assert.equal(result.stderr, '');
  }
});

it('reports unavailable pricing through the existing error envelope', async () => {
  const result = await invoke(['--json'], async () => Response.json({
    error: { code: 'not_found', message: 'Pricing unavailable', retryable: false },
    request_id: 'missing-prices',
  }, { status: 404 }));
  assert.equal(result.code, 4);
  const body = JSON.parse(result.stdout);
  assert.equal(body.error.message, 'Pricing unavailable');
  assert.equal(body.request_id, 'missing-prices');
  assert.equal(body.data, undefined);
});

it('rejects malformed successful responses instead of displaying misleading prices', async () => {
  for (const invalid of [null, { ...data, rates: [] }, { ...data, rates: [null] },
    { ...data, billing_unit: 'gpu_hour' },
    ...['', '-1', 'NaN'].map(hourly_rate => ({ ...data, rates: [{ ...data.rates[0], hourly_rate }] })),
  ]) {
    const result = await invoke(['--json'], async () => Response.json({ data: invalid }));
    assert.equal(result.code, 10);
    assert.match(JSON.parse(result.stdout).error.message, /invalid hourly rates/);
  }
});

it('advertises pricing help and rejects unsupported arguments without requests', async () => {
  const forbidden = async () => { assert.fail('Unexpected request'); };
  const help = await invoke(['--help'], forbidden);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: ariax pricing/);
  for (const args of [['extra'], ['--hours', '2'], ['--protocol', 'boltzgen']]) {
    assert.equal((await invoke([...args, '--json'], forbidden)).code, 1);
  }
});
