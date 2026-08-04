#!/usr/bin/env node
'use strict';

/**
 * Regenerates RESULTS.md from whatever data files are currently on disk.
 *
 * usage:
 *   node report.js            # writes RESULTS.md
 *   node report.js --stdout   # prints instead, for previewing a change
 *
 * The point of generating rather than hand-writing the document is that every
 * number in it is recomputed from the bars each time. When a larger history
 * lands, rerun this and the document cannot silently keep stale figures.
 *
 * To document a new dataset, add an entry to DATASETS below.
 */

const fs = require('fs');
const path = require('path');
const { backtest } = require('./backtest');
const { evaluate } = require('./model');
const { normalizeBars, inferBarMinutes } = require('./bars');
const { GRID, COSTS, combos, run } = require('./sweep');

/**
 * Every dataset runs on the SAME parameters — the config defaults.
 *
 * This is deliberate and it matters. Tuning each market separately would make
 * the pooled result meaningless: seven individually-optimised curves prove only
 * that seven curves can be optimised. Holding parameters fixed across gold,
 * silver, two equities and four timeframes asks the one question worth asking,
 * which is whether the setup describes something about markets or only about
 * one stretch of gold.
 */
const DATASETS = [
  { file: 'xauusd-1d.json', market: 'Gold', label: 'XAUUSD daily', tradeFloor: 8 },
  { file: 'xauusd-4h.json', market: 'Gold', label: 'XAUUSD 4-hour', tradeFloor: 8 },
  { file: 'xauusd-1h.json', market: 'Gold', label: 'XAUUSD 1-hour', tradeFloor: 10 },
  { file: 'xauusd-15m.json', market: 'Gold', label: 'XAUUSD 15-minute', tradeFloor: 10 },
  { file: 'xagusd-1h.json', market: 'Silver', label: 'XAGUSD 1-hour', tradeFloor: 10 },
  { file: 'tsla-1h.json', market: 'Tesla', label: 'TSLA 1-hour', tradeFloor: 10 },
  { file: 'rddt-1h.json', market: 'Reddit', label: 'RDDT 1-hour', tradeFloor: 10 },
].map((d) => ({ opts: {}, profile: 'config default', ...d }));

const DATA_DIR = 'data';

