#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency test suite. Boots the real server on an ephemeral port and
 * exercises it over HTTP, so routing, body parsing and status codes are covered
 * rather than just the functions underneath them.
 *
 *   node test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createServer } = require('./server');
const { normalizeBars, inferBarMinutes, dropUnclosedBar } = require('./bars');

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    failures.push({ name, err });
    process.stdout.write(`FAIL  ${name}\n      ${err.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Synthetic bars: a deterministic pseudo-random walk. Deterministic because a
// test that occasionally produces a signal and occasionally does not is worse
// than no test at all.
// ---------------------------------------------------------------------------
function makeBars(count, { start = Date.parse('2026-01-01T00:00:00Z'), stepMin = 60, seed = 7 } = {}) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const bars = [];
  let price = 4000;
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.48) * 12;
    const open = price;
    const close = open + drift;
    const wick = rand() * 6 + 1;
    bars.push({
      time: new Date(start + i * stepMin * 60000).toISOString(),
      open: Number(open.toFixed(2)),
      high: Number((Math.max(open, close) + wick).toFixed(2)),
      low: Number((Math.min(open, close) - wick).toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(rand() * 1000),
    });
    price = close;
  }
  return bars;
}

function toColumns(bars) {
  return {
    time: bars.map((b) => b.time),
    open: bars.map((b) => b.open),
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume),
  };
}

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------
function listen(cfg) {
  return new Promise((resolve) => {
    const srv = createServer(cfg);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function call(port, method, route, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body is itself a failure the caller asserts on */ }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const { srv, port } = await listen(cfg);

  const bars = makeBars(300);
  const closedFlag = { lastBarClosed: true };

  process.stdout.write('\nnormalisation\n');

  await test('both payload shapes normalise identically', () => {
    const a = normalizeBars(bars).bars;
    const b = normalizeBars(toColumns(bars)).bars;
    assert.deepStrictEqual(a, b);
  });

  await test('epoch seconds and milliseconds are both accepted', () => {
    const ms = Date.parse('2026-03-01T12:00:00Z');
    const { bars: fromMs } = normalizeBars([{ time: ms, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    const { bars: fromSec } = normalizeBars([{ time: ms / 1000, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    assert.strictEqual(fromMs[0].time, '2026-03-01T12:00:00.000Z');
    assert.strictEqual(fromSec[0].time, '2026-03-01T12:00:00.000Z');
  });

  await test('IBKR raw t/o/h/l/c keys are accepted', () => {
    const { bars: out } = normalizeBars([{ t: 1767268800000, o: 1, h: 2, l: 0.5, c: 1.5 }]);
    assert.strictEqual(out[0].open, 1);
    assert.strictEqual(out[0].close, 1.5);
  });

  await test('out-of-order bars are sorted ascending', () => {
    const shuffled = [bars[5], bars[1], bars[3]];
    const { bars: out } = normalizeBars(shuffled);
    assert.deepStrictEqual(out.map((b) => b.time), [bars[1].time, bars[3].time, bars[5].time]);
  });

  await test('duplicate timestamps collapse to the later value and warn', () => {
    const dup = [bars[0], { ...bars[0], close: 9999 }];
    const { bars: out, warnings } = normalizeBars(dup);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].close, 9999);
    assert.match(warnings.join(' '), /duplicate/);
  });

  await test('inconsistent OHLC warns but does not reject', () => {
    const bad = [{ time: bars[0].time, open: 10, high: 5, low: 8, close: 9 }];
    const { bars: out, warnings } = normalizeBars(bad);
    assert.strictEqual(out.length, 1);
    assert.match(warnings.join(' '), /inconsistent OHLC/);
  });

  await test('ragged columns are rejected rather than truncated', () => {
    const cols = toColumns(bars.slice(0, 10));
    cols.close.pop();
    assert.throws(() => normalizeBars(cols), /has 9 entries but "time" has 10/);
  });

  await test('bar interval is inferred from spacing, ignoring session gaps', () => {
    const gapped = [...bars.slice(0, 20)];
    gapped.push({ ...bars[20], time: new Date(Date.parse(bars[19].time) + 72 * 3600000).toISOString() });
    assert.strictEqual(inferBarMinutes(gapped), 60);
  });

  await test('an unfinished final bar is dropped, a finished one is kept', () => {
    const now = Date.parse('2026-01-01T10:30:00Z');
    const upTo = bars.filter((b) => Date.parse(b.time) <= Date.parse('2026-01-01T10:00:00Z'));
    const mid = dropUnclosedBar(upTo, 60, now);
    assert.strictEqual(mid.dropped, '2026-01-01T10:00:00.000Z');
    const after = dropUnclosedBar(upTo, 60, Date.parse('2026-01-01T11:00:01Z'));
    assert.strictEqual(after.dropped, null);
  });

  process.stdout.write('\nPOST /analyze\n');

  await test('array and column payloads produce the same decision', async () => {
    const a = await call(port, 'POST', '/analyze', { instrument: 'X', timeframe: '1h', bars, ...closedFlag });
    const b = await call(port, 'POST', '/analyze', { instrument: 'X', timeframe: '1h', bars: toColumns(bars), ...closedFlag });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    assert.strictEqual(a.json.payloadShape, undefined);
    assert.strictEqual(a.json.meta.payloadShape, 'objects');
    assert.strictEqual(b.json.meta.payloadShape, 'columns');
    // Everything except the wall-clock stamps and the shape note must match.
    const strip = (r) => {
      const { asOf, meta, ...rest } = r;
      const { payloadShape, ...restMeta } = meta;
      return { ...rest, meta: restMeta };
    };
    assert.deepStrictEqual(strip(a.json), strip(b.json));
  });

  await test('the response carries a state, an action and the checks breakdown', async () => {
    const r = await call(port, 'POST', '/analyze', { instrument: 'X', timeframe: '1h', bars, ...closedFlag });
    assert.strictEqual(r.json.ok, true);
    assert.ok(['FLAT', 'ARMED_LONG', 'ARMED_SHORT', 'SIGNAL_LONG', 'SIGNAL_SHORT'].includes(r.json.state));
    assert.ok(['BUY', 'SELL', 'WAIT', 'NONE'].includes(r.json.action));
    assert.deepStrictEqual(
      Object.keys(r.json.checks).sort(),
      ['bos', 'displacement', 'fvg', 'premiumDiscount', 'sweep'],
    );
    assert.strictEqual(r.json.meta.barsAnalysed, bars.length);
  });

  await test('the full signal history is not leaked into the analyze response', async () => {
    const r = await call(port, 'POST', '/analyze', { bars, ...closedFlag });
    assert.strictEqual(r.json.signals, undefined);
  });

  await test('repeated identical requests give identical answers (no hidden state)', async () => {
    const body = { instrument: 'X', timeframe: '1h', bars, ...closedFlag };
    const a = await call(port, 'POST', '/analyze', body);
    const b = await call(port, 'POST', '/analyze', body);
    assert.deepStrictEqual({ ...a.json, asOf: null }, { ...b.json, asOf: null });
  });

  await test('config profiles layer, and request overrides win', async () => {
    const r = await call(port, 'POST', '/analyze', {
      instrument: 'XAUUSD', timeframe: '1h', bars, ...closedFlag,
      model: { rr: 3.5 },
    });
    assert.strictEqual(r.json.config.pivotLen, 4, 'XAUUSD:1h profile should set pivotLen');
    assert.strictEqual(r.json.config.rr, 3.5, 'request override should win');
    assert.deepStrictEqual(r.json.meta.profilesApplied, ['default', 'XAUUSD:1h', 'request']);
  });

  await test('an unknown instrument still resolves the default profile', async () => {
    const r = await call(port, 'POST', '/analyze', { instrument: 'NOPE', timeframe: '9h', bars, ...closedFlag });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.meta.profilesApplied, ['default']);
  });

  await test('an unfinished last bar is dropped when the caller does not vouch for it', async () => {
    const live = makeBars(200, { start: Date.now() - 199 * 3600000 });
    const r = await call(port, 'POST', '/analyze', { instrument: 'X', timeframe: '1h', bars: live });
    assert.strictEqual(r.json.meta.barsReceived, 200);
    assert.strictEqual(r.json.meta.barsAnalysed, 199);
    assert.ok(r.json.meta.unclosedBarDropped);
  });

  await test('lastBarClosed keeps the final bar', async () => {
    const live = makeBars(200, { start: Date.now() - 199 * 3600000 });
    const r = await call(port, 'POST', '/analyze', { bars: live, lastBarClosed: true });
    assert.strictEqual(r.json.meta.barsAnalysed, 200);
    assert.strictEqual(r.json.meta.unclosedBarDropped, null);
  });

  process.stdout.write('\nerror handling\n');

  await test('too few bars returns 422 with the requirement stated', async () => {
    const r = await call(port, 'POST', '/analyze', { bars: bars.slice(0, 12), ...closedFlag });
    assert.strictEqual(r.status, 422);
    assert.match(r.json.error, /need at least/);
    assert.strictEqual(r.json.meta.barsAnalysed, 12);
  });

  await test('missing bars returns 400 with a hint', async () => {
    const r = await call(port, 'POST', '/analyze', { instrument: 'X' });
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /missing "bars"/);
    assert.ok(r.json.detail.hint);
  });

  await test('an empty bars array returns 400', async () => {
    const r = await call(port, 'POST', '/analyze', { bars: [] });
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /no bars/);
  });

  await test('an unrecognised bars shape returns 400', async () => {
    const r = await call(port, 'POST', '/analyze', { bars: { nope: true } });
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /unrecognised bars shape/);
  });

  await test('a non-numeric price returns 400 naming the bar and field', async () => {
    const broken = bars.slice(0, 60).map((b, i) => (i === 3 ? { ...b, close: 'n/a' } : b));
    const r = await call(port, 'POST', '/analyze', { bars: broken });
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /bar 3: close is not a number/);
  });

  await test('numeric strings are coerced rather than rejected', async () => {
    const stringy = bars.map((b) => ({ ...b, close: String(b.close) }));
    const r = await call(port, 'POST', '/analyze', { bars: stringy, ...closedFlag });
    assert.strictEqual(r.status, 200);
  });

  await test('an unknown model parameter returns 400 rather than being ignored', async () => {
    const r = await call(port, 'POST', '/analyze', { bars, model: { pivotLenn: 4 }, ...closedFlag });
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /unknown model parameter/);
  });

  await test('malformed JSON returns 400, not 500', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    });
    assert.strictEqual(res.status, 400);
  });

  await test('an empty body returns 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/analyze`, { method: 'POST' });
    assert.strictEqual(res.status, 400);
  });

  process.stdout.write('\nrouting\n');

  await test('GET /health describes the service', async () => {
    const r = await call(port, 'GET', '/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.ok(r.json.modelParameters.includes('pivotLen'));
  });

  await test('GET /analyze returns 405 with an Allow header', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/analyze`);
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.headers.get('allow'), 'POST');
  });

  await test('an unknown route returns 404', async () => {
    const r = await call(port, 'POST', '/nope', {});
    assert.strictEqual(r.status, 404);
  });

  await test('a trailing slash resolves to the same route', async () => {
    const r = await call(port, 'POST', '/analyze/', { bars, ...closedFlag });
    assert.strictEqual(r.status, 200);
  });

  await test('an API key, when configured, is enforced', async () => {
    const { srv: guarded, port: gport } = await listen({ ...cfg, apiKey: 'sekrit' });
    try {
      const denied = await call(gport, 'POST', '/analyze', { bars, ...closedFlag });
      assert.strictEqual(denied.status, 401);
      const allowed = await call(gport, 'POST', '/analyze', { bars, ...closedFlag }, { 'X-API-Key': 'sekrit' });
      assert.strictEqual(allowed.status, 200);
      const bearer = await call(gport, 'POST', '/analyze', { bars, ...closedFlag }, { Authorization: 'Bearer sekrit' });
      assert.strictEqual(bearer.status, 200);
    } finally {
      guarded.close();
    }
  });

  process.stdout.write('\nPOST /backtest\n');

  await test('backtest returns statistics and withholds trades by default', async () => {
    const r = await call(port, 'POST', '/backtest', { instrument: 'X', timeframe: '1h', bars, ...closedFlag });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.trades, undefined);
    assert.strictEqual(typeof r.json.tradeCount, 'number');
    assert.ok(r.json.stats);
  });

  await test('includeTrades returns the trade list', async () => {
    const r = await call(port, 'POST', '/backtest', { bars, includeTrades: true, ...closedFlag });
    assert.ok(Array.isArray(r.json.trades));
    assert.strictEqual(r.json.trades.length, r.json.tradeCount);
  });

  await test('costs fall back to config and are echoed back', async () => {
    const r = await call(port, 'POST', '/backtest', { bars, ...closedFlag });
    assert.strictEqual(r.json.costs.spreadPoints, cfg.costs.spreadPoints);
    const overridden = await call(port, 'POST', '/backtest', {
      bars, ...closedFlag, costs: { spreadPoints: 5, slippagePoints: 1 },
    });
    assert.strictEqual(overridden.json.costs.spreadPoints, 5);
  });

  process.stdout.write('\nreal IBKR connector data\n');

  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-xauusd-1h.json'), 'utf8'));

  await test('the verbatim get_price_history payload is accepted', async () => {
    const r = await call(port, 'POST', '/analyze', sample);
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.meta.payloadShape, 'columns');
    assert.strictEqual(r.json.meta.barsReceived, 115);
    assert.strictEqual(r.json.meta.barMinutes, 60, 'hourly spacing should be inferred');
    assert.deepStrictEqual(r.json.meta.warnings, []);
  });

  await test('prices survive the round trip unchanged', async () => {
    const r = await call(port, 'POST', '/analyze', sample);
    const n = sample.bars.time.length;
    assert.strictEqual(r.json.lastBar.close, sample.bars.close[n - 1]);
    assert.strictEqual(r.json.lastBar.high, sample.bars.high[n - 1]);
    assert.strictEqual(r.json.lastBar.time, '2026-07-10T20:00:00.000Z');

    // The dealing range is the extreme over the last pdLookback bars, not over
    // the whole payload — recompute it here rather than hardcoding a number, so
    // this still checks something if pdLookback changes.
    const look = r.json.config.pdLookback;
    assert.strictEqual(r.json.context.dealingRange.high, Math.max(...sample.bars.high.slice(n - look)));
    assert.strictEqual(r.json.context.dealingRange.low, Math.min(...sample.bars.low.slice(n - look)));
  });

  await test('the decision object is internally consistent', async () => {
    const r = await call(port, 'POST', '/analyze', sample);
    const { context } = r.json;
    const { high, low, equilibrium } = context.dealingRange;
    assert.ok(high > low);
    assert.strictEqual(equilibrium, (high + low) / 2);
    assert.strictEqual(context.zone, context.close > equilibrium ? 'premium' : 'discount');
    assert.ok(context.pctOfRange >= 0 && context.pctOfRange <= 100);
    if (r.json.signal) {
      const s = r.json.signal;
      const long = s.side === 'BUY';
      assert.ok(long ? s.stop < s.entry : s.stop > s.entry, 'stop must sit on the losing side of entry');
      assert.ok(long ? s.target > s.entry : s.target < s.entry, 'target must sit on the winning side');
      assert.ok(Math.abs(s.riskPoints - Math.abs(s.entry - s.stop)) < 1e-6);
    }
  });

  await test('reshaping the real payload to objects changes nothing', async () => {
    const asObjects = sample.bars.time.map((t, i) => ({
      time: t,
      open: sample.bars.open[i],
      high: sample.bars.high[i],
      low: sample.bars.low[i],
      close: sample.bars.close[i],
    }));
    const cols = await call(port, 'POST', '/analyze', sample);
    const objs = await call(port, 'POST', '/analyze', { ...sample, bars: asObjects });
    assert.strictEqual(objs.status, 200);
    assert.deepStrictEqual(objs.json.checks, cols.json.checks);
    assert.strictEqual(objs.json.state, cols.json.state);
    assert.strictEqual(objs.json.context.close, cols.json.context.close);
  });

  srv.close();

  process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) process.exit(1);
}

main().catch((e) => { process.stderr.write(`${e.stack}\n`); process.exit(1); });
