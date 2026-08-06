'use client';
import { UP, DOWN, mono, kicker, h1, lede, panel, outlineBtn, when } from './theme';
import { Notice } from './Analyze';

const COLS = '1.4fr .6fr .8fr .8fr .8fr .7fr .7fr';

export default function Backtest({ meta, result, params, error, onSettings, showTrades = true }) {
  if (error) return <Notice tone="bad" title="That backtest was refused." body={error} />;
  if (!result) return <Notice title="Replaying…" body="Walking the model over every bar in the file." />;

  const s = result.stats || {};
  const n = s.trades ?? 0;
  const wr = (s.winRate ?? 0) / 100;
  // The server may or may not return an interval; recompute so the wording is always available.
  const se = n ? Math.sqrt((wr * (1 - wr)) / n) : 0;
  const ciLo = Math.max(0, wr - 1.96 * se) * 100;
  const ciHi = Math.min(1, wr + 1.96 * se) * 100;
  const thin = n < 100;

  const stats = [
    { k: 'Win rate', v: n ? s.winRate.toFixed(1) + '%' : '—', c: 'var(--color-text)', note: n ? `${Math.round((s.winRate / 100) * n)} of ${n} · 95% CI ${ciLo.toFixed(0)}–${ciHi.toFixed(0)}%` : 'no trades' },
    { k: 'Expectancy', v: n ? sign(s.expectancyR) + 'R' : '—', c: n ? (s.expectancyR > 0 ? UP : DOWN) : 'var(--color-text)', note: 'average result per trade' },
    { k: 'Profit factor', v: s.profitFactor ? s.profitFactor.toFixed(2) : '—', c: s.profitFactor > 1 ? UP : 'var(--color-text)', note: 'gross win ÷ gross loss' },
    { k: 'Total', v: n ? sign(s.totalR, 1) + 'R' : '—', c: n ? (s.totalR > 0 ? UP : DOWN) : 'var(--color-text)', note: 'summed over the file' },
    { k: 'Worst drawdown', v: n ? '−' + Math.abs(s.maxDrawdownR).toFixed(1) + 'R' : '—', c: 'var(--color-text)', note: 'deepest peak-to-trough' },
    { k: 'Average hold', v: n ? Math.round(s.avgBarsHeld) + ' bars' : '—', c: 'var(--color-text)', note: 'entry to exit' },
  ];

  const trades = result.trades || [];
  const unit = 50 / Math.max(params.rr, 1); // 110px strip, midline at 55px

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '34px 40px 44px' }}>
      <div style={{ maxWidth: 1180 }}>
        <div style={kicker}>REPLAYED OVER {result.meta?.barsAnalysed ?? '—'} {meta.timeframe} BARS OF {meta.instrument}</div>
        <h1 style={h1}>{n ? `${n} trades, ${s.winRate.toFixed(0)}% of them won.` : 'These settings never fired once.'}</h1>
        <p style={lede}>
          {n
            ? `Over the whole file the model would have made ${sign(s.totalR, 1)}R. When a single bar contains both the stop and the target it is booked as a loss — because the bar cannot tell you which came first.`
            : 'Loosen the displacement threshold or turn off one of the requirements in Settings and try again.'}
        </p>

        <div style={{ marginTop: 24, padding: '15px 17px', borderRadius: 'var(--radius-md)', maxWidth: 820, color: thin ? 'var(--color-caution)' : 'var(--color-neutral-400)', background: thin ? 'rgba(224,200,160,.07)' : 'rgba(233,233,237,.03)', boxShadow: `inset 0 0 0 1px ${thin ? 'rgba(224,200,160,.22)' : 'rgba(233,233,237,.07)'}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            <svg viewBox="0 0 256 256" style={{ width: 17, height: 17, flex: 'none', marginTop: 1 }} fill="none" stroke="currentColor" strokeWidth="17" strokeLinecap="round">
              <circle cx="128" cy="128" r="92" /><line x1="128" y1="80" x2="128" y2="140" /><line x1="128" y1="176" x2="128" y2="176" />
            </svg>
            <div>
              <div style={{ font: '500 13px/1.4 var(--font-body)' }}>
                {thin ? `${n} trades is not enough to tell you anything.` : 'Enough trades to start reading the numbers.'}
              </div>
              <div style={{ marginTop: 5, font: '400 12px/1.6 var(--font-body)', opacity: 0.82, maxWidth: 660 }}>
                {n
                  ? `The true win rate is somewhere between ${ciLo.toFixed(0)}% and ${ciHi.toFixed(0)}% with 95% confidence — ${thin ? 'a range that wide is a shrug, not a result. You need years of history, or a lower timeframe, before this means much.' : 'a usefully narrow band, though costs and slippage still sit outside it.'}`
                  : 'No trades, no statistics. Nothing to be confident or unconfident about.'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {stats.map((x) => (
            <div key={x.k} style={{ background: 'var(--color-bg)', padding: '18px 20px' }}>
              <div style={{ font: '400 10.5px/1 var(--font-body)', color: 'var(--color-neutral-600)' }}>{x.k}</div>
              <div style={{ marginTop: 9, font: `400 30px/1 ${mono}`, color: x.c }}>{x.v}</div>
              <div style={{ marginTop: 7, font: '400 10.5px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>{x.note}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 28, alignItems: 'start' }}>
          <div>
            <div style={kicker}>EVERY TRADE, IN ORDER</div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 2, height: 110, borderBottom: '1px solid var(--color-divider)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 55, borderTop: '1px dashed rgba(233,233,237,.12)' }} />
              {trades.map((t, i) => {
                const win = t.r > 0;
                const hp = Math.abs(t.r) * unit;
                return <div key={i} style={{ flex: 1, minWidth: 2, maxWidth: 14, height: hp, marginTop: win ? 55 - hp : 55, background: win ? UP : DOWN, opacity: 0.85, borderRadius: 1 }} />;
              })}
            </div>
            <div style={{ marginTop: 9, font: '400 10.5px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>
              Each bar is one trade&rsquo;s result in R. Above the line is a win at +{params.rr.toFixed(1)}R, below is a full stop-out at −1R.
            </div>
          </div>

          <div style={{ ...panel, padding: '16px 18px' }}>
            <div style={kicker}>SETTINGS USED</div>
            <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(result.meta?.profilesApplied || []).length > 0 && (
                <Line label="Profiles" v={result.meta.profilesApplied.join(' → ')} />
              )}
              <Line label="Pivot length" v={params.pivotLen} />
              <Line label="Confirm window" v={params.confirmBars + ' bars'} />
              <Line label="Displacement" v={params.dispMult.toFixed(2) + '× ATR'} />
              <Line label="Reward : risk" v={params.rr.toFixed(1)} />
              <Line label="Gap required" v={params.requireFVG ? 'yes' : 'no'} />
              <Line label="Discount required" v={params.requirePD ? 'yes' : 'no'} />
            </div>
            <button onClick={onSettings} style={{ ...outlineBtn, marginTop: 16, width: '100%', padding: 8, font: '500 11.5px/1 var(--font-body)' }}>
              Change and re-run
            </button>
          </div>
        </div>

        {showTrades && trades.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div style={kicker}>TRADE LOG</div>
            <div style={{ marginTop: 14, borderRadius: 'var(--radius-md)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '10px 18px', background: 'rgba(233,233,237,.04)', font: `500 9.5px/1 ${mono}`, letterSpacing: '.09em', color: 'var(--color-neutral-600)' }}>
                <span>ENTERED</span><span>SIDE</span><span>ENTRY</span><span>STOP</span><span>TARGET</span><span>HELD</span>
                <span style={{ textAlign: 'right' }}>RESULT</span>
              </div>
              {trades.slice().reverse().slice(0, 60).map((t, i) => {
                const long = t.side === 'BUY' || t.side === 'LONG';
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '11px 18px', borderTop: '1px solid var(--color-divider)' }}>
                    <span style={{ font: '400 11.5px/1 var(--font-body)', color: 'var(--color-neutral-400)' }}>{when(t.time)}</span>
                    <span style={{ justifySelf: 'start', padding: '3px 8px', borderRadius: 4, font: '500 10.5px/1.3 var(--font-body)', background: long ? 'rgba(134,192,163,.12)' : 'rgba(214,141,138,.12)', color: long ? UP : DOWN }}>{long ? 'Buy' : 'Sell'}</span>
                    <span style={{ font: `400 11.5px/1 ${mono}` }}>{t.entry.toFixed(2)}</span>
                    <span style={{ font: `400 11.5px/1 ${mono}`, color: DOWN }}>{t.stop.toFixed(2)}</span>
                    <span style={{ font: `400 11.5px/1 ${mono}`, color: UP }}>{t.target.toFixed(2)}</span>
                    <span style={{ font: '400 11.5px/1 var(--font-body)', color: 'var(--color-neutral-600)' }}>{t.barsHeld} bars</span>
                    <span style={{ textAlign: 'right', font: `500 12px/1 ${mono}`, color: t.r > 0 ? UP : DOWN }}>{sign(t.r)}R</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ label, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <span style={{ font: '400 11.5px/1.3 var(--font-body)', color: 'var(--color-neutral-500)' }}>{label}</span>
      <span style={{ font: `500 11.5px/1 ${mono}`, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

const sign = (v, dp = 2) => (v >= 0 ? '+' : '') + Number(v).toFixed(dp);