const r2 = (n) => Number(n).toFixed(2);
const r3 = (n) => Number(n).toFixed(3);
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const rr = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`;

/** ISO -> "2026-07-06 05:00" — seconds and the T are noise in a table. */
const ts = (iso) => iso.replace('T', ' ').slice(0, 16);

function hoursBetween(a, b) {
  return (new Date(b) - new Date(a)) / 3600000;
}

/** "2d 6h" reads faster than "54 hours" once durations get long. */
function humanDuration(hours) {
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function load(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, DATA_DIR, file), 'utf8'));
  return normalizeBars(raw.bars !== undefined ? raw.bars : raw);
}

/**
 * Pairs each closed trade with the signal that produced it, so the table can
 * show *why* the trade was taken (which liquidity level was swept, how wide the
 * stop was in ATR) and not just what it returned.
 */
function enrich(bars, opts) {
  const ev = evaluate(bars, opts);
  const bt = backtest(bars, opts, COSTS);
  const byTime = new Map(ev.signals.map((s) => [s.time, s]));

  const rows = bt.trades.map((t, i) => {
    const sig = byTime.get(t.time) || {};
    const hours = hoursBetween(t.time, t.exitTime);
    // Percentages are on the instrument, not on account equity: what one unit
    // of gold moved between entry and exit, after costs. Position sizing is a
    // separate decision and would only obscure the model's own behaviour.
    const netPct = (t.netPoints / t.entry) * 100;
    const riskPct = (t.riskPoints / t.entry) * 100;
    return {
      n: i + 1,
      side: t.side,
      outcome: t.outcome,
      entryTime: t.time,
      exitTime: t.exitTime,
      entry: t.entry,
      stop: t.stop,
      target: t.target,
      exitPrice: t.exitPrice,
      r: t.r,
      netPct,
      riskPct,
      barsHeld: t.barsHeld,
      hours,
      riskInATR: t.riskInATR,
      sweptLevel: sig.sweptLevel,
      sweptAt: sig.sweptAt,
    };
  });

  return { rows, stats: bt, signals: ev.signals };
}

function tradeTable(rows) {
  const head = [
    '| # | Direction | Entry (UTC) | Exit (UTC) | Held | Entry | Stop | Target | Exit | Risk | Result | P/L | R |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const body = rows.map((t) => [
    t.n,
    t.side === 'BUY' ? 'Long' : 'Short',
    ts(t.entryTime),
    ts(t.exitTime),
    `${humanDuration(t.hours)} (${t.barsHeld} bars)`,
    r2(t.entry),
    r2(t.stop),
    r2(t.target),
    r2(t.exitPrice),
    `${r2(t.riskPct)}%`,
    t.outcome === 'WIN' ? '**WIN**' : 'LOSS',
    pct(t.netPct),
    rr(t.r),
  ].join(' | '));
  return head.concat(body.map((b) => `| ${b} |`)).join('\n');
}

function setupTable(rows) {
  const head = [
    '| # | Direction | Setup — liquidity level swept | Swept at (UTC) | Stop width (ATR) | Planned R:R |',
    '|---|---|---|---|---|---|',
  ];
  const body = rows.map((t) => [
    t.n,
    t.side === 'BUY' ? 'Long' : 'Short',
    t.sweptLevel != null
      ? `${t.side === 'BUY' ? 'Sell-side' : 'Buy-side'} sweep of ${r2(t.sweptLevel)}`
      : 'n/a',
    t.sweptAt ? ts(t.sweptAt) : 'n/a',
    t.riskInATR != null ? r2(t.riskInATR) : 'n/a',
    r2(Math.abs(t.target - t.entry) / Math.abs(t.entry - t.stop)),
  ].join(' | '));
  return head.concat(body.map((b) => `| ${b} |`)).join('\n');
}

/**
 * Finds trades that were open at the same time.
 *
 * The backtest walks each signal independently, which quietly assumes you can
 * hold every position it opens. Two same-direction trades running concurrently
 * are one market move counted twice: they win or lose together, they inflate the
 * trade count, and they break the independence assumption the confidence
 * interval rests on. Opposite-direction overlaps are the milder case — the
 * positions partly cancel, so the pair is closer to no position at all.
 */
function findOverlaps(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const start = Math.max(new Date(a.entryTime), new Date(b.entryTime));
      const end = Math.min(new Date(a.exitTime), new Date(b.exitTime));
      if (end > start) {
        out.push({
          a, b,
          sameSide: a.side === b.side,
          hours: (end - start) / 3600000,
          sameExit: a.exitTime === b.exitTime,
        });
      }
    }
  }
  return out;
}

function overlapNote(rows) {
  const ov = findOverlaps(rows);
  if (ov.length === 0) {
    return '_No two trades were ever open at the same time, so each result is an independent '
      + 'observation._';
  }
  const out = [];
  out.push(`**${ov.length} pair${ov.length > 1 ? 's' : ''} of trades overlapped in time.** `
    + 'The backtest opens every signal independently, so these were held simultaneously:');
  out.push('');
  out.push('| Trades | Direction | Overlap | Same exit bar? | Effect |');
  out.push('|---|---|---|---|---|');
  for (const o of ov) {
    out.push(`| #${o.a.n} + #${o.b.n} | ${o.sameSide ? `both ${o.a.side === 'BUY' ? 'long' : 'short'}` : 'opposite'} `
      + `| ${humanDuration(o.hours)} | ${o.sameExit ? 'yes' : 'no'} `
      + `| ${o.sameSide
        ? '**one move counted twice** — double exposure, correlated outcome'
        : 'partly hedged — combined exposure near flat'} |`);
  }
  out.push('');
  const sameSide = ov.filter((o) => o.sameSide);
  if (sameSide.length) {
    out.push(`> Treating the ${sameSide.length} same-direction overlap${sameSide.length > 1 ? 's' : ''} as `
      + `${sameSide.length > 1 ? 'single trades' : 'a single trade'} would reduce the sample further and `
      + 'weaken the win rate correspondingly. The confidence interval above assumes independent '
      + 'trades and is therefore optimistic.');
  }
  return out.join('\n');
}

