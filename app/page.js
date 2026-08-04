'use client';
import { useState } from 'react';

export default function Dashboard() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('analyze'); // 'analyze' or 'backtest'
  const [selectedDataset, setSelectedDataset] = useState('');

  const handleDatasetChange = async (e) => {
    const file = e.target.value;
    setSelectedDataset(file);
    if (!file) {
      setInput('');
      return;
    }
    
    try {
      const res = await fetch(`/api/data?file=${file}`);
      if (!res.ok) throw new Error('Failed to load dataset');
      const data = await res.json();
      setInput(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAction = async (endpoint) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setView(endpoint);
    
    try {
      let payload;
      try {
        payload = JSON.parse(input);
      } catch(e) {
        throw new Error('Invalid JSON input. Please paste a valid JSON object or array.');
      }

      // If it's just an array, wrap it in a bars object for convenience
      if (Array.isArray(payload)) {
        payload = { bars: payload };
      } else if (payload && typeof payload === 'object' && !payload.bars && payload.time && payload.open) {
        // If it's a raw IBKR JSON object without the 'bars' wrapper, wrap it
        payload = { bars: payload };
      }

      if (!payload.bars) {
         throw new Error('Input must contain a "bars" field, be an array of bars, or be an object containing arrays for time, open, high, low, close.');
      }

      if (endpoint === 'backtest') {
        payload.includeTrades = true;
      }

      const res = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Something went wrong');
      }
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const MetricCard = ({ title, value, positive }) => (
    <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex flex-col items-start shadow-sm">
      <span className="text-zinc-400 text-sm font-medium mb-1">{title}</span>
      <span className={`text-2xl font-bold ${positive === true ? 'text-emerald-400' : positive === false ? 'text-rose-400' : 'text-zinc-100'}`}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-zinc-300">
              Paste JSON Payload (Bars)
            </label>
            <select 
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              value={selectedDataset}
              onChange={handleDatasetChange}
            >
              <option value="">-- Or load a dataset --</option>
              <option value="xauusd-4h.json">XAUUSD 4H</option>
              <option value="xauusd-1h-real.json">XAUUSD 1H Real</option>
              <option value="sample-xauusd-1h.json">XAUUSD 1H Sample</option>
            </select>
          </div>
          <textarea
            className="w-full h-[200px] bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-zinc-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            placeholder={'{\n  "bars": [\n    { "time": "2026-07-05T22:00:00Z", "open": 4175.15, "high": 4192.19, ... }\n  ]\n}'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => handleAction('analyze')}
            disabled={loading || !input}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && view === 'analyze' ? 'Running...' : 'Analyze Current State'}
          </button>
          <button
            onClick={() => handleAction('backtest')}
            disabled={loading || !input}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && view === 'backtest' ? 'Running...' : 'Run Full Backtest'}
          </button>
        </div>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 min-h-[500px]">
        <h2 className="text-xl font-semibold text-white mb-6">Results</h2>
        
        {error && (
          <div className="bg-rose-950/50 border border-rose-900 text-rose-200 p-4 rounded-xl mb-4">
            {error}
          </div>
        )}

        {!result && !error && !loading && (
          <div className="text-zinc-500 text-center mt-32">
            Paste your data and run an analysis to see results here.
          </div>
        )}

        {loading && (
          <div className="text-indigo-400 text-center mt-32 animate-pulse font-medium">
            Processing...
          </div>
        )}

        {result && view === 'backtest' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <MetricCard title="Win Rate" value={`${result.stats.winRate.toFixed(1)}%`} positive={result.stats.winRate > 50} />
              <MetricCard title="Total PnL (%)" value={`${result.stats.totalNetPercent.toFixed(2)}%`} positive={result.stats.totalNetPercent > 0} />
              <MetricCard title="Total R" value={result.stats.totalR.toFixed(2)} positive={result.stats.totalR > 0} />
              <MetricCard title="Avg Trade (%)" value={`${result.stats.avgNetPercent.toFixed(3)}%`} positive={result.stats.avgNetPercent > 0} />
              <MetricCard title="Expectancy (R)" value={result.stats.expectancyR.toFixed(2)} positive={result.stats.expectancyR > 0} />
              <MetricCard title="Profit Factor" value={result.stats.profitFactor ? result.stats.profitFactor.toFixed(2) : 'N/A'} positive={result.stats.profitFactor > 1} />
              <MetricCard title="Max Drawdown (R)" value={result.stats.maxDrawdownR.toFixed(2)} positive={false} />
              <MetricCard title="Total Trades" value={result.stats.trades} />
              <MetricCard title="Avg Bars Held" value={Math.round(result.stats.avgBarsHeld)} />
            </div>

            {result.trades && result.trades.length > 0 && (
              <div className="mt-8 border-t border-zinc-800 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">Trade History</h3>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="sticky top-0 bg-zinc-950">
                      <tr className="border-b border-zinc-800 text-zinc-400">
                        <th className="pb-3 pr-4 font-medium">Entry Time</th>
                        <th className="pb-3 pr-4 font-medium">Side</th>
                        <th className="pb-3 pr-4 font-medium">Entry</th>
                        <th className="pb-3 pr-4 font-medium">Exit</th>
                        <th className="pb-3 pr-4 font-medium">SL / TP</th>
                        <th className="pb-3 pr-4 font-medium">Outcome</th>
                        <th className="pb-3 pr-4 font-medium">PnL (R)</th>
                        <th className="pb-3 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {result.trades.map((t, i) => (
                        <tr key={i} className="hover:bg-zinc-900/50 transition-colors">
                          <td className="py-3 pr-4 text-zinc-300">{new Date(t.time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td className="py-3 pr-4">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${t.side === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{t.side}</span>
                          </td>
                          <td className="py-3 pr-4 font-mono text-zinc-300">{t.entry.toFixed(2)}</td>
                          <td className="py-3 pr-4 font-mono text-zinc-300">{t.exitPrice.toFixed(2)}</td>
                          <td className="py-3 pr-4 font-mono text-zinc-500 text-xs">
                            SL: <span className="text-rose-400/70">{t.stop.toFixed(2)}</span><br/>
                            TP: <span className="text-emerald-400/70">{t.target.toFixed(2)}</span>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`font-semibold ${t.outcome === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.outcome}</span>
                          </td>
                          <td className={`py-3 pr-4 font-mono font-medium ${t.r > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {t.r > 0 ? '+' : ''}{t.r.toFixed(2)}R
                          </td>
                          <td className="py-3 text-zinc-400 text-xs">
                            {t.barsHeld} bars<br/>
                            {new Date(t.exitTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {result && view === 'analyze' && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <div className={`px-4 py-2 rounded-lg font-bold text-lg ${
                result.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                result.action === 'SELL' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                'bg-zinc-800 text-zinc-300'
              }`}>
                ACTION: {result.action}
              </div>
              <div className="text-zinc-400 font-medium">State: <span className="text-white">{result.state}</span></div>
            </div>
            
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Conditions Checks</h3>
            <div className="grid grid-cols-2 gap-3">
               {Object.entries(result.checks).map(([key, passed]) => (
                 <div key={key} className="flex items-center gap-3 bg-zinc-900 p-3 rounded-lg border border-zinc-800/50">
                    <div className={`w-3 h-3 rounded-full ${passed ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-600'}`}></div>
                    <span className="text-zinc-300 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                 </div>
               ))}
            </div>
            
            {result.signal && (
              <div className="mt-6 pt-6 border-t border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Signal Details</h3>
                <div className="grid grid-cols-3 gap-4 bg-zinc-900 p-4 rounded-xl border border-zinc-800/50">
                   <div>
                     <div className="text-zinc-500 text-xs mb-1">Entry</div>
                     <div className="text-white font-mono">{result.signal.entry.toFixed(2)}</div>
                   </div>
                   <div>
                     <div className="text-zinc-500 text-xs mb-1">Stop</div>
                     <div className="text-rose-400 font-mono">{result.signal.stop.toFixed(2)}</div>
                   </div>
                   <div>
                     <div className="text-zinc-500 text-xs mb-1">Target</div>
                     <div className="text-emerald-400 font-mono">{result.signal.target.toFixed(2)}</div>
                   </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
