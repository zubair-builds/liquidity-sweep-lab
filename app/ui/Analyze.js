'use client';
import Chart from './Chart';
import Ladder from './Ladder';
import { legs as buildLegs, verdict } from './ladder_logic';
import { UP, DOWN, mono } from './theme';

export default function Analyze({ meta, bars, result, params, error }) {
  if (error) return <Notice tone="bad" title="That request was refused." body={error} />;
  if (!result) return <Notice title="Reading the bars…" body="Loading the file and running the model." />;

  const ls = buildLegs(result, params);
  const v = verdict(result, params);
  const sig = result.signal;

  const levels = sig
    ? [
        { k: 'Entry', v: sig.entry.toFixed(2), c: 'var(--color-text)' },
        { k: 'Stop', v: sig.stop.toFixed(2), c: DOWN },
        { k: 'Target', v: sig.target.toFixed(2), c: UP },
        { k: 'Reward : risk', v: (sig.riskReward ?? params.rr).toFixed(1), c: 'var(--color-accent-400)' },
      ]
    : [
        { k: 'Last price', v: bars.length ? bars[bars.length - 1].c.toFixed(2) : '—', c: 'var(--color-text)' },
        { k: 'Conditions met', v: v.passed + '/5', c: 'var(--color-neutral-400)' },
        { k: 'Bars analysed', v: String(result.meta?.barsAnalysed ?? bars.length), c: 'var(--color-neutral-400)' },
      ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '28px 40px 22px', display: 'flex', alignItems: 'flex-end', gap: 34, flex: 'none', borderBottom: '1px solid var(--color-divider)', background: 'radial-gradient(900px 240px at 6% 130%,color-mix(in srgb, var(--color-accent) 16%, transparent),transparent 70%)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `500 9.5px/1 ${mono}`, letterSpacing: '.11em', color: 'var(--color-neutral-700)' }}>
            {meta.instrument} · {meta.timeframe} · {result.meta?.barsReceived ?? bars.length} BARS
          </div>
          <div style={{ marginTop: 12, font: '300 50px/1.05 var(--font-heading)', letterSpacing: '-.035em', textWrap: 'pretty' }}>
            {v.head} <span style={{ color: 'var(--color-neutral-600)' }}>{v.sub}</span>
          </div>
          <div style={{ marginTop: 12, font: '400 13.5px/1.6 var(--font-body)', color: 'var(--color-neutral-500)', maxWidth: 640, textWrap: 'pretty' }}>{v.story}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 26, paddingBottom: 5 }}>
          {levels.map((l) => (
            <div key={l.k}>
              <div style={{ font: '400 10.5px/1 var(--font-body)', color: 'var(--color-neutral-600)' }}>{l.k}</div>
              <div style={{ marginTop: 6, font: `400 22px/1 ${mono}`, color: l.c }}>{l.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px 40px 16px', flex: 'none' }}><Ladder legs={ls} /></div>
      <div style={{ padding: '0 40px 26px', flex: 1, minHeight: 0 }}>
        <Chart bars={bars} result={result} />
      </div>
    </div>
  );
}

export function Notice({ title, body, tone }) {
  const bad = tone === 'bad';
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{ font: '300 26px/1.2 var(--font-heading)', letterSpacing: '-.02em', color: bad ? 'var(--color-down)' : 'var(--color-text)' }}>{title}</div>
        <div style={{ marginTop: 10, font: '400 13px/1.65 var(--font-body)', color: 'var(--color-neutral-500)' }}>{body}</div>
      </div>
    </div>
  );
}
