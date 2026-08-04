import './globals.css'

export const metadata = {
  title: 'ICT Sweep Monitor',
  description: 'Trading strategy monitor and backtester',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-screen p-4 md:p-8 bg-zinc-950 text-zinc-50">
          <div className="max-w-6xl mx-auto">
            <header className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-white">ICT Sweep Monitor</h1>
              <p className="text-zinc-400 mt-2">Evaluate and backtest liquidity sweep models</p>
            </header>
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
