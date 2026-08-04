'use strict';

/**
 * Bar ingestion and normalisation.
 *
 * This app no longer talks to IBKR. Bars arrive in an HTTP request body,
 * fetched by whatever the caller likes — in practice Claude's IBKR connector
 * calling get_price_history. That connector returns parallel arrays, so both
 * that shape and the conventional array-of-objects shape are accepted here and
 * converted to one internal representation before the model ever sees them.
 *
 * Everything downstream (model.js, backtest.js) assumes the output of
 * normalizeBars: ascending, deduplicated, numerically valid.
 */

/** Bar sizes in minutes, used as a fallback when spacing cannot be inferred. */
const BAR_MINUTES = {
  '30s': 0.5,
  '1min': 1, '2min': 2, '3min': 3, '5min': 5, '10min': 10, '15min': 15, '30min': 30,
  '1h': 60, '2h': 120, '3h': 180, '4h': 240, '6h': 360, '8h': 480,
  '1d': 1440, '1w': 10080, '1m': 43200,
};

class BarError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'BarError';
    this.detail = detail;
  }
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Coerce numeric strings, because JSON payloads assembled by hand often quote numbers. */
function num(v, field, index) {
  if (isFiniteNumber(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new BarError(`bar ${index}: ${field} is not a number`, { index, field, value: v });
}

/** Accepts ISO strings, epoch seconds and epoch milliseconds. */
function toIso(t, index) {
  if (typeof t === 'number' && Number.isFinite(t)) {
    // IBKR's REST history returns epoch ms; some feeds return seconds. Anything
    // below ~1e11 as a timestamp would be 1973, so treat it as seconds.
    const ms = t < 1e11 ? t * 1000 : t;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) throw new BarError(`bar ${index}: unparseable time`, { index, value: t });
    return d.toISOString();
  }
  if (typeof t === 'string') {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) throw new BarError(`bar ${index}: unparseable time "${t}"`, { index, value: t });
    return d.toISOString();
  }
  throw new BarError(`bar ${index}: missing time`, { index, value: t });
}

/**
 * Detects which of the two accepted shapes was supplied.
 * Returns 'objects' | 'columns', or throws if neither.
 */
function detectShape(input) {
  if (Array.isArray(input)) return 'objects';
  if (input && typeof input === 'object' && Array.isArray(input.time)) return 'columns';
  throw new BarError(
    'unrecognised bars shape — expected an array of {time,open,high,low,close} ' +
    'or an object of parallel arrays {time:[],open:[],high:[],low:[],close:[]}',
    { received: input === null ? 'null' : typeof input },
  );
}

/**
 * The parallel-array shape returned by IBKR's get_price_history MCP tool.
 * Ragged arrays are an error rather than something to silently truncate — a
 * short `close` array almost always means the payload was assembled wrongly,
 * and quietly dropping bars would produce a plausible but wrong decision.
 */
function fromColumns(raw) {
  const required = ['time', 'open', 'high', 'low', 'close'];
  for (const k of required) {
    if (!Array.isArray(raw[k])) {
      throw new BarError(`column "${k}" is missing or not an array`, { column: k });
    }
  }
  const len = raw.time.length;
  for (const k of required) {
    if (raw[k].length !== len) {
      throw new BarError(
        `column "${k}" has ${raw[k].length} entries but "time" has ${len}`,
        { column: k, expected: len, got: raw[k].length },
      );
    }
  }
  const vol = Array.isArray(raw.volume) && raw.volume.length === len ? raw.volume : null;

  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = {
      time: toIso(raw.time[i], i),
      open: num(raw.open[i], 'open', i),
      high: num(raw.high[i], 'high', i),
      low: num(raw.low[i], 'low', i),
      close: num(raw.close[i], 'close', i),
      volume: vol && isFiniteNumber(vol[i]) ? vol[i] : null,
    };
  }
  return out;
}

