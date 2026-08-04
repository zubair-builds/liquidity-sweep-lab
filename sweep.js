#!/usr/bin/env node
'use strict';

/**
 * Parameter sweep + walk-forward validation harness.
 *
 * usage:
 *   node sweep.js <bars.json> [minTrades]
 *
 * Two things happen here, and the second one matters more than the first.
 *
 * 1. SWEEP: every combination in GRID is backtested over the whole file and
 *    ranked by expectancy. This number is always flattering. With a grid of N
 *    combinations you are taking the maximum of N noisy estimates, so the top
 *    of the table is selected for luck as much as for edge.
 *
 * 2. WALK-FORWARD: parameters are chosen on the first half of the data only,
 *    then applied unchanged to the second half. The out-of-sample column is
 *    the only one that answers "would this have made money going forward".
 */

const fs = require('fs');
const { backtest } = require('./backtest');
const { normalizeBars } = require('./bars');

const COSTS = { spreadPoints: 0.3, slippagePoints: 0.2 };

const GRID = {
  pivotLen: [3, 4, 5, 6, 7],
  confirmBars: [4, 6, 8, 10],
  rr: [1.5, 2.0, 2.5, 3.0],
  maxRiskATR: [0, 2, 3],
  requireFVG: [true, false],
  requirePD: [true, false],
};

function combos(grid) {
  const keys = Object.keys(grid);
  let out = [{}];
  for (const k of keys) {
    const next = [];
    for (const base of out) for (const v of grid[k]) next.push({ ...base, [k]: v });
    out = next;
  }
  return out;
}

/** Runs one configuration and returns a flat row, or null if it never traded. */
function run(bars, opts) {
  let r;
  try { r = backtest(bars, opts, COSTS); } catch { return null; }
  if (!r || !r.trades || r.trades.length === 0) return null;
  return {
    opts,
    trades: r.trades.length,
    signals: r.signalCount,
    winRate: r.winRate,
    expectancyR: r.expectancyR,
    totalR: r.totalR,
    profitFactor: r.profitFactor,
    maxDD: r.maxDrawdownR,
    ci: r.expectancyCI95,
  };
}

function fmt(row) {
  const o = row.opts;
  const ci = row.ci ? `[${row.ci.low.toFixed(2)}, ${row.ci.high.toFixed(2)}]` : 'n/a';
  return [
    `pivot=${o.pivotLen}`, `conf=${o.confirmBars}`, `rr=${o.rr}`,
    `riskATR=${o.maxRiskATR}`, `fvg=${o.requireFVG ? 'Y' : 'N'}`, `pd=${o.requirePD ? 'Y' : 'N'}`,
  ].join(' ').padEnd(58)
    + `n=${String(row.trades).padStart(3)}  win=${row.winRate.toFixed(0).padStart(3)}%`
    + `  E=${row.expectancyR.toFixed(3).padStart(7)}R  totR=${row.totalR.toFixed(1).padStart(6)}`
    + `  DD=${row.maxDD.toFixed(1).padStart(5)}  CI95=${ci}`;
}