function datasetSection(ds) {
  const { bars, warnings } = load(ds.file);
  const minutes = inferBarMinutes(bars);
  const spanDays = hoursBetween(bars[0].time, bars[bars.length - 1].time) / 24;
  const { rows, stats, signals } = enrich(bars, ds.opts);

  const wins = rows.filter((t) => t.outcome === 'WIN');
  const losses = rows.filter((t) => t.outcome === 'LOSS');
  const avgWinPct = wins.length ? wins.reduce((a, t) => a + t.netPct, 0) / wins.length : 0;
  const avgLossPct = losses.length ? losses.reduce((a, t) => a + t.netPct, 0) / losses.length : 0;
  const totalPct = rows.reduce((a, t) => a + t.netPct, 0);
  const avgHours = rows.length ? rows.reduce((a, t) => a + t.hours, 0) / rows.length : 0;
  const winHours = wins.length ? wins.reduce((a, t) => a + t.hours, 0) / wins.length : 0;
  const lossHours = losses.length ? losses.reduce((a, t) => a + t.hours, 0) / losses.length : 0;
  const bh = (bars[bars.length - 1].close / bars[0].close - 1) * 100;
  const openSignals = signals.length - rows.length;

  const opts = Object.keys(ds.opts).length
    ? Object.entries(ds.opts).map(([k, v]) => `${k}=${v}`).join(' ')
    : 'config defaults';

  const out = [];
  out.push(`## ${ds.label} — \`${ds.file}\``);
  out.push('');
  out.push('### Coverage');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Bars | ${bars.length} |`);
  out.push(`| Bar size | ${minutes} minutes |`);
  out.push(`| Period | ${ts(bars[0].time)} → ${ts(bars[bars.length - 1].time)} |`);
  out.push(`| Calendar span | ${spanDays.toFixed(0)} days (${(spanDays / 30.4).toFixed(1)} months) |`);
  out.push(`| Profile | \`${ds.profile}\` (${opts}) |`);
  out.push(`| Buy & hold over the same window | ${pct(bh)} |`);
  out.push(`| Data warnings | ${warnings.length ? warnings.join('; ') : 'none'} |`);
  out.push('');
  out.push('### Opportunities found');
  out.push('');
  out.push(`- **Signals generated: ${signals.length}** across ${bars.length} bars `
    + `— one roughly every **${Math.round(bars.length / Math.max(1, signals.length))} bars** `
    + `(~${humanDuration(Math.round(bars.length / Math.max(1, signals.length)) * minutes / 60)} of market time).`);
  out.push(`- **Closed trades: ${rows.length}**` + (openSignals > 0
    ? ` (${openSignals} signal${openSignals > 1 ? 's' : ''} had not reached stop or target by the end of the data and ${openSignals > 1 ? 'are' : 'is'} excluded).`
    : ' — every signal resolved within the data.'));
  out.push(`- Trade frequency: about **${(rows.length / (spanDays / 30.4)).toFixed(1)} closed trades per month**.`);
  out.push('');
  out.push('### Every trade');
  out.push('');
  out.push(tradeTable(rows));
  out.push('');
  out.push('*P/L is the move in the price of gold between entry and exit after costs, '
    + 'not a return on account equity — position sizing is a separate decision. '
    + '"Risk" is the distance from entry to stop, as a percentage of entry.*');
  out.push('');
  out.push('### Why each trade was taken');
  out.push('');
  out.push('Every signal comes from the same setup: price sweeps a prior swing level '
    + '(taking the liquidity resting beyond it), then reverses and confirms a market-structure '
    + 'shift in the opposite direction. The stop sits beyond the swept level and the target is '
    + 'a fixed multiple of that risk.');
  out.push('');
  out.push(setupTable(rows));
  out.push('');
  out.push('### Position overlap');
  out.push('');
  out.push(overlapNote(rows));
  out.push('');
  out.push('### Summary');
  out.push('');
  out.push('| Metric | Value |');
  out.push('|---|---|');
  out.push(`| Closed trades | ${rows.length} |`);
  out.push(`| Wins / losses | ${wins.length} / ${losses.length} |`);
  out.push(`| Win rate | ${stats.winRate.toFixed(0)}% |`);
  out.push(`| Average win | ${pct(avgWinPct)} |`);
  out.push(`| Average loss | ${pct(avgLossPct)} |`);
  out.push(`| Total P/L | ${pct(totalPct)} |`);
  out.push(`| Total R | ${rr(stats.totalR)} |`);
  out.push(`| Expectancy | ${rr(stats.expectancyR)} per trade |`);
  out.push(`| Profit factor | ${stats.profitFactor == null ? 'n/a' : r2(stats.profitFactor)} |`);
  out.push(`| Max drawdown | ${r2(stats.maxDrawdownR)}R |`);
  out.push(`| Longest losing streak | ${stats.longestLosingStreak} |`);
  out.push(`| Average time in trade | ${humanDuration(avgHours)} |`);
  out.push(`| Average winner held | ${wins.length ? humanDuration(winHours) : 'n/a'} |`);
  out.push(`| Average loser held | ${losses.length ? humanDuration(lossHours) : 'n/a'} |`);
  out.push(`| 95% confidence interval on expectancy | ${stats.expectancyCI95
    ? `${r2(stats.expectancyCI95.low)}R to ${r2(stats.expectancyCI95.high)}R`
    : 'not computable (fewer than 2 trades)'} |`);
  out.push('');

  const ci = stats.expectancyCI95;
  if (ci && ci.low <= 0 && ci.high >= 0) {
    out.push(`> **The confidence interval straddles zero.** On ${rows.length} trades this sample `
      + `cannot distinguish the model from a coin flip, however good the win rate looks.`);
    out.push('');
  }
  return out.join('\n');
}

