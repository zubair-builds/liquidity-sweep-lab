#!/usr/bin/env node
'use strict';

const { backtest } = require('./backtest');
const { normalizeBars } = require('./bars');
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  process.stderr.write('usage: node trades.js <bars.json|-> [key=value...]\n');
  process.exit(1);
}

// Read and normalize bars
const raw = JSON.parse(fs.readFileSync(file === '-' ? 0 : file, 'utf8'));
const { bars } = normalizeBars(raw.bars !== undefined ? raw.bars : raw);

// Parse overrides
const opts = {};
for (const arg of process.argv.slice(3)) {
  const [k, v] = arg.split('=');
  opts[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
}

// Run backtest
const r = backtest(bars, opts, { spreadPoints: 0.3, slippagePoints: 0.2 });

if (!r.trades || r.trades.length === 0) {
  console.log("No closed trades in this sample.");
} else {
  // Format trade data for console.table
  const tableData = r.trades.map(t => ({
    time: t.time.slice(0, 16).replace('T', ' '),
    side: t.side,
    outcome: t.outcome,
    R: +t.r.toFixed(2)
  }));
  
  console.table(tableData);
}
