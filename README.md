# ICT Sweep Monitor

An HTTP service that applies a liquidity-sweep model to price bars and returns a JSON decision object.

**It does not fetch market data.** You give it bars, it gives you a decision. In practice that means Claude pulls bars from IBKR through its own connector and POSTs them here.

```
Claude ──get_price_history──> IBKR          (Claude's connector, not this app)
  │
  └──POST /analyze {bars}──> this service ──> { state, action, signal, checks }
```

The previous version opened its own connection to the IBKR Client Portal Gateway. That is gone — `ibkr.js`, `fetch-history.js`, `file.js` and the old `index.js` CLI runner are deleted, along with the `.state.json` file they used to track signals between cron runs. With them went the localhost TLS workaround, the `/iserver/auth/status` pre-flight check, and the expiring gateway session that was the main thing to go wrong operationally. In their place: `bars.js` (payload normalisation), `server.js` (the HTTP endpoints) and `cli.js` (a local replacement for the old runner, reading a file instead of a gateway). What is lost is unattended operation: nothing here can run on a cron schedule any more, because something has to supply the bars.

## Running it

This project is built with Next.js and includes a visual dashboard, making it ready for 1-click deployment to Vercel.

```bash
npm install        # Install Next.js & React dependencies
npm run dev        # Starts the frontend dashboard and API on http://localhost:3000
```

You can view the dashboard by opening `http://localhost:3000` in your browser. The dashboard allows you to paste JSON payloads and run Backtests or Analysis directly.

```bash
npm test             # 38 core logic tests, no network required
npm run legacy-start # Starts the old raw Node.js HTTP server on http://127.0.0.1:8787
```

## Endpoints

The API is served via Next.js API Routes under the `/api` prefix.

### `POST /api/analyze`

Evaluates the current setup and returns the decision object.

```jsonc
{
  "instrument": "XAUUSD",        // optional, selects a config profile
  "timeframe": "1h",             // optional, only a fallback for bar spacing
  "bars": { ... },               // required, see below
  "model": { "rr": 3 },          // optional per-request parameter overrides
  "lastBarClosed": false,        // optional, see "the unclosed bar" below
  "useClosedBarsOnly": true      // optional, set false to never drop the last bar
}
```

### `POST /api/backtest`

Same body. Replays every signal in the supplied bars and returns win rate, expectancy in R, profit factor, max drawdown and a 95% confidence interval. Add `"includeTrades": true` for the trade-by-trade list, and `"costs": { "spreadPoints": 0.3, "slippagePoints": 0.2 }` to override the defaults in `config.json`.

Backtesting needs far more history than a live check does — see the note on signal frequency below.

## The bars payload

Both of these are accepted and produce identical results. The first is exactly what IBKR's `get_price_history` tool returns, so it can be pasted in verbatim with no reshaping:

```jsonc
"bars": {
  "time":  ["2026-07-05T22:00:00Z", "2026-07-05T23:00:00Z"],
  "open":  [4175.15, 4188.41],
  "high":  [4192.19, 4201.84],
  "low":   [4164.86, 4177.36],
  "close": [4188.41, 4183.28]
}
```

```jsonc
"bars": [
  { "time": "2026-07-05T22:00:00Z", "open": 4175.15, "high": 4192.19, "low": 4164.86, "close": 4188.41 }
]
```

Timestamps may be ISO strings, epoch seconds or epoch milliseconds. IBKR's raw `t/o/h/l/c/v` key names work too. Numeric strings are coerced. Bars are sorted ascending and deduplicated by timestamp, keeping the later value — so overlapping fetches can be concatenated and pushed as one payload.

Ragged columns are rejected rather than truncated: a `close` array shorter than `time` almost always means the payload was assembled wrongly, and silently dropping bars would produce a plausible but wrong decision.

`sample-xauusd-1h.json` is a real captured payload, kept as both a worked example and a test fixture.

## Calling it from Claude

> Fetch the last month of XAUUSD hourly bars from IBKR and POST them to `http://localhost:3000/api/analyze` with instrument XAUUSD and timeframe 1h.

Claude calls `get_price_history` (contract `69067924` for XAUUSD spot, `CMDTY`, `ONE_HOUR`) and passes the result straight through as `bars`.

Two things are worth being explicit about in the request:

**The lookback must cover the model's needs.** `evaluate` refuses to run on fewer than `max(pdLookback, pivotLen * 2 + 5, 30)` bars — 50 with the shipped defaults — and returns `422` saying so. A one-month hourly fetch is comfortably enough; a one-week fetch of 4h bars is not.

**Bar spacing is inferred from the data**, using the median gap so weekend and session breaks do not skew it. `timeframe` is only a fallback, which is why a mislabelled `timeframe` is harmless but a gappy or mixed-interval payload is not.

## The unclosed bar

A live feed's final bar is usually still forming. Signals computed on an unfinished bar can appear and vanish within the hour, which is the most common way an automated model ends up acting on noise. The server drops that bar when the last timestamp plus one interval is still in the future, and reports what it dropped in `meta.unclosedBarDropped`.

Set `"lastBarClosed": true` when replaying a saved history, where every bar is complete by definition.

## Output

