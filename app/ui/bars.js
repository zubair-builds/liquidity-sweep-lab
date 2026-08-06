// Turns whatever /api/data returns into [{t,o,h,l,c}], matching bars.js on the server.
export function toBars(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.map((b) => ({ t: b.time ?? b.t, o: +(b.open ?? b.o), h: +(b.high ?? b.h), l: +(b.low ?? b.l), c: +(b.close ?? b.c) }));
  }
  const time = payload.time ?? payload.t;
  if (!time) return [];
  const open = payload.open ?? payload.o, high = payload.high ?? payload.h;
  const low = payload.low ?? payload.l, close = payload.close ?? payload.c;
  return time.map((t, i) => ({ t, o: +open[i], h: +high[i], l: +low[i], c: +close[i] }));
}

// The request body /api/analyze and /api/backtest both accept.
export function body(payload, meta, model, extra = {}) {
  return {
    instrument: meta.instrument,
    timeframe: meta.timeframe,
    bars: payload,
    model,
    lastBarClosed: true, // saved history: every bar is complete by definition
    ...extra,
  };
}
