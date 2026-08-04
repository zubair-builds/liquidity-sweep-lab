#!/usr/bin/env node
'use strict';

/**
 * HTTP front end for the ICT sweep model.
 *
 * The app does not fetch market data. Bars are pushed in by the caller —
 * typically Claude, which pulls them from IBKR through its own connector and
 * POSTs the result here. That inversion removes the Client Portal Gateway, its
 * localhost TLS workaround and its expiring session from this codebase
 * entirely, at the cost of the app no longer being able to run unattended.
 *
 * Every endpoint is a pure function of its request body. No state is persisted
 * between calls, so the same bars always produce the same decision and two
 * concurrent requests cannot interfere with each other.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { normalizeBars, barMinutesFor, dropUnclosedBar, BarError } = require('./bars');
const { evaluate, DEFAULTS } = require('./model');
const { backtest } = require('./backtest');

const CONFIG_PATH = process.env.ICT_CONFIG || path.join(__dirname, 'config.json');

/** Requests larger than this are refused before being buffered. */
const MAX_BODY_BYTES = Number(process.env.ICT_MAX_BODY || 8 * 1024 * 1024);

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`could not read ${CONFIG_PATH}: ${err.message}`);
  }
}

/**
 * Model parameters are layered, least specific first:
 *   DEFAULTS  <-  config profiles.default  <-  profile for this instrument
 *             <-  overrides in the request body
 *
 * The request wins so a caller can sweep one parameter without editing config,
 * which is what makes parameter exploration from a chat session practical.
 */
function resolveModel(cfg, instrument, timeframe, override) {
  const profiles = cfg.profiles || {};
  const keys = [
    'default',
    instrument && timeframe ? `${instrument}:${timeframe}` : null,
    instrument || null,
  ].filter(Boolean);

  const applied = [];
  let merged = { ...DEFAULTS };
  for (const k of keys) {
    if (profiles[k]) {
      merged = { ...merged, ...profiles[k] };
      applied.push(k);
    }
  }
  if (override && typeof override === 'object') {
    const unknown = Object.keys(override).filter((k) => !(k in DEFAULTS));
    if (unknown.length) {
      throw new BarError(`unknown model parameter(s): ${unknown.join(', ')}`, {
        unknown, allowed: Object.keys(DEFAULTS),
      });
    }
    merged = { ...merged, ...override };
    applied.push('request');
  }
  return { model: merged, profilesApplied: applied };
}

/**
 * Shared front half of /analyze and /backtest: validate the body, normalise the
 * bars, decide whether the last one is finished, and resolve model parameters.
 */
function prepare(body, cfg) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BarError('request body must be a JSON object', {});
  }
  if (body.bars === undefined) {
    throw new BarError('request body is missing "bars"', {
      hint: 'pass the output of the IBKR get_price_history tool verbatim, or an array of {time,open,high,low,close}',
    });
  }

  const instrument = body.instrument || body.symbol || null;
  const timeframe = body.timeframe || body.bar || null;

  const { bars: allBars, shape, warnings } = normalizeBars(body.bars, {
    maxBars: cfg.maxBars || 0,
  });

  const { minutes, source } = barMinutesFor(timeframe, allBars);

  let bars = allBars;
  let droppedBar = null;
  const useClosedOnly = body.useClosedBarsOnly !== false;
  if (useClosedOnly && body.lastBarClosed !== true) {
    const r = dropUnclosedBar(allBars, minutes);
    bars = r.bars;
    droppedBar = r.dropped;
  }

  const { model, profilesApplied } = resolveModel(cfg, instrument, timeframe, body.model);

  return {
    instrument,
    timeframe,
    bars,
    model,
    meta: {
      barsReceived: allBars.length,
      barsAnalysed: bars.length,
      payloadShape: shape,
      barMinutes: minutes,
      barMinutesSource: source,
      unclosedBarDropped: droppedBar,
      firstBar: bars.length ? bars[0].time : null,
      lastBar: bars.length ? bars[bars.length - 1].time : null,
      profilesApplied,
      warnings,
    },
  };
}

