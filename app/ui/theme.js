// Shared style fragments. Colours are read from globals.css, never hard-coded here.
export const UP = 'var(--color-up)';
export const DOWN = 'var(--color-down)';
export const UP_DIM = 'var(--color-up-dim)';
export const DOWN_DIM = 'var(--color-down-dim)';

export const mono = "var(--font-mono)";
export const kicker = {
  font: `500 9.5px/1 ${mono}`,
  letterSpacing: '.11em',
  color: 'var(--color-neutral-700)',
};
export const h1 = {
  margin: '14px 0 0',
  font: '300 34px/1.15 var(--font-heading)',
  letterSpacing: '-.03em',
};
export const lede = {
  margin: '12px 0 0',
  font: '400 14px/1.65 var(--font-body)',
  color: 'var(--color-neutral-500)',
  maxWidth: 640,
  textWrap: 'pretty',
};
export const panel = {
  borderRadius: 'var(--radius-md)',
  background: 'rgba(233,233,237,.03)',
  boxShadow: 'inset 0 0 0 1px rgba(233,233,237,.06)',
};
export const outlineBtn = {
  padding: '7px 15px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-accent)',
  background: 'transparent',
  color: 'var(--color-accent-300)',
  font: '500 12px/1 var(--font-body)',
  cursor: 'pointer',
};

export const fmt = (v, dp = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(dp));
export const when = (t) =>
  new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