/** The conventional array-of-objects shape. Also tolerates IBKR's raw t/o/h/l/c/v keys. */
function fromObjects(raw) {
  return raw.map((b, i) => {
    if (!b || typeof b !== 'object') throw new BarError(`bar ${i}: not an object`, { index: i });
    const time = b.time !== undefined ? b.time : b.t;
    const open = b.open !== undefined ? b.open : b.o;
    const high = b.high !== undefined ? b.high : b.h;
    const low = b.low !== undefined ? b.low : b.l;
    const close = b.close !== undefined ? b.close : b.c;
    const volume = b.volume !== undefined ? b.volume : b.v;
    return {
      time: toIso(time, i),
      open: num(open, 'open', i),
      high: num(high, 'high', i),
      low: num(low, 'low', i),
      close: num(close, 'close', i),
      volume: isFiniteNumber(volume) ? volume : null,
    };
  });
}

/**
 * Normalises either accepted shape into ascending, deduplicated bars.
 *
 * Duplicate timestamps keep the last occurrence, which is the right choice when
 * two overlapping history windows are concatenated: the later fetch carries any
 * revision the exchange published.
 *
 * OHLC inconsistencies (high below low, high below the open, and so on) are
 * reported as warnings rather than rejected. They usually indicate a rounding
 * artefact in a synthetic feed, not a corrupt payload, and the model tolerates
 * them — but they are worth surfacing because they quietly distort ATR.
 */
function normalizeBars(input, { maxBars = 0 } = {}) {
  const shape = detectShape(input);
  const parsed = shape === 'columns' ? fromColumns(input) : fromObjects(input);

  if (parsed.length === 0) throw new BarError('bars payload contained no bars', { count: 0 });
  if (maxBars > 0 && parsed.length > maxBars) {
    throw new BarError(`too many bars: ${parsed.length} exceeds the limit of ${maxBars}`, {
      count: parsed.length, maxBars,
    });
  }

  const byTime = new Map();
  for (const b of parsed) byTime.set(b.time, b);
  const bars = [...byTime.values()].sort((a, b) => new Date(a.time) - new Date(b.time));

  const warnings = [];
  const duplicates = parsed.length - bars.length;
  if (duplicates > 0) {
    warnings.push(`${duplicates} duplicate timestamp(s) collapsed, keeping the later value`);
  }

  let inconsistent = 0;
  for (const b of bars) {
    if (b.high < b.low
      || b.high < Math.max(b.open, b.close)
      || b.low > Math.min(b.open, b.close)) inconsistent++;
  }
  if (inconsistent > 0) {
    warnings.push(`${inconsistent} bar(s) have inconsistent OHLC values (high/low do not bracket open/close)`);
  }

  return { bars, shape, warnings };
}

/**
 * Median spacing between consecutive bars, in minutes.
 *
 * The median rather than the mean because weekend and session gaps are large
 * and would drag an average badly. Returns null when there is nothing to
 * measure, in which case the caller should fall back to the declared timeframe.
 */
function inferBarMinutes(bars) {
  if (bars.length < 3) return null;
  const deltas = [];
  for (let i = 1; i < bars.length; i++) {
    const d = (new Date(bars[i].time) - new Date(bars[i - 1].time)) / 60000;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return null;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function barMinutesFor(timeframe, bars) {
  const inferred = inferBarMinutes(bars);
  if (inferred != null) return { minutes: inferred, source: 'inferred' };
  if (timeframe && BAR_MINUTES[timeframe]) {
    return { minutes: BAR_MINUTES[timeframe], source: 'timeframe' };
  }
  return { minutes: 60, source: 'default' };
}

/**
 * Drops a final bar that has not finished forming.
 *
 * Unchanged in intent from the gateway version, but the reasoning matters more
 * now that a human or an agent chooses when to fetch: a request issued at 14:30
 * for hourly bars carries a half-built 14:00 bar, and signals computed on it
 * can appear and vanish within the hour. Dropping it costs one bar of latency.
 *
 * `lastBarClosed: true` in the request overrides this, for replaying a saved
 * history where every bar is by definition complete.
 */
function dropUnclosedBar(bars, barMinutes, now = Date.now()) {
  if (bars.length < 2) return { bars, dropped: null };
  const last = bars[bars.length - 1];
  const closesAt = new Date(last.time).getTime() + barMinutes * 60 * 1000;
  if (now < closesAt) {
    return { bars: bars.slice(0, -1), dropped: last.time };
  }
  return { bars, dropped: null };
}

module.exports = {
  normalizeBars,
  inferBarMinutes,
  barMinutesFor,
  dropUnclosedBar,
  BarError,
  BAR_MINUTES,
};