function main() {
  const file = process.argv[2];
  const minTrades = Number(process.argv[3] || 8);
  if (!file) {
    process.stderr.write('usage: node sweep.js <bars.json> [minTrades]\n');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { bars } = normalizeBars(raw.bars !== undefined ? raw.bars : raw);
  const all = combos(GRID);

  console.log(`file: ${file}`);
  console.log(`bars: ${bars.length}  (${bars[0].time} -> ${bars[bars.length - 1].time})`);
  console.log(`grid: ${all.length} combinations   trade floor: ${minTrades}\n`);

  // ---- 1. full-sample sweep -------------------------------------------------
  const rows = all.map((o) => run(bars, o)).filter(Boolean);
  const eligible = rows.filter((r) => r.trades >= minTrades);

  console.log('=== FULL-SAMPLE SWEEP (in-sample, optimistic by construction) ===');
  console.log(`configurations that traded at all: ${rows.length}/${all.length}`);
  console.log(`configurations clearing the ${minTrades}-trade floor: ${eligible.length}`);
  const profitable = eligible.filter((r) => r.expectancyR > 0).length;
  console.log(`of those, positive expectancy: ${profitable} (${eligible.length ? (profitable / eligible.length * 100).toFixed(0) : 0}%)`);
  const ciPositive = eligible.filter((r) => r.ci && r.ci.low > 0).length;
  console.log(`of those, CI95 entirely above zero: ${ciPositive}`);

  const ranked = [...eligible].sort((a, b) => b.expectancyR - a.expectancyR);
  console.log('\ntop 10 by expectancy:');
  ranked.slice(0, 10).forEach((r) => console.log('  ' + fmt(r)));
  console.log('\nbottom 5 by expectancy:');
  ranked.slice(-5).forEach((r) => console.log('  ' + fmt(r)));

  const es = eligible.map((r) => r.expectancyR).sort((a, b) => a - b);
  if (es.length) {
    const q = (p) => es[Math.min(es.length - 1, Math.floor(p * es.length))];
    console.log(`\nexpectancy distribution across eligible configs: `
      + `min=${q(0).toFixed(2)} p25=${q(0.25).toFixed(2)} median=${q(0.5).toFixed(2)} `
      + `p75=${q(0.75).toFixed(2)} max=${es[es.length - 1].toFixed(2)}`);
  }

  // ---- 2. walk-forward ------------------------------------------------------
  const cut = Math.floor(bars.length / 2);
  const inSample = bars.slice(0, cut);
  const outSample = bars.slice(cut);

  console.log(`\n=== WALK-FORWARD ===`);
  console.log(`in-sample:  ${inSample.length} bars (${inSample[0].time} -> ${inSample[inSample.length - 1].time})`);
  console.log(`out-sample: ${outSample.length} bars (${outSample[0].time} -> ${outSample[outSample.length - 1].time})`);

  // A halved sample supports a proportionally smaller trade floor.
  const isFloor = Math.max(3, Math.floor(minTrades / 2));
  const isRows = all.map((o) => run(inSample, o)).filter(Boolean).filter((r) => r.trades >= isFloor);
  if (isRows.length === 0) {
    console.log(`\nno configuration produced >=${isFloor} trades in the first half. `
      + `Walk-forward cannot be run on this sample.`);
    return;
  }
  isRows.sort((a, b) => b.expectancyR - a.expectancyR);
  const best = isRows[0];

  console.log(`\nconfigs clearing the ${isFloor}-trade floor in-sample: ${isRows.length}`);
  console.log(`selected on first half only:\n  ${fmt(best)}`);

  const oos = run(outSample, best.opts);
  console.log(`\nsame parameters, held-out second half:`);
  console.log(oos ? `  ${fmt(oos)}` : '  no trades at all out-of-sample');

  // Selecting the in-sample best is itself the thing under test, so also report
  // what the whole in-sample top decile did out-of-sample. If only the single
  // winner survives, that is noise; if the decile survives, that is a signal.
  const decile = isRows.slice(0, Math.max(1, Math.floor(isRows.length * 0.1)));
  const oosRows = decile.map((r) => run(outSample, r.opts)).filter(Boolean);
  if (oosRows.length) {
    const mean = oosRows.reduce((a, r) => a + r.expectancyR, 0) / oosRows.length;
    const pos = oosRows.filter((r) => r.expectancyR > 0).length;
    const isMean = decile.reduce((a, r) => a + r.expectancyR, 0) / decile.length;
    console.log(`\nin-sample top decile (${decile.length} configs):`);
    console.log(`  mean expectancy in-sample:  ${isMean.toFixed(3)}R`);
    console.log(`  mean expectancy out-sample: ${mean.toFixed(3)}R`);
    console.log(`  still positive out-of-sample: ${pos}/${oosRows.length}`);
    console.log(`  decay: ${(isMean - mean).toFixed(3)}R lost moving to unseen data`);
  }
}

// Exported so report.js can reuse the exact same grid, runner and cost model.
// Keeping one definition means the document can never drift from the sweep.
module.exports = { GRID, COSTS, combos, run };

if (require.main === module) main();
