'use strict';

const {
  atr, isPivotHigh, isPivotLow, highestHigh, lowestLow, fvgAt, unfilledFVGs,
} = require('./indicators');

const DEFAULTS = {
  pivotLen: 5,          // bars either side to confirm a swing
  structLen: 5,         // lookback for break-of-structure
  confirmBars: 6,       // window in which confirmation must arrive after a sweep
  dispMult: 0.6,        // minimum displacement body, in ATR
  requireFVG: true,
  requirePD: true,      // longs only in discount, shorts only in premium
  pdLookback: 50,       // bars defining the dealing range
  slBufferATR: 0.25,
  tpMode: 'fixedRR',    // 'fixedRR' | 'liquidity'
  rr: 2.0,
  minRR: 1.0,
  allowLongs: true,
  allowShorts: true,
  // Rejects signals whose stop sits absurdly far from entry. When displacement
  // arrives several bars after the sweep, price has already travelled and the
  // stop distance balloons — producing a technically valid signal with terrible
  // risk. 0 disables the filter; 3 is a sane starting point.
  maxRiskATR: 0,
};

/**
 * Replays the whole bar array from scratch every run.
 *
 * This is deliberate: an hourly process that persisted its own arming state
 * would drift out of sync after any missed run, restart, or data revision.
 * Recomputing from history is slower and completely reproducible — given the
 * same bars you always get the same answer.
 *
 * Returns a decision object. The final bar is treated as CLOSED; do not feed
 * a partially formed bar unless you accept that signals may flip intra-bar.
 */
