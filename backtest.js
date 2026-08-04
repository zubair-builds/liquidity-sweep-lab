#!/usr/bin/env node
'use strict';

const { evaluate } = require('./model');

/**
 * Walks each signal forward bar by bar and records which level was reached.
 *
 * Ambiguity rule: when a bar's range contains BOTH the stop and the target,
 * this counts a loss. Bar data cannot tell us which was touched first, and
 * assuming the favourable outcome is how backtests end up lying to you. On
 * wide-target settings this understates real performance — verify anything
 * promising on lower-timeframe data before trusting it.
 */
function backtest(bars, opts = {}, costs = {}) {
  const spread = costs.spreadPoints ?? 0;      // charged once, on entry
  const slipPts = costs.slippagePoints ?? 0;   // charged on entry and exit

  const res = evaluate(bars, opts);
  if (!res.ok) return res;

  const trades = [];

  for (const sig of res.signals) {
    const long = sig.side === 'BUY';
    const cost = spread + slipPts * 2;
    let outcome = 'OPEN', exitPrice = null, exitTime = null, barsHeld = 0;

    for (let i = sig.barIndex + 1; i < bars.length; i++) {
      const b = bars[i];
      barsHeld = i - sig.barIndex;
      const hitStop = long ? b.low <= sig.stop : b.high >= sig.stop;
      const hitTgt = long ? b.high >= sig.target : b.low <= sig.target;

      if (hitStop) { outcome = 'LOSS'; exitPrice = sig.stop; exitTime = b.time; break; }
      if (hitTgt) { outcome = 'WIN'; exitPrice = sig.target; exitTime = b.time; break; }
    }

    if (outcome === 'OPEN') continue;

    const gross = long ? exitPrice - sig.entry : sig.entry - exitPrice;
    const net = gross - cost;
    trades.push({
      side: sig.side, time: sig.time, entry: sig.entry, stop: sig.stop,
      target: sig.target, exitPrice, exitTime, outcome,
      barsHeld, riskPoints: sig.riskPoints, riskInATR: sig.riskInATR,
      netPoints: net, netPercent: (net / sig.entry) * 100, r: net / sig.riskPoints,
    });
  }

  return { ...summarise(trades), trades, signalCount: res.signals.length };
}

function summarise(trades) {
  const n = trades.length;
  if (n === 0) return { trades: 0, note: 'no closed trades in this sample' };

  const wins = trades.filter((t) => t.outcome === 'WIN');
  const losses = trades.filter((t) => t.outcome === 'LOSS');
  const rs = trades.map((t) => t.r);
  const totalR = rs.reduce((a, b) => a + b, 0);
  const netPercents = trades.map((t) => t.netPercent);
  const totalNetPercent = netPercents.reduce((a, b) => a + b, 0);
  const grossWin = wins.reduce((a, t) => a + t.netPoints, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPoints, 0));

  // Max drawdown measured on the cumulative R curve
  let peak = 0, cum = 0, maxDD = 0;
  for (const r of rs) {
    cum += r;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
  }

  // Longest losing streak
  let streak = 0, worstStreak = 0;
  for (const t of trades) {
    streak = t.outcome === 'LOSS' ? streak + 1 : 0;
    worstStreak = Math.max(worstStreak, streak);
  }

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / n) * 100,
    totalR,
    totalNetPercent,
    avgNetPercent: totalNetPercent / n,
    expectancyR: totalR / n,
    avgWinPoints: wins.length > 0 ? grossWin / wins.length : 0,
    avgLossPoints: losses.length > 0 ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    maxDrawdownR: maxDD,
    longestLosingStreak: worstStreak,
    avgBarsHeld: trades.reduce((a, t) => a + t.barsHeld, 0) / n,
    // A 95% confidence interval on expectancy. If this straddles zero, the
    // sample does not distinguish the model from a coin flip.
    expectancyCI95: ci95(rs),
  };
}

function ci95(xs) {
  const n = xs.length;
  if (n < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return { low: mean - 1.96 * se, high: mean + 1.96 * se };
}

module.exports = { backtest };

if (require.main === module) {
  const fs = require('fs');
  const { normalizeBars } = require('./bars');

  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: node backtest.js <bars.json|-> [key=value...]\n');
    process.exit(1);
  }

  // Either accepted payload shape, so a file saved straight out of the IBKR
  // connector can be replayed without reshaping it first.
  const raw = JSON.parse(fs.readFileSync(file === '-' ? 0 : file, 'utf8'));
  const { bars } = normalizeBars(raw.bars !== undefined ? raw.bars : raw);

  const opts = {};
  for (const a of process.argv.slice(3)) {
    const [k, v] = a.split('=');
    opts[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
  }
  const out = backtest(bars, opts, { spreadPoints: 0.3, slippagePoints: 0.2 });
  const { trades, ...stats } = out;
  process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
}