```jsonc
{
  "ok": true,
  "state": "SIGNAL_LONG",   // FLAT | ARMED_LONG | ARMED_SHORT | SIGNAL_LONG | SIGNAL_SHORT
  "action": "BUY",          // BUY | SELL | WAIT | NONE
  "signal": {
    "entry": 4108.22, "stop": 3999.06, "target": 4326.53,
    "riskPoints": 109.16, "riskReward": 2, "riskInATR": 3.16,
    "sweptLevel": 4007.71, "sweptAt": "2026-07-29T16:00:00Z"
  },
  "armed": { "side": "LONG", "barsRemaining": 3 },
  "checks": {               // which conditions are currently satisfied
    "sweep": true, "displacement": false, "bos": false,
    "fvg": true, "premiumDiscount": true
  },
  "context": {
    "zone": "discount", "pctOfRange": 44.5,
    "dealingRange": { "high": 4120.56, "low": 3996.13, "equilibrium": 4058.35 },
    "nearestFVGAbove": { "type": "bearish", "bottom": 4087.63, "top": 4100.60 }
  },
  "meta": {
    "barsReceived": 480, "barsAnalysed": 479,
    "payloadShape": "columns", "barMinutes": 60, "barMinutesSource": "inferred",
    "unclosedBarDropped": "2026-08-04T15:00:00Z",
    "profilesApplied": ["default", "XAUUSD:1h"], "warnings": []
  }
}
```

`checks` is the useful part when `action` is `WAIT` — it tells you exactly which leg of the setup is missing, so you can watch for that specific thing rather than the whole pattern.

Status codes: `200` a decision was produced, `400` the payload was rejected (the body says which bar and which field), `422` the payload parsed but held too few bars, `401` bad API key.

## Configuration

`config.json` holds server settings and named model profiles. Profiles layer least-specific first, so a profile only needs to state its differences:

```
DEFAULTS  <-  profiles.default  <-  profiles["XAUUSD:1h"]  <-  request.model
```

The request wins, which is what makes sweeping a parameter from a chat session practical. `meta.profilesApplied` reports which layers were used, and unknown parameter names are a `400` rather than being silently ignored.

## Command line

The same analysis without starting the server, for replaying saved data:

```bash
node cli.js sample-xauusd-1h.json                 # a saved request body
node cli.js bars.json XAUUSD 1h maxRiskATR=3      # a bare bars payload
cat bars.json | node cli.js - XAUUSD 1h

node backtest.js bars.json pivotLen=4 maxRiskATR=3
```

`cli.js` exits `0` for no signal, `10` when one fired and `1` on rejection, so a shell wrapper can branch without parsing JSON.

## Testing

`npm test` boots the old legacy server on an ephemeral port and drives it over actual HTTP — 38 cases covering bar normalisation (both payload shapes, epoch/ISO times, ragged columns, duplicate timestamps, inconsistent OHLC), the `/analyze` and `/backtest` endpoints, error status codes, routing, and API-key enforcement. No network access is required; everything runs against synthetic bars generated with a seeded PRNG, so a run is deterministic rather than occasionally producing a signal and occasionally not.

The last block of tests runs against `sample-xauusd-1h.json` — 115 real hourly XAUUSD bars pulled from the IBKR connector (`get_price_history`, contract `69067924`, `CMDTY`) and committed verbatim. These check that the genuine connector payload parses without reshaping, that prices and the dealing-range high/low survive the round trip unchanged, that reshaping the same data into the object-array form produces an identical decision, and that the signal object (when present) is internally consistent — stop on the losing side of entry, target on the winning side, `riskPoints` matching `|entry − stop|`.

One assertion in that block was wrong on the first pass, not the code: it hardcoded the dealing-range high as a value read off a *daily* bar series, but `/analyze` computes it over the last `pdLookback` (50) *hourly* bars, a different and smaller window. The fix was to derive the expected value from `config.pdLookback` and the sample data at test time rather than hardcode a number, so the assertion still means something if `pdLookback` ever changes.

## Design decisions worth knowing

**Every request is a pure function of its body.** No state persists between calls, so the same bars always produce the same decision, and concurrent requests cannot interfere. The old build tracked `isNew` against a `.state.json` file; that file is gone. If you need to know whether a signal is new, compare `signal.time` against what you saw last — the caller has that context and the server does not.

**State is recomputed from scratch every run.** The model replays the whole bar array rather than carrying arming state forward. Recomputation is slower and completely reproducible.

**Backtest ambiguity resolves against you.** When one bar contains both stop and target, it books a loss. Bar data cannot say which came first, and assuming otherwise is how backtests lie.

## Known limitations

1. **Nothing runs unattended.** This is the direct cost of removing the gateway. The service cannot wake up and check the market; something must fetch bars and call it. A scheduled Claude task can do this, but that is a scheduled *agent*, not a cron job hitting an API.

2. **Signal frequency is very low.** On XAUUSD 4H the model produced one signal in a month of bars, and none with `maxRiskATR=3`. You need years of history, or a lower timeframe, before any statistic means anything. Fewer than ~100 trades tells you essentially nothing.

3. **Stop distance can balloon.** When displacement confirms several bars after the sweep, price has already travelled and the stop sits far away. One signal in testing carried a 109-point stop — 3.2× ATR. `maxRiskATR` exists to reject these; it defaults to off so you can see them first.

4. **The thresholds are invented.** "Displacement ≥ 0.6× ATR", "break of the 5-bar extreme" — ICT does not define these numerically. They are my choices, and different values produce substantially different signal sets. Treat them as parameters to be tested, not as the method.

5. **Data quality is now the caller's problem.** The app validates shape, ordering and numeric sanity, and warns about inconsistent OHLC — but it cannot tell a correct fetch from one with the wrong contract, the wrong session, or a gap in the middle. Whatever you send, it will analyse.

6. **This decides nothing on its own.** It emits a proposal with levels attached. Position sizing, correlation with anything else you hold, and whether to take the trade at all are not modelled.
