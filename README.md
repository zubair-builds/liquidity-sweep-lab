# Liquidity Sweep Lab

ICT / SMC liquidity-sweep model over HTTP. You POST OHLC bars; it returns a decision (state, action, levels, checks). It does not fetch market data and does not place orders.

Suggested repo name: `liquidity-sweep-lab`.

```text
caller (IBKR / file / agent)  --POST bars-->  Next.js API  -->  { state, action, signal, checks }
```

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16, React 19 |
| Model | Pure JS (`model.js`, `indicators.js`, `bars.js`) |
| API | `/api/analyze`, `/api/backtest` |
| Config | `config.json` profiles |
| Tests | `npm test` — 38 HTTP cases, no network |

## Setup

```bash
git clone https://github.com/zubair-builds/TradeLab.git
cd TradeLab
npm install
npm run dev
```

Dashboard: [http://localhost:3000](http://localhost:3000) (Overview, Analyze, Backtest, Settings).

```bash
npm test
npm run legacy-start   # raw Node server on :8787
node cli.js sample-xauusd-1h.json
```

## API

`POST /api/analyze` and `POST /api/backtest` accept IBKR-style column bars or an array of `{ time, open, high, low, close }`.

- `200` decision, `400` bad payload, `422` too few bars, `401` bad API key
- Last forming bar is dropped unless `lastBarClosed: true`
- Backtest books a loss if stop and target hit the same bar

See the previous long README history for payload examples. Sample fixture: `sample-xauusd-1h.json`.

## Honest limits

- No unattended cron — the caller must supply bars
- Signals are rare; treat short backtests as noise
- Thresholds (ATR multiple, pivot length) are parameters, not gospel
- This proposes levels. Sizing and whether to trade are out of scope

## Author

[Syed Zubair Haider](https://github.com/zubair-builds) · [LinkedIn](https://www.linkedin.com/in/syed-zubair-haider/)
