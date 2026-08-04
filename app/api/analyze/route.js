import { NextResponse } from 'next/server';
import { handleAnalyze } from '../../../server.js';
import { BarError } from '../../../bars.js';
import config from '../../../config.json';

export async function POST(req) {
  try {
    const body = await req.json();
    const { status, payload } = handleAnalyze(body, config);
    return NextResponse.json(payload, { status });
  } catch (err) {
    if (err instanceof BarError) {
      return NextResponse.json({ ok: false, error: err.message, detail: err.detail }, { status: 400 });
    }
    // Handle invalid JSON parsing from req.json()
    if (err instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: 'request body is not valid JSON' }, { status: 400 });
    }
    console.error('unhandled:', err);
    return NextResponse.json({ ok: false, error: 'internal error' }, { status: 500 });
  }
}
