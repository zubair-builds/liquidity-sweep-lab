'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Overview from './ui/Overview';
import Analyze from './ui/Analyze';
import BacktestView from './ui/Backtest';
import Settings, { DEFAULTS } from './ui/Settings';
import { toBars, body } from './ui/bars';
import { outlineBtn } from './ui/theme';

const TABS = [
  ['overview', 'Overview'],
  ['analyze', 'Analyze'],
  ['backtest', 'Backtest'],
  ['settings', 'Settings'],
];

const tfName = (step) =>
  ({ FIFTEEN_MINS: '15m', ONE_HOUR: '1h', FOUR_HOURS: '4h', ONE_DAY: '1d' }[step] || step);

export default function Page() {
  const [screen, setScreen] = useState('analyze');
  const [datasets, setDatasets] = useState([]);
  const [sel, setSel] = useState(null);
  const [params, setParams] = useState(DEFAULTS);
  const [payloads, setPayloads] = useState({});   // file -> raw /api/data body
  const [analyses, setAnalyses] = useState({});   // file -> /api/analyze result
  const [backtest, setBacktest] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const meta = useMemo(() => {
    const d = datasets.find((x) => x.file === sel);
    return d
      ? { instrument: d.instrument, timeframe: tfName(d.step), name: d.name, file: d.file, bars: d.bars }
      : { instrument: '', timeframe: '', name: '', file: '', bars: 0 };
  }, [datasets, sel]);

  // 1. manifest
  useEffect(() => {
    fetch('/api/data')
      .then((r) => r.json())
      .then((d) => {
        const list = d.datasets || [];
        setDatasets(list);
        if (list.length) setSel(list[0].file);
      })
      .catch((e) => setErrors((x) => ({ ...x, manifest: e.message })));
  }, []);

  // 2. every bar file, once
  useEffect(() => {
    datasets.forEach((d) => {
      if (payloads[d.file]) return;
      fetch(`/api/data?file=${encodeURIComponent(d.file)}`)
        .then((r) => r.json())
        .then((p) => setPayloads((x) => ({ ...x, [d.file]: p })))
        .catch(() => {});
    });
  }, [datasets]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. analyse everything whenever params change
  useEffect(() => {
    let cancelled = false;
    datasets.forEach((d) => {
      const p = payloads[d.file];
      if (!p) return;
      fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(p, { instrument: d.instrument, timeframe: tfName(d.step) }, params)),
      })
        .then(async (r) => ({ ok: r.ok, json: await r.json() }))
        .then(({ ok, json }) => {
          if (cancelled) return;
          if (ok) setAnalyses((x) => ({ ...x, [d.file]: json }));
          else setErrors((x) => ({ ...x, [d.file]: json.error || 'request refused' }));
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [datasets, payloads, params]);

  // 4. backtest only the selected file
  useEffect(() => {
    const p = payloads[sel];
    if (!p) return;
    let cancelled = false;
    setBusy(true);
    fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(p, meta, params, { includeTrades: true })),
    })
      .then(async (r) => ({ ok: r.ok, json: await r.json() }))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (ok) { setBacktest(json); setErrors((x) => ({ ...x, backtest: null })); }
        else setErrors((x) => ({ ...x, backtest: json.error || 'request refused' }));
      })
      .catch((e) => setErrors((x) => ({ ...x, backtest: e.message })))
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [sel, payloads, params]); // eslint-disable-line react-hooks/exhaustive-deps

  const setParam = useCallback((k, v) => setParams((p) => ({ ...p, [k]: v })), []);
  const bars = useMemo(() => toBars(payloads[sel]), [payloads, sel]);
  const result = analyses[sel];

  const rows = datasets.map((d) => {
    const b = toBars(payloads[d.file]);
    return {
      file: d.file,
      instrument: d.instrument,
      name: d.name,
      timeframe: tfName(d.step),
      bars: d.bars,
      last: b.length ? b[b.length - 1].c.toFixed(2) : null,
      result: analyses[d.file],
    };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 660, background: 'var(--color-bg)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '0 26px', height: 56, flex: 'none', borderBottom: '1px solid var(--color-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 21, height: 21, borderRadius: 6, background: 'linear-gradient(150deg,var(--color-accent),var(--color-accent-700))' }} />
          <span style={{ font: '500 13.5px/1 var(--font-heading)', letterSpacing: '-.01em' }}>Sweep</span>
        </div>
        <nav style={{ display: 'flex', gap: 4 }}>
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setScreen(k)}
              style={{
                padding: '7px 12px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                font: `${screen === k ? 500 : 400} 12.5px/1 var(--font-body)`,
                color: screen === k ? 'var(--color-text)' : 'var(--color-neutral-600)',
                background: screen === k ? 'rgba(233,233,237,.06)' : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px 5px 11px', borderRadius: 'var(--radius-md)', background: 'rgba(233,233,237,.05)' }}>
            <span style={{ font: '400 11.5px/1 var(--font-body)', color: 'var(--color-neutral-500)' }}>Data</span>
            <select
              value={sel || ''}
              onChange={(e) => setSel(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text)', font: '500 12px/1 var(--font-body)', cursor: 'pointer', padding: '3px 2px' }}
            >
              {datasets.map((d) => (
                <option key={d.file} value={d.file}>{d.instrument} {tfName(d.step)}</option>
              ))}
            </select>
          </div>
          <button onClick={() => setParams((p) => ({ ...p }))} style={outlineBtn}>
            {busy ? 'Running…' : 'Re-run'}
          </button>
        </div>
      </header>

      {screen === 'overview' && <Overview rows={rows} params={params} onOpen={(f) => { setSel(f); setScreen('analyze'); }} />}
      {screen === 'analyze' && <Analyze meta={meta} bars={bars} result={result} params={params} error={errors[sel]} />}
      {screen === 'backtest' && <BacktestView meta={meta} result={backtest} params={params} error={errors.backtest} onSettings={() => setScreen('settings')} />}
      {screen === 'settings' && <Settings params={params} setParam={setParam} reset={() => setParams(DEFAULTS)} backtest={backtest} meta={meta} />}
    </div>
  );
}
