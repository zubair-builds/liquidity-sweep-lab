'use strict';

/**
 * Pure functions over an ascending array of bars.
 * A bar is { time: ISO string, open, high, low, close, volume }.
 */

/** Wilder's ATR. Returns an array aligned to bars; leading values are null. */
function atr(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return out;

  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const p = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - p), Math.abs(b.low - p));
  });

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;

  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Fractal pivot at index `i` requires `len` bars either side.
 * Confirmation therefore lags by `len` bars — this is inherent, not a bug.
 */
function isPivotHigh(bars, i, len) {
  if (i - len < 0 || i + len >= bars.length) return false;
  const v = bars[i].high;
  for (let j = i - len; j <= i + len; j++) {
    if (j === i) continue;
    if (bars[j].high >= v) return false;
  }
  return true;
}

function isPivotLow(bars, i, len) {
  if (i - len < 0 || i + len >= bars.length) return false;
  const v = bars[i].low;
  for (let j = i - len; j <= i + len; j++) {
    if (j === i) continue;
    if (bars[j].low <= v) return false;
  }
  return true;
}

/** Highest high / lowest low over the `n` bars ending at index `i` inclusive. */
function highestHigh(bars, i, n) {
  let m = -Infinity;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.max(m, bars[j].high);
  return m;
}

function lowestLow(bars, i, n) {
  let m = Infinity;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.min(m, bars[j].low);
  return m;
}

/**
 * Three-candle imbalance ending at index `i`.
 * Bullish: low[i] > high[i-2]. Bearish: high[i] < low[i-2].
 */
function fvgAt(bars, i, minSize = 0) {
  if (i < 2) return null;
  const a = bars[i - 2], c = bars[i];
  if (c.low > a.high && c.low - a.high > minSize) {
    return { type: 'bullish', bottom: a.high, top: c.low, index: i, time: c.time };
  }
  if (c.high < a.low && a.low - c.high > minSize) {
    return { type: 'bearish', bottom: c.high, top: a.low, index: i, time: c.time };
  }
  return null;
}

/** All FVGs that later price action has not fully traded back through. */
function unfilledFVGs(bars, atrSeries) {
  const found = [];
  for (let i = 2; i < bars.length; i++) {
    const g = fvgAt(bars, i, (atrSeries[i] || 0) * 0.05);
    if (g) found.push(g);
  }
  return found.filter((g) => {
    for (let j = g.index + 1; j < bars.length; j++) {
      if (g.type === 'bullish' && bars[j].low <= g.bottom) return false;
      if (g.type === 'bearish' && bars[j].high >= g.top) return false;
    }
    return true;
  });
}

module.exports = {
  atr, isPivotHigh, isPivotLow, highestHigh, lowestLow, fvgAt, unfilledFVGs,
};