function handleAnalyze(body, cfg) {
  const { instrument, timeframe, bars, model, meta } = prepare(body, cfg);
  const result = evaluate(bars, model);

  // evaluate() reports its own insufficient-data case rather than throwing.
  if (!result.ok) {
    return {
      status: 422,
      payload: { ok: false, error: result.error, instrument, timeframe, meta },
    };
  }

  const { signals, ...rest } = result;
  return {
    status: 200,
    payload: {
      ...rest,
      instrument,
      timeframe,
      asOf: new Date().toISOString(),
      meta,
    },
  };
}

function handleBacktest(body, cfg) {
  const { instrument, timeframe, bars, model, meta } = prepare(body, cfg);

  const costs = {
    spreadPoints: Number(body.costs?.spreadPoints ?? cfg.costs?.spreadPoints ?? 0),
    slippagePoints: Number(body.costs?.slippagePoints ?? cfg.costs?.slippagePoints ?? 0),
  };

  const out = backtest(bars, model, costs);
  if (out.ok === false) {
    return { status: 422, payload: { ok: false, error: out.error, instrument, timeframe, meta } };
  }

  const { trades, ...stats } = out;
  return {
    status: 200,
    payload: {
      ok: true,
      instrument,
      timeframe,
      asOf: new Date().toISOString(),
      costs,
      stats,
      // Trade-by-trade detail is large and rarely wanted inline. Opt in.
      trades: body.includeTrades ? trades : undefined,
      tradeCount: trades.length,
      config: model,
      meta,
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BODY_BYTES) {
      return reject(new BarError(`request body exceeds ${MAX_BODY_BYTES} bytes`, { limit: MAX_BODY_BYTES }));
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BarError(`request body exceeds ${MAX_BODY_BYTES} bytes`, { limit: MAX_BODY_BYTES }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return reject(new BarError('request body was empty', {}));
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new BarError(`request body is not valid JSON: ${e.message}`, {}));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2) + '\n';
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Optional shared-secret check. Off by default because the server binds to
 * loopback; set apiKey in config or ICT_API_KEY if you expose it anywhere else.
 */
function authorised(req, cfg) {
  const key = process.env.ICT_API_KEY || cfg.apiKey;
  if (!key) return true;
  const supplied = req.headers['x-api-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return supplied === key;
}

const ROUTES = {
  '/analyze': handleAnalyze,
  '/backtest': handleBacktest,
};

function createServer(cfg = loadConfig()) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (route === '/health' || route === '/')) {
      return send(res, 200, {
        ok: true,
        service: 'ict-sweep-monitor',
        mode: 'push — bars are supplied by the caller, not fetched',
        endpoints: {
          'POST /analyze': 'evaluate the current setup and return a decision object',
          'POST /backtest': 'replay every signal in the supplied bars and return statistics',
        },
        modelParameters: Object.keys(DEFAULTS),
        profiles: Object.keys(cfg.profiles || {}),
      });
    }

    const handler = ROUTES[route];
    if (!handler) {
      return send(res, 404, { ok: false, error: `no route ${req.method} ${route}` });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: `${route} accepts POST only` });
    }
    if (!authorised(req, cfg)) {
      return send(res, 401, { ok: false, error: 'missing or invalid API key' });
    }

    try {
      const body = await readBody(req);
      const { status, payload } = handler(body, cfg);
      return send(res, status, payload);
    } catch (err) {
      if (err instanceof BarError) {
        return send(res, 400, { ok: false, error: err.message, detail: err.detail });
      }
      process.stderr.write(`unhandled: ${err.stack}\n`);
      return send(res, 500, { ok: false, error: 'internal error' });
    }
  });
}

function main() {
  const cfg = loadConfig();
  const port = Number(process.env.PORT || cfg.port || 8787);
  // Loopback by default: this endpoint accepts arbitrary model parameters and
  // should not be reachable from the network unless you have decided otherwise.
  const host = process.env.HOST || cfg.host || '127.0.0.1';

  createServer(cfg).listen(port, host, () => {
    process.stderr.write(`ict-sweep-monitor listening on http://${host}:${port}\n`);
    process.stderr.write(`  POST /analyze   POST /backtest   GET /health\n`);
    if (!(process.env.ICT_API_KEY || cfg.apiKey)) {
      process.stderr.write('  no API key configured — keep this bound to loopback\n');
    }
  });
}

module.exports = { createServer, handleAnalyze, handleBacktest, resolveModel, prepare };

if (require.main === module) main();
