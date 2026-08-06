'use client';
import { legs as buildLegs } from './ladder';
import { UP, mono, kicker, h1, lede } from './theme';

const COLS = '1.5fr .7fr .8fr 1fr 1.6fr .8fr';

export default function Overview({ rows, params, onOpen }) {
  const enriched = rows.map((r) => {
    const res = r.result;
    const ls = res ? buildLegs(res, params) : [];
    const passed = ls.filter((l) => l.state === 'pass').length;
    const fired = res?.action === 'BUY' || res?.action === 'SELL';
    const armed = !!res?.armed;
    return { ...r, passed, fired, armed, hot: fired || (armed && passed >= 3) };
  });

  const hot = enriched.filter((r) => r.hot).length;
  const armed = enriched.filter((r) => r.armed && !r.fired).length;
  const headline = hot
    ? `${hot} of your ${enriched.length} files ${hot === 1 ? 'is' : 'are'} close to a signal.`
    : armed
    ? `Nothing is close. ${armed} ${armed === 1 ? 'file has' : 'files have'} swept a level, but nothing has confirmed.`
    : 'Nothing is building right now.';

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '34px 40px 40px' }}>
      <div style={{ maxWidth: 1180 }}>
        <div style={kicker}>EVERYTHING YOU&rsquo;VE LOADED</div>
        <h1 style={h1}>{headline}</h1>
        <p style={lede}>
          Each row is a saved bar file, replayed through the model just now. Nothing here is live —
          the app never fetches prices, you hand it bars. Click a row to open it.
        </p>

        <div style={{ marginTop: 28, borderRadius: 'var(--radius-md)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '11px 18px', background: 'rgba(233,233,237,.04)', font: `500 9.5px/1 ${mono}`, letterSpacing: '.09em', color: 'var(--color-neutral-600)' }}>
            <span>INSTRUMENT</span><span>TF</span><span>BARS</span><span>LAST</span>
            <span>WHERE IT STANDS</span><span style={{ textAlign: 'right' }}>CONDITIONS</span>
          </div>
          {enriched.map((r) => <Row key={r.file} r={r} onOpen={onOpen} />)}
        </div>

        <p style={{ margin: '20px 0 0', font: '400 11.5px/1.6 var(--font-body)', color: 'var(--color-neutral-700)', maxWidth: 620 }}>
          Signals are rare on purpose. Long stretches of &ldquo;nothing doing&rdquo; are the normal state of this
          model, not a bug — see the backtest tab before you read anything into a single one.
        </p>
      </div>
    </div>
  );
}

function Row({ r, onOpen }) {
  const res = r.result;
  const side = (res?.state || '').includes('SHORT') ? 'short' : 'long';
  const text = !res
    ? 'loading'
    : r.fired
    ? side === 'long' ? 'Buy signal' : 'Sell signal'
    : r.armed
    ? `Armed ${side} · ${r.passed}/5 · ${res.armed.barsRemaining} bars left`
    : 'Quiet';
  const colour = r.fired ? UP : r.armed ? 'var(--color-accent-300)' : 'var(--color-neutral-500)';
  const dotBg = r.fired ? UP : r.armed ? 'var(--color-accent-400)' : 'var(--color-neutral-700)';

  return (
    <button
      onClick={() => res && onOpen(r.file)}
      style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '13px 18px', border: 'none', borderTop: '1px solid var(--color-divider)', background: 'transparent', color: 'var(--color-text)', cursor: res ? 'pointer' : 'default', textAlign: 'left', width: '100%', fontFamily: 'var(--font-body)' }}
    >
      <span>
        <span style={{ font: '500 13px/1.3 var(--font-body)', display: 'block' }}>{r.instrument}</span>
        <span style={{ font: '400 10.5px/1.3 var(--font-body)', color: 'var(--color-neutral-600)' }}>{r.name}</span>
      </span>
      <span style={{ font: `400 11.5px/1 ${mono}`, color: 'var(--color-neutral-400)' }}>{r.timeframe}</span>
      <span style={{ font: `400 11.5px/1 ${mono}`, color: 'var(--color-neutral-600)' }}>{r.bars}</span>
      <span style={{ font: `500 13px/1 ${mono}` }}>{r.last ?? '—'}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotBg, boxShadow: r.fired || r.armed ? `0 0 8px ${dotBg}` : 'none' }} />
        <span style={{ font: '400 12px/1.4 var(--font-body)', color: colour }}>{text}</span>
      </span>
      <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 3 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ width: 16, height: 4, borderRadius: 2, background: i < r.passed ? (r.fired ? UP : 'var(--color-accent-400)') : 'var(--color-neutral-800)' }} />
        ))}
      </span>
    </button>
  );
}