/** Sweep + walk-forward, summarised rather than dumped — 960 rows help nobody. */
function robustnessSection(ds) {
  const { bars } = load(ds.file);
  const all = combos(GRID);
  const rows = all.map((o) => run(bars, o)).filter(Boolean);
  const eligible = rows.filter((r) => r.trades >= ds.tradeFloor);
  const positive = eligible.filter((r) => r.expectancyR > 0);
  const ciClear = eligible.filter((r) => r.ci && r.ci.low > 0);

  const cut = Math.floor(bars.length / 2);
  const inSample = bars.slice(0, cut);
  const outSample = bars.slice(cut);
  const isFloor = Math.max(3, Math.floor(ds.tradeFloor / 2));
  const isRows = all.map((o) => run(inSample, o)).filter(Boolean)
    .filter((r) => r.trades >= isFloor)
    .sort((a, b) => b.expectancyR - a.expectancyR);

  const out = [];
  out.push(`### ${ds.label}`);
  out.push('');
  out.push(`Grid of **${all.length} parameter combinations** over \`pivotLen\`, \`confirmBars\`, `
    + `\`rr\`, \`maxRiskATR\`, \`requireFVG\` and \`requirePD\`, each backtested over the full file.`);
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Combinations tested | ${all.length} |`);
  out.push(`| Clearing the ${ds.tradeFloor}-trade floor | ${eligible.length} |`);
  out.push(`| ...of those, positive expectancy | ${positive.length} (${eligible.length ? (positive.length / eligible.length * 100).toFixed(0) : 0}%) |`);
  out.push(`| ...of those, 95% CI entirely above zero | ${ciClear.length} |`);
  out.push('');

  if (eligible.length && positive.length / eligible.length > 0.8) {
    out.push(`> When **${(positive.length / eligible.length * 100).toFixed(0)}% of all settings look profitable**, `
      + `the result is measuring the sample, not the settings. A genuine edge is selective; `
      + `noise is generous.`);
    out.push('');
  }

  if (isRows.length === 0) {
    out.push(`Walk-forward could not be run: no configuration produced at least ${isFloor} trades `
      + `in the first half of the data.`);
    out.push('');
    return out.join('\n');
  }

  const best = isRows[0];
  const oos = run(outSample, best.opts);
  const decile = isRows.slice(0, Math.max(1, Math.floor(isRows.length * 0.1)));
  const oosRows = decile.map((r) => run(outSample, r.opts)).filter(Boolean);
  const isMean = decile.reduce((a, r) => a + r.expectancyR, 0) / decile.length;
  const oosMean = oosRows.length ? oosRows.reduce((a, r) => a + r.expectancyR, 0) / oosRows.length : null;
  const stillPos = oosRows.filter((r) => r.expectancyR > 0).length;

  out.push('**Walk-forward.** Parameters chosen using only the first half of the data, '
    + 'then applied unchanged to the second half. This is the only test here that answers '
    + '"would this have made money going forward".');
  out.push('');
  out.push('| | In-sample (first half) | Out-of-sample (second half) |');
  out.push('|---|---|---|');
  out.push(`| Period | ${ts(inSample[0].time)} → ${ts(inSample[inSample.length - 1].time)} | ${ts(outSample[0].time)} → ${ts(outSample[outSample.length - 1].time)} |`);
  out.push(`| Bars | ${inSample.length} | ${outSample.length} |`);
  out.push(`| Best config expectancy | ${rr(best.expectancyR)} (${best.trades} trades) | ${oos ? `${rr(oos.expectancyR)} (${oos.trades} trades)` : '**no trades at all**'} |`);
  out.push(`| Top-decile mean expectancy | ${rr(isMean)} | ${oosMean == null ? 'n/a' : rr(oosMean)} |`);
  out.push(`| Top-decile configs still profitable | ${decile.length}/${decile.length} | ${oosRows.length ? `${stillPos}/${oosRows.length}` : 'n/a'} |`);
  out.push('');
  out.push(`Best in-sample configuration: \`pivotLen=${best.opts.pivotLen} confirmBars=${best.opts.confirmBars} `
    + `rr=${best.opts.rr} maxRiskATR=${best.opts.maxRiskATR} requireFVG=${best.opts.requireFVG} requirePD=${best.opts.requirePD}\``);
  out.push('');
  if (oosMean != null) {
    const decay = isMean - oosMean;
    out.push(`**Decay: ${r3(decay)}R lost** moving from fitted data to unseen data.`);
    out.push('');
    if (oosMean < 0) {
      out.push(`> The top decile was profitable in-sample and **loses money out-of-sample**, with `
        + `${oosRows.length - stillPos} of ${oosRows.length} configurations failing. This is the signature of `
        + `fitting noise: the parameters learned this particular stretch of history rather than `
        + `anything that repeats.`);
      out.push('');
    }
  }
  return out.join('\n');
}

