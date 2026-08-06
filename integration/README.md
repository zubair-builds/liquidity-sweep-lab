# Sweep — frontend integration

Drop-in replacement for the dashboard in `trade/`. **No server-side changes.** It talks to the
API routes you already have: `GET /api/data`, `GET /api/data?file=…`, `POST /api/analyze`,
`POST /api/backtest`.

## Where the files go

| From here | Into the repo |
| --- | --- |
| `app/globals.css` | `app/globals.css` (replaces) |
| `app/layout.js` | `app/layout.js` (replaces) |
| `app/page.js` | `app/page.js` (replaces) |
| `app/ui/*.js` | `app/ui/` (new folder) |

Then `npm run dev`. Nothing else to install.

## What changed

- **Four screens** instead of one: Overview, Analyze, Backtest, Settings, switched in the header.
- **A chart.** Candles are drawn from the bar file itself; the swept level, the fair value gap and
  the entry/stop/target lines come from what `/api/analyze` returned — nothing is drawn that the
  server did not report.
- **The ladder.** The five conditions read left to right in the order the model tests them, so a
  stalled setup shows you exactly where it stopped.
- **Settings are live.** Sliders send `model: {…}` overrides on every request, which your
  layering already supports (`DEFAULTS ← profiles.default ← profiles["SYM:tf"] ← request.model`).
  Nothing is written to `config.json`.
- **Tailwind is no longer used** by these files — styling is inline against CSS custom properties
  in `globals.css`. You can leave `tailwind.config.js` and the PostCSS setup in place, or delete
  both plus the `tailwindcss`/`autoprefixer`/`postcss` devDependencies.

## One honest caveat about the ladder

`/api/analyze` returns `checks` as five booleans, but the model evaluates them in a chain — if
displacement never happens, break-of-structure and the gap are never tested at all. A flat
`false` cannot tell those apart, so the UI infers it: when `checks.displacement` is false, the
legs after it render as *not evaluated* (dashed) rather than *failed*.

That inference is right for the current model, but it is an inference. If you want it exact, have
`evaluate` report the stage it reached — e.g. `checks: { sweep: true, displacement: false }` with
untested legs simply absent, or a sibling `reached: "displacement"`. `app/ui/ladder.js` already
reads a `reached` field if one is present and falls back to the inference when it is not.

## Requests the Overview screen makes

It loads every dataset in the manifest and analyses each one: `2 × N` requests on mount (N = 7
today). Both are local file reads and a pure function, so it is fast, but if the manifest grows,
add a `GET /api/overview` that loops server-side and returns one array.
