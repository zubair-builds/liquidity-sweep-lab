'use client';
import { UP } from './theme';

export default function Ladder({ legs }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      {legs.map((l, i) => {
        const ok = l.state === 'pass';
        const skip = l.state === 'skip';
        const edge = ok ? UP : skip ? 'var(--color-neutral-800)' : 'var(--color-accent)';
        return (
          <div
            key={l.name}
            style={{
              flex: 1,
              padding: '14px 16px',
              background: ok ? 'rgba(134,192,163,.06)' : skip ? 'rgba(233,233,237,.02)' : 'color-mix(in srgb, var(--color-accent) 9%, transparent)',
              borderTop: `2px ${skip ? 'dashed' : 'solid'} ${edge}`,
              borderRadius: i === 0 ? 'var(--radius-md) 0 0 var(--radius-md)' : i === legs.length - 1 ? '0 var(--radius-md) var(--radius-md) 0' : 0,
              boxShadow: i < legs.length - 1 ? '1px 0 0 var(--color-bg)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 16, height: 16, flex: 'none', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  font: '600 10px/1 var(--font-body)',
                  background: ok ? UP : skip ? 'transparent' : 'color-mix(in srgb, var(--color-accent-400) 20%, transparent)',
                  color: ok ? 'var(--color-bg)' : 'var(--color-accent-400)',
                  boxShadow: `0 0 0 1px ${ok ? 'transparent' : skip ? 'var(--color-neutral-800)' : 'color-mix(in srgb, var(--color-accent-400) 50%, transparent)'}`,
                }}
              >
                {ok ? '✓' : skip ? '' : '·'}
              </div>
              <div style={{ font: '500 12.5px/1.2 var(--font-body)', color: ok ? 'var(--color-text)' : skip ? 'var(--color-neutral-600)' : 'var(--color-neutral-400)' }}>{l.name}</div>
            </div>
            <div style={{ marginTop: 7, font: '400 11px/1.5 var(--font-body)', color: 'var(--color-neutral-600)' }}>{l.note}</div>
          </div>
        );
      })}
    </div>
  );
}
