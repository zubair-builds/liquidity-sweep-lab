'use client';
import { useEffect, useRef, useState } from 'react';
import { UP, DOWN, UP_DIM, DOWN_DIM, mono } from './theme';

/**
 * Candles from the bar file, overlays from what /api/analyze returned.
 * Nothing is drawn that the server did not report.
 */
export default function Chart({ bars, result, count = 150 }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 900, h: 300 });

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) })
    );
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const w = Math.max(200, size.w - 82);
  const h = Math.max(120, size.h - 38);
  const shown = bars.slice(-count);

  let content = null;
  let axis = [];
  let from = '';
  let to = '';

  if (shown.length) {
    let lo = Infinity, hi = -Infinity;
    shown.forEach((b) => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
    const sig = result?.signal;
    if (sig) { lo = Math.min(lo, sig.stop); hi = Math.max(hi, sig.target); }
    const pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
    const y = (p) => ((hi - p) / (hi - lo)) * h;
    const cw = w / shown.length;
    const bw = Math.max(1.4, cw * 0.6);
    const dp = hi > 500 ? 0 : 2;

    const rule = (p, colour, text, dashed) => (
      <div key={text}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: y(p), borderTop: `1px ${dashed ? 'dashed' : 'solid'} ${colour}`, opacity: 0.85 }} />
        <div style={{ position: 'absolute', right: 2, top: y(p) - 8, padding: '1px 5px', borderRadius: 3, background: colour, color: 'var(--color-bg)', font: `500 9px/1.5 ${mono}`, whiteSpace: 'nowrap' }}>{text}</div>
      </div>
    );

    const overlays = [];
    const swept = sig?.sweptLevel;
    if (swept != null) overlays.push(rule(swept, DOWN, 'swept ' + swept.toFixed(2)));
    const fvg = result?.context?.nearestFVGAbove || result?.context?.nearestFVGBelow;
    if (fvg) {
      overlays.push(
        <div key="fvg" style={{ position: 'absolute', left: 0, right: 0, top: y(fvg.top), height: Math.max(3, y(fvg.bottom) - y(fvg.top)), background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent-400) 45%, transparent)', borderRadius: 2 }} />
      );
    }
    if (sig) {
      overlays.push(
        <div key="rr" style={{ position: 'absolute', left: 0, right: 0, top: Math.min(y(sig.entry), y(sig.target)), height: Math.abs(y(sig.entry) - y(sig.target)), background: 'rgba(134,192,163,.09)' }} />,
        <div key="risk" style={{ position: 'absolute', left: 0, right: 0, top: Math.min(y(sig.entry), y(sig.stop)), height: Math.abs(y(sig.stop) - y(sig.entry)), background: 'rgba(214,141,138,.09)' }} />
      );
      overlays.push(rule(sig.target, UP, 'TP ' + sig.target.toFixed(2)));
      overlays.push(rule(sig.entry, 'var(--color-accent-400)', 'entry ' + sig.entry.toFixed(2)));
      overlays.push(rule(sig.stop, DOWN, 'SL ' + sig.stop.toFixed(2), true));
    }

    content = (
      <>
        {overlays}
        {shown.map((b, i) => {
          const x = i * cw + (cw - bw) / 2;
          const up = b.c >= b.o;
          const top = y(Math.max(b.o, b.c));
          const bot = y(Math.min(b.o, b.c));
          return (
            <div key={i}>
              <div style={{ position: 'absolute', left: x + bw / 2 - 0.5, width: 1, top: y(b.h), height: y(b.l) - y(b.h), background: up ? UP_DIM : DOWN_DIM }} />
              <div style={{ position: 'absolute', left: x, width: bw, top, height: Math.max(1, bot - top), background: up ? UP : DOWN, opacity: 0.9 }} />
            </div>
          );
        })}
      </>
    );

    axis = [0, 1, 2, 3, 4].map((i) => (hi - ((hi - lo) * i) / 4).toFixed(dp));
    const d = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
    from = d(shown[0].t);
    to = d(shown[shown.length - 1].t);
  }

  return (
    <div ref={box} style={{ position: 'relative', height: '100%', borderRadius: 'var(--radius-md)', background: 'linear-gradient(180deg,#191c2b,#14161f)', boxShadow: 'inset 0 0 0 1px rgba(233,233,237,.06)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '14px 66px 24px 16px' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>{content}</div>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', height: 'calc(100% - 38px)', font: `400 9.5px/1 ${mono}`, color: 'var(--color-neutral-600)' }}>
        {axis.map((a) => <span key={a}>{a}</span>)}
      </div>
      <div style={{ position: 'absolute', left: 16, bottom: 5, font: `400 9.5px/1 ${mono}`, color: 'var(--color-neutral-700)' }}>{from}</div>
      <div style={{ position: 'absolute', right: 74, bottom: 5, font: `400 9.5px/1 ${mono}`, color: 'var(--color-neutral-700)' }}>{to}</div>
      <Legend />
    </div>
  );
}

function Legend() {
  const item = (swatch, label) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{swatch}{label}</span>
  );
  return (
    <div style={{ position: 'absolute', top: 12, left: 18, display: 'flex', gap: 15, font: '400 10px/1 var(--font-body)', color: 'var(--color-neutral-600)' }}>
      {item(<span style={{ width: 12, height: 2, background: DOWN }} />, 'swept level')}
      {item(<span style={{ width: 12, height: 8, background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent-400) 50%, transparent)' }} />, 'fair value gap')}
      {item(<span style={{ width: 12, height: 2, background: UP }} />, 'target')}
    </div>
  );
}
