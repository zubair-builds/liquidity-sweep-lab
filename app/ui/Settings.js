'use client';
import { mono, kicker, h1, lede, panel, outlineBtn } from './theme';
import { UP, DOWN } from './theme';

export const DEFAULTS = {
  pivotLen: 5,
  structLen: 5,
  confirmBars: 6,
  dispMult: 0.6,
  requireFVG: true,
  requirePD: true,
  pdLookback: 50,
  slBufferATR: 0.25,
  rr: 2.0,
  minRR: 1.0,
  allowLongs: true,
  allowShorts: true,
  maxRiskATR: 0,
};

const SLIDERS = [
  { k: 'pivotLen', label: 'Pivot length', min: 2, max: 10, step: 1, unit: '', help: 'How many bars either side a low must beat to count as a level worth sweeping. Bigger means fewer, more important levels.' },
  { k: 'confirmBars', label: 'Confirm window', min: 2, max: 14, step: 1, unit: ' bars', help: 'After a sweep, how long the model waits for the move to confirm before giving up.' },
  { k: 'dispMult', label: 'Displacement', min: 0.2, max: 1.6, step: 0.05, unit: '× ATR', dp: 2, help: 'How big the confirming candle has to be. This is the single most invented number in the model.' },
  { k: 'rr', label: 'Reward : risk', min: 1, max: 5, step: 0.5, unit: ' : 1', dp: 1, help: 'Where the target sits, as a multiple of the stop distance. Raising it lowers the win rate and may still pay more.' },
  { k: 'slBufferATR', label: 'Stop buffer', min: 0, max: 1, step: 0.05, unit: '× ATR', dp: 2, help: 'Breathing room beyond the swept level, so a one-tick spike does not take you out.' },
  { k: 'structLen', label: 'Structure length', min: 2, max: 10, step: 1, unit: ' bars', help: 'How far back the break of structure has to reach. Larger asks for a stronger break.' },
  { k: 'pdLookback', label: 'Dealing range', min: 20, max: 120, step: 5, unit: ' bars', help: 'How much history defines the premium/discount midpoint.' },
  { k: 'maxRiskATR', label: 'Max risk', min: 0, max: 6, step: 0.5, unit: '× ATR', dp: 1, help: 'Reject setups whose stop is further away than this. Zero means no limit — leave it off until you have seen a few monsters.' },
];

const TOGGLES = [
  { k: 'requireFVG', label: 'Require a fair value gap', help: 'Only take setups that left an unfilled gap behind the confirming move.' },
  { k: 'requirePD', label: 'Require the discount half', help: 'Only buy below the midpoint of the recent range, only sell above it.' },
  { k: 'allowLongs', label: 'Allow buys', help: 'Take long setups off swept lows.' },
  { k: 'allowShorts', label: 'Allow sells', help: 'Take short setups off swept highs.' },
];