function evaluate(bars, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const n = bars.length;
  const minBars = Math.max(cfg.pdLookback, cfg.pivotLen * 2 + 5, 30);
  if (n < minBars) {
    return { ok: false, error: `need at least ${minBars} bars, got ${n}` };
  }

  const atrSeries = atr(bars, 14);

  let lastSwingHigh = null, lastSwingLow = null;
  let prevSwingHigh = null, prevSwingLow = null;

  let armedLong = false, sweepLow = null, sweepBarL = null, sweepTimeL = null;
  let armedShort = false, sweepHigh = null, sweepBarS = null, sweepTimeS = null;

  let signal = null;                 // most recent signal produced
  const signals = [];                // every signal, in order — used by the backtester
  const checks = { sweep: false, displacement: false, bos: false, fvg: false, premiumDiscount: false };

  for (let i = cfg.pivotLen; i < n; i++) {
    const a = atrSeries[i];
    if (a == null) continue;

    // --- confirm pivots that are now `pivotLen` bars old --------------------
    const p = i - cfg.pivotLen;
    if (p >= cfg.pivotLen) {
      if (isPivotHigh(bars, p, cfg.pivotLen)) {
        prevSwingHigh = lastSwingHigh;
        lastSwingHigh = bars[p].high;
      }
      if (isPivotLow(bars, p, cfg.pivotLen)) {
        prevSwingLow = lastSwingLow;
        lastSwingLow = bars[p].low;
      }
    }

    const b = bars[i];

    // --- liquidity sweeps ---------------------------------------------------
    if (lastSwingLow != null && b.low < lastSwingLow && b.close > lastSwingLow) {
      armedLong = true; sweepLow = b.low; sweepBarL = i; sweepTimeL = b.time;
      lastSwingLow = b.low;             // swept extreme becomes the new reference
    }
    if (lastSwingHigh != null && b.high > lastSwingHigh && b.close < lastSwingHigh) {
      armedShort = true; sweepHigh = b.high; sweepBarS = i; sweepTimeS = b.time;
      lastSwingHigh = b.high;
    }

    // --- expiry / invalidation ---------------------------------------------
    if (armedLong && (i - sweepBarL > cfg.confirmBars || b.low < sweepLow - a * cfg.slBufferATR)) {
      armedLong = false;
    }
    if (armedShort && (i - sweepBarS > cfg.confirmBars || b.high > sweepHigh + a * cfg.slBufferATR)) {
      armedShort = false;
    }

    // --- confirmation components -------------------------------------------
    const bodyOk = Math.abs(b.close - b.open) >= a * cfg.dispMult;
    const dispUp = b.close > b.open && bodyOk;
    const dispDn = b.close < b.open && bodyOk;

    const bosUp = i > 0 && b.close > highestHigh(bars, i - 1, cfg.structLen);
    const bosDn = i > 0 && b.close < lowestLow(bars, i - 1, cfg.structLen);

    let fvgUp = !cfg.requireFVG, fvgDn = !cfg.requireFVG;
    if (cfg.requireFVG) {
      for (let j = Math.max(2, i - cfg.confirmBars); j <= i; j++) {
        const g = fvgAt(bars, j, (atrSeries[j] || 0) * 0.05);
        if (g && g.type === 'bullish') fvgUp = true;
        if (g && g.type === 'bearish') fvgDn = true;
      }
    }

    const rangeHi = highestHigh(bars, i, cfg.pdLookback);
    const rangeLo = lowestLow(bars, i, cfg.pdLookback);
    const eq = (rangeHi + rangeLo) / 2;
    const pdUp = !cfg.requirePD || b.low <= eq;
    const pdDn = !cfg.requirePD || b.high >= eq;

    // record component state on the final bar, for transparency in the output
    if (i === n - 1) {
      checks.sweep = armedLong || armedShort;
      checks.displacement = armedLong ? dispUp : armedShort ? dispDn : false;
      checks.bos = armedLong ? bosUp : armedShort ? bosDn : false;
      checks.fvg = armedLong ? fvgUp : armedShort ? fvgDn : false;
      checks.premiumDiscount = armedLong ? pdUp : armedShort ? pdDn : false;
    }

    // --- signal -------------------------------------------------------------
    if (cfg.allowLongs && armedLong && dispUp && bosUp && fvgUp && pdUp) {
      const entry = b.close;
      const stop = sweepLow - a * cfg.slBufferATR;
      const risk = entry - stop;
      const riskOk = cfg.maxRiskATR <= 0 || risk <= a * cfg.maxRiskATR;
      if (risk > 0 && riskOk) {
        let target = (cfg.tpMode === 'liquidity' && prevSwingHigh != null)
          ? prevSwingHigh : entry + risk * cfg.rr;
        if ((target - entry) / risk < cfg.minRR) target = entry + risk * cfg.rr;
        signal = {
          side: 'BUY', barIndex: i, time: b.time,
          entry, stop, target,
          riskPoints: risk,
          rewardPoints: target - entry,
          riskReward: (target - entry) / risk,
          sweptLevel: sweepLow, sweptAt: sweepTimeL,
          riskInATR: risk / a,
        };
        signals.push(signal);
        armedLong = false;
      } else if (risk > 0 && !riskOk) {
        armedLong = false;              // valid pattern, unacceptable risk — skip it
      }
    }

    if (cfg.allowShorts && armedShort && dispDn && bosDn && fvgDn && pdDn) {
      const entry = b.close;
      const stop = sweepHigh + a * cfg.slBufferATR;
      const risk = stop - entry;
      const riskOk = cfg.maxRiskATR <= 0 || risk <= a * cfg.maxRiskATR;
      if (risk > 0 && riskOk) {
        let target = (cfg.tpMode === 'liquidity' && prevSwingLow != null)
          ? prevSwingLow : entry - risk * cfg.rr;
        if ((entry - target) / risk < cfg.minRR) target = entry - risk * cfg.rr;
        signal = {
          side: 'SELL', barIndex: i, time: b.time,
          entry, stop, target,
          riskPoints: risk,
          rewardPoints: entry - target,
          riskReward: (entry - target) / risk,
          sweptLevel: sweepHigh, sweptAt: sweepTimeS,
          riskInATR: risk / a,
        };
        signals.push(signal);
        armedShort = false;
      } else if (risk > 0 && !riskOk) {
        armedShort = false;
      }
    }
  }

  // ---------------- context on the final bar --------------------------------
  const last = bars[n - 1];
  const lastIdx = n - 1;
  const rangeHi = highestHigh(bars, lastIdx, cfg.pdLookback);
  const rangeLo = lowestLow(bars, lastIdx, cfg.pdLookback);
  const eq = (rangeHi + rangeLo) / 2;
  const gaps = unfilledFVGs(bars, atrSeries);

  const above = gaps.filter((g) => g.bottom > last.close).sort((x, y) => x.bottom - y.bottom)[0] || null;
  const below = gaps.filter((g) => g.top < last.close).sort((x, y) => y.top - x.top)[0] || null;

  const fresh = signal && signal.barIndex === lastIdx;

  let state = 'FLAT';
  if (fresh) state = signal.side === 'BUY' ? 'SIGNAL_LONG' : 'SIGNAL_SHORT';
  else if (armedLong) state = 'ARMED_LONG';
  else if (armedShort) state = 'ARMED_SHORT';

  const action = fresh ? signal.side : (armedLong || armedShort) ? 'WAIT' : 'NONE';

  return {
    ok: true,
    asOf: new Date().toISOString(),
    barTime: last.time,
    lastBar: last,
    state,
    action,
    signal: fresh ? signal : null,
    lastSignal: signal,               // may be historical; useful for context
    signals,                          // full history, for backtesting
    armed: armedLong
      ? { side: 'LONG', sweptLevel: sweepLow, sweptAt: sweepTimeL, barsRemaining: cfg.confirmBars - (lastIdx - sweepBarL) }
      : armedShort
        ? { side: 'SHORT', sweptLevel: sweepHigh, sweptAt: sweepTimeS, barsRemaining: cfg.confirmBars - (lastIdx - sweepBarS) }
        : null,
    checks,
    context: {
      close: last.close,
      atr: atrSeries[lastIdx],
      dealingRange: { high: rangeHi, low: rangeLo, equilibrium: eq },
      zone: last.close > eq ? 'premium' : 'discount',
      pctOfRange: ((last.close - rangeLo) / (rangeHi - rangeLo)) * 100,
      lastSwingHigh, lastSwingLow,
      buySideLiquidity: lastSwingHigh,
      sellSideLiquidity: lastSwingLow,
      nearestFVGAbove: above,
      nearestFVGBelow: below,
    },
    config: cfg,
  };
}

module.exports = { evaluate, DEFAULTS };
