#!/usr/bin/env node
'use strict';

/**
 * Runs the same analysis as POST /analyze, but against a local file or stdin
 * instead of an HTTP request. Useful for replaying a saved history without
 * starting the server, and for checking that a payload parses before sending it.
 *
 * usage:
 *   node cli.js bars.json [instrument] [timeframe] [key=value...]
 *   cat bars.json | node cli.js - XAUUSD 1h maxRiskATR=3
 *
 * The file may be in either shape the server accepts.
 */

const fs = require('fs');
const path = require('path');
const { handleAnalyze } = require('./server');
const { DEFAULTS } = require('./model');

const CONFIG_PATH = process.env.ICT_CONFIG || path.join(__dirname, 'config.json');

/**
 * Accepts either a bare bars payload (in either shape) or a whole saved request
 * body with a `bars` key. Saving the exact JSON you POST is the obvious thing to
 * do, so the CLI should read that back without the file needing to be edited.
 */
function readInput(src) {
  const raw = JSON.parse(fs.readFileSync(src === '-' ? 0 : src, 'utf8'));
  const isRequestBody = raw && !Array.isArray(raw) && typeof raw === 'object' && raw.bars !== undefined;
  return isRequestBody ? raw : { bars: raw };
}

/** key=value arguments are typed against DEFAULTS so booleans stay booleans. */
function parseOverrides(args) {
  const out = {};
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq < 0) throw new Error(`expected key=value, got "${a}"`);
    const k = a.slice(0, eq);
    const v = a.slice(eq + 1);
    if (!(k in DEFAULTS)) throw new Error(`unknown model parameter "${k}"`);
    out[k] = typeof DEFAULTS[k] === 'boolean' ? v === 'true' : Number(v);
    if (typeof DEFAULTS[k] === 'number' && Number.isNaN(out[k])) {
      throw new Error(`"${k}" expects a number, got "${v}"`);
    }
  }
  return out;
}

function main() {
  const [src, instrument, timeframe, ...rest] = process.argv.slice(2);
  if (!src) {
    process.stderr.write('usage: node cli.js <bars.json|-> [instrument] [timeframe] [key=value...]\n');
    process.exit(2);
  }

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* config is optional */ }

  const input = readInput(src);
  const body = {
    // A file on disk is a completed history; nothing in it is still forming.
    lastBarClosed: src !== '-',
    ...input,
    // Command-line arguments beat anything baked into the file.
    instrument: instrument || input.instrument || null,
    timeframe: timeframe || input.timeframe || null,
    model: { ...(input.model || {}), ...parseOverrides(rest) },
  };

  const { status, payload } = handleAnalyze(body, cfg);
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');

  // Exit codes let a shell wrapper branch without parsing the JSON:
  //   0 = ran cleanly, no fresh signal
  //   10 = a signal fired on the final bar
  //   1 = the request was rejected or there were too few bars
  if (status !== 200) process.exit(1);
  if (payload.signal) process.exit(10);
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