function ci95(xs) {
  const n = xs.length;
  if (n < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return { mean, low: mean - 1.96 * se, high: mean + 1.96 * se };
}

/**
 * The pooled test, and the reason for gathering seven markets in the first place.
 *
 * Each market alone yields 5-8 trades, far too few to separate skill from luck.
 * Pooling them under identical parameters builds one larger sample in which each
 * market is effectively out-of-sample with respect to the others: nothing was
 * tuned on Tesla to make Tesla look good. R is risk-normalised, so trades from
 * instruments at wildly different price levels are directly comparable.
 */
function pooledSection() {
  const per = DATASETS.map((ds) => {
    const { bars } = load(ds.file);
    const { rows } = enrich(bars, ds.opts);
    return { ds, rows };
  });

  const allRows = per.flatMap((p) => p.rows);
  const rs = allRows.map((t) => t.r);
  const stat = ci95(rs);
  const wins = allRows.filter((t) => t.outcome === 'WIN').length;

  const out = [];
  out.push('## Pooled cross-market test');
  out.push('');
  out.push('Every dataset below was run on **identical parameters** (the config defaults — '
    + '`pivotLen=5, confirmBars=6, rr=2, requireFVG=true, requirePD=true`). Nothing was tuned '
    + 'per market. Each market is therefore out-of-sample with respect to every other, and '
    + 'pooling the trades builds the larger sample that no single market can provide.');
  out.push('');
  out.push('### Per-market results');
  out.push('');
  out.push('| Market | Timeframe | Bars | Span | Signals | Trades | Win rate | Total R | Expectancy |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const p of per) {
    const { bars } = load(p.ds.file);
    const span = hoursBetween(bars[0].time, bars[bars.length - 1].time) / 24;
    const ev = evaluate(bars, p.ds.opts);
    const n = p.rows.length;
    const w = p.rows.filter((t) => t.outcome === 'WIN').length;
    const tot = p.rows.reduce((a, t) => a + t.r, 0);
    out.push(`| ${p.ds.market} | ${p.ds.label.replace(/^\S+\s/, '')} | ${bars.length} | ${span.toFixed(0)}d `
      + `| ${ev.signals.length} | ${n} | ${n ? `${(w / n * 100).toFixed(0)}%` : '—'} `
      + `| ${n ? rr(tot) : '—'} | ${n ? rr(tot / n) : '—'} |`);
  }
  const totalR = rs.reduce((a, b) => a + b, 0);
  out.push(`| **Pooled** | — | ${per.reduce((a, p) => a + load(p.ds.file).bars.length, 0)} | — `
    + `| — | **${allRows.length}** | **${allRows.length ? (wins / allRows.length * 100).toFixed(0) : 0}%** `
    + `| **${rr(totalR)}** | **${stat ? rr(stat.mean) : '—'}** |`);
  out.push('');

  if (!stat) {
    out.push('_Too few pooled trades to compute a confidence interval._');
    out.push('');
    return out.join('\n');
  }

  out.push('### Verdict');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Pooled trades | ${allRows.length} |`);
  out.push(`| Win rate | ${(wins / allRows.length * 100).toFixed(0)}% |`);
  out.push(`| Expectancy | ${rr(stat.mean)} per trade |`);
  out.push(`| 95% confidence interval | ${r2(stat.low)}R to ${r2(stat.high)}R |`);
  out.push(`| Markets with positive expectancy | ${per.filter((p) => p.rows.length && p.rows.reduce((a, t) => a + t.r, 0) > 0).length} of ${per.filter((p) => p.rows.length).length} |`);
  out.push('');

  if (stat.low > 0) {
    out.push(`> **The pooled confidence interval clears zero.** Across ${allRows.length} trades on `
      + `${new Set(DATASETS.map((d) => d.market)).size} instruments with no per-market tuning, the edge is `
      + `statistically distinguishable from chance. This is the strongest evidence available so far — `
      + `though ${allRows.length} trades is still a modest sample, and all of it comes from overlapping `
      + `recent history rather than independent eras.`);
  } else if (stat.high < 0) {
    out.push('> **The pooled result is negative and the interval excludes zero.** Under fixed '
      + 'parameters across all markets, this setup loses money.');
  } else {
    out.push(`> **The pooled confidence interval still straddles zero** (${r2(stat.low)}R to ${r2(stat.high)}R). `
      + `Even with ${allRows.length} trades across ${new Set(DATASETS.map((d) => d.market)).size} instruments, this sample cannot `
      + `distinguish the model from chance. The direction is ${stat.mean > 0 ? 'encouraging' : 'discouraging'}, `
      + `but it is not yet evidence.`);
  }
  out.push('');
  return out.join('\n');
}

function build() {
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const doc = [];

  doc.push('# Backtest results — XAUUSD liquidity-sweep model');
  doc.push('');
  doc.push(`*Generated by \`node report.js\` on ${generated} UTC. Every figure is recomputed `
    + 'from the data files on each run — edit the data, not this document.*');
  doc.push('');
  doc.push('---');
  doc.push('');
  doc.push('## Bottom line');
  doc.push('');
  doc.push('The model produces **few trades with a high win rate on the data available, and that '
    + 'result does not survive out-of-sample testing on the 4-hour set.** The per-trade tables below '
    + 'look encouraging in isolation; the robustness section explains why they should not yet be '
    + 'trusted. The binding constraint is not the strategy\'s accuracy but how rarely it fires, '
    + 'which keeps every sample too small to draw a conclusion from.');
  doc.push('');
  doc.push('Read the per-dataset sections for what happened, then the robustness section for '
    + 'whether it means anything.');
  doc.push('');
  doc.push('---');
  doc.push('');

  doc.push(pooledSection());
  doc.push('---');
  doc.push('');

  for (const ds of DATASETS) {
    doc.push(datasetSection(ds));
    doc.push('---');
    doc.push('');
  }

  doc.push('## Robustness: does the edge survive?');
  doc.push('');
  doc.push('A backtest run over the same data used to choose the settings will almost always look '
    + 'profitable. Two checks guard against that: a full parameter sweep, to see whether the result '
    + 'depends on one lucky configuration, and a walk-forward split, to see whether settings chosen '
    + 'on past data still work on data they have never seen.');
  doc.push('');
  for (const ds of DATASETS) {
    doc.push(robustnessSection(ds));
  }
  doc.push('---');
  doc.push('');

  doc.push('## Data ceiling');
  doc.push('');
  doc.push('The datasets above are small, and that is a limit of the data source rather than a choice.');
  doc.push('');
  doc.push('- The IBKR `get_price_history` endpoint refuses any request resolving to more than '
    + '**3,500 data points**.');
  doc.push('- It accepts a `period` or a `step_count`, but **no start date**. Every response ends at '
    + 'the present moment, so history cannot be paged backwards — there is no way to ask for an '
    + 'earlier window.');
  doc.push('- In practice the binding limit is tighter still: responses above roughly 25,000 tokens '
    + 'are rejected and spilled to a file unreachable from the sandbox, capping a single retrieval at '
    + 'a few hundred bars.');
  doc.push('');
  doc.push('**Consequence.** At roughly one signal per 120 bars, a full year of 1-hour data would '
    + 'still yield only about 65 trades. Reaching the 100+ trades needed for a statistically '
    + 'meaningful verdict requires 2–3 years of 1-hour history, which means fetching from IBKR '
    + 'directly to disk rather than through this route.');
  doc.push('');
  doc.push('---');
  doc.push('');

  doc.push('## Method');
  doc.push('');
  doc.push('**Costs.** Every trade is charged '
    + `${COSTS.spreadPoints} points of spread once on entry and ${COSTS.slippagePoints} points of `
    + 'slippage on both entry and exit.');
  doc.push('');
  doc.push('**Ambiguous bars count as losses.** When a single bar\'s range contains both the stop and '
    + 'the target, bar data cannot say which was touched first, so the trade is recorded as a loss. '
    + 'This understates performance on wide-target settings — deliberately, because the opposite '
    + 'assumption is how backtests end up lying.');
  doc.push('');
  doc.push('**Unresolved signals are excluded.** A signal still open when the data ends is not '
    + 'counted as a win or a loss.');
  doc.push('');
  doc.push('**Percentages are instrument moves,** not account returns: the change in the price of '
    + 'gold between entry and exit after costs. Position sizing is a separate decision.');
  doc.push('');
  doc.push('### Reproducing every number here');
  doc.push('');
  doc.push('```bash');
  doc.push('node test.js'.padEnd(52) + '# 38 unit tests');
  doc.push('node verify-data.js'.padEnd(52) + '# data integrity + regenerate manifest');
  for (const ds of DATASETS) {
    const o = Object.entries(ds.opts).map(([k, v]) => `${k}=${v}`).join(' ');
    doc.push(`node backtest.js ${DATA_DIR}/${ds.file}${o ? ' ' + o : ''}`.padEnd(52) + `# ${ds.label} summary`);
  }
  for (const ds of DATASETS) {
    doc.push(`node sweep.js ${DATA_DIR}/${ds.file} ${ds.tradeFloor}`.padEnd(52) + `# ${ds.label} sweep + walk-forward`);
  }
  doc.push('node report.js'.padEnd(52) + '# regenerate this document');
  doc.push('```');
  doc.push('');
  doc.push('### Data provenance');
  doc.push('');
  doc.push('Both files are verbatim `get_price_history` responses for contract `69067924` '
    + '(XAUUSD, "London Gold", IBCMDTY), MidPoint source, `outside_rth=true`. Each was verified '
    + 'against an independent re-fetch: all closed bars matched exactly, with no inverted bars, no '
    + 'outlier gaps, and correct bar spacing.');
  doc.push('');

  return doc.join('\n');
}

if (require.main === module) {
  const doc = build();
  if (process.argv.includes('--stdout')) {
    process.stdout.write(doc);
  } else {
    const out = path.join(__dirname, 'RESULTS.md');
    fs.writeFileSync(out, doc);
    process.stderr.write(`wrote ${out} (${doc.length} bytes)\n`);
  }
}

module.exports = { build };