export default function Settings({ params, setParam, reset, backtest, meta }) {
  const s = backtest?.stats;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '34px 40px 44px' }}>
      <div style={{ maxWidth: 1180 }}>
        <div style={kicker}>MODEL SETTINGS</div>
        <h1 style={h1}>These numbers are guesses. Change them and see.</h1>
        <p style={lede}>
          ICT never wrote down &ldquo;displacement must be 0.6× ATR&rdquo; — that threshold, and most of the
          others, were chosen by hand. Move a slider and both the analysis and the backtest re-run on
          the spot, so you can see what the choice costs you.
        </p>

        <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={kicker}>THE SHAPE OF THE SETUP</div>
            {SLIDERS.map((sl) => (
              <div key={sl.k}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14 }}>
                  <label htmlFor={sl.k} style={{ font: '500 12.5px/1.3 var(--font-body)' }}>{sl.label}</label>
                  <span style={{ font: `500 13px/1 ${mono}`, color: 'var(--color-accent-300)' }}>
                    {sl.k === 'maxRiskATR' && !params.maxRiskATR ? 'off' : Number(params[sl.k]).toFixed(sl.dp ?? 0) + sl.unit}
                  </span>
                </div>
                <input
                  id={sl.k}
                  type="range"
                  min={sl.min}
                  max={sl.max}
                  step={sl.step}
                  value={params[sl.k]}
                  onChange={(e) => setParam(sl.k, parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: 11, display: 'block' }}
                />
                <div style={{ marginTop: 8, font: '400 11px/1.55 var(--font-body)', color: 'var(--color-neutral-600)', maxWidth: 440 }}>{sl.help}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={kicker}>WHAT COUNTS AS A TRADE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {TOGGLES.map((t) => (
                <button
                  key={t.k}
                  onClick={() => setParam(t.k, !params[t.k])}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 13px', borderRadius: 'var(--radius-md)', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                >
                  <span style={{ width: 30, height: 17, flex: 'none', marginTop: 1, borderRadius: 9, padding: 2, boxSizing: 'border-box', display: 'flex', justifyContent: params[t.k] ? 'flex-end' : 'flex-start', background: params[t.k] ? 'var(--color-accent)' : 'var(--color-neutral-800)', transition: 'background .15s' }}>
                    <span style={{ width: 13, height: 13, borderRadius: '50%', background: params[t.k] ? 'var(--color-bg)' : 'var(--color-neutral-500)' }} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', font: '500 12.5px/1.3 var(--font-body)', color: 'var(--color-text)' }}>{t.label}</span>
                    <span style={{ display: 'block', marginTop: 4, font: '400 11px/1.55 var(--font-body)', color: 'var(--color-neutral-600)' }}>{t.help}</span>
                  </span>
                </button>
              ))}
            </div>

            <div style={{ ...panel, marginTop: 6, padding: '16px 18px' }}>
              <div style={kicker}>WHAT THIS DOES TO THE RECORD</div>
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
                <Stat label="Trades found" v={s ? s.trades : '—'} />
                <Stat label="Win rate" v={s && s.trades ? s.winRate.toFixed(0) + '%' : '—'} />
                <Stat label="Expectancy" v={s && s.trades ? (s.expectancyR >= 0 ? '+' : '') + s.expectancyR.toFixed(2) + 'R' : '—'} colour={s && s.trades ? (s.expectancyR > 0 ? UP : DOWN) : undefined} />
              </div>
              <button onClick={reset} style={{ ...outlineBtn, marginTop: 18, border: '1px solid var(--color-neutral-800)', color: 'var(--color-neutral-400)', font: '500 11.5px/1 var(--font-body)', padding: '7px 13px' }}>
                Back to the shipped defaults
              </button>
            </div>

            <div style={{ ...panel, padding: '16px 18px' }}>
              <div style={kicker}>HOW SETTINGS STACK</div>
              <div style={{ marginTop: 13, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', font: '400 11.5px/1.4 var(--font-body)', color: 'var(--color-neutral-500)' }}>
                <Chip>defaults</Chip><Arrow /><Chip>profile: default</Chip><Arrow />
                <Chip>{`profile: ${meta.instrument}:${meta.timeframe}`}</Chip><Arrow />
                <Chip accent>what you set here</Chip>
              </div>
              <div style={{ marginTop: 12, font: '400 11px/1.6 var(--font-body)', color: 'var(--color-neutral-600)' }}>
                Later layers win, so a change here overrides <code style={{ fontFamily: mono }}>config.json</code> without
                editing it. Nothing is saved on the server — every request carries its own settings.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v, colour }) {
  return (
    <div>
      <div style={{ font: '400 10.5px/1 var(--font-body)', color: 'var(--color-neutral-600)' }}>{label}</div>
      <div style={{ marginTop: 6, font: `400 21px/1 ${mono}`, color: colour || 'var(--color-text)' }}>{v}</div>
    </div>
  );
}
const Chip = ({ children, accent }) => (
  <span style={{ padding: '4px 9px', borderRadius: 20, background: accent ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'rgba(233,233,237,.05)', color: accent ? 'var(--color-accent-300)' : undefined }}>{children}</span>
);
const Arrow = () => <span style={{ color: 'var(--color-neutral-700)' }}>→</span>;
