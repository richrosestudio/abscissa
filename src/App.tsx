import { useState, useEffect, useRef } from 'react'
import type { Exchange, Holding, Theme, TimeRange } from './types'
import { detectExchange, normalizeId } from './utils/exchange'
import { nextColor } from './utils/colors'
import { loadHoldings, saveHoldings, loadTheme, saveTheme } from './utils/storage'
import { updateFavicon } from './utils/favicon'
import { useIntradayData } from './hooks/useIntradayData'
import Header from './components/Header'
import Chart from './components/Chart'
import BottomStrip from './components/BottomStrip'
import Splash from './components/Splash'
import TimeRangePicker from './components/TimeRangePicker'
import './index.css'

const DEFAULT_HOLDINGS: Holding[] = [
  { id: 'AAPL',  ticker: 'AAPL',  exchange: 'US',  color: '#6366f1' },
  { id: 'TSLA',  ticker: 'TSLA',  exchange: 'US',  color: '#f59e0b' },
  { id: 'NVDA',  ticker: 'NVDA',  exchange: 'US',  color: '#10b981' },
  { id: 'VOD.L', ticker: 'VOD.L', exchange: 'LSE', color: '#ef4444' },
  { id: 'BP.L',  ticker: 'BP.L',  exchange: 'LSE', color: '#3b82f6' },
]

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [holdings, setHoldings] = useState<Holding[]>(() => {
    const saved = loadHoldings()
    return saved.length > 0 ? saved : DEFAULT_HOLDINGS
  })
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)
  const [selectedExchange, setSelectedExchange] = useState<Exchange | null>('US')
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1D')

  const toggleExchange = (exchange: Exchange) =>
    setSelectedExchange(prev => prev === exchange ? null : exchange)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [idle, setIdle] = useState(false)

  const { data: seriesData, usingMock, loading, perTickerErrors } = useIntradayData(holdings, selectedRange)

  // Persist
  useEffect(() => { saveTheme(theme) }, [theme])
  useEffect(() => { saveHoldings(holdings) }, [holdings])

  // Apply theme class to root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Cycle tab title through each holding every 3 s; favicon stays as portfolio aggregate
  const cycleIdx = useRef(0)

  useEffect(() => {
    if (holdings.length === 0) {
      document.title = 'Abscissa'
      return
    }

    const updateTitle = () => {
      const h = holdings[cycleIdx.current % holdings.length]
      const pct = seriesData[h.id]?.latestPct ?? 0
      const fmt = (p: number) => (p >= 0 ? `+${p.toFixed(2)}` : p.toFixed(2))
      document.title = `${h.ticker}  ${fmt(pct)}%`
    }

    updateTitle()
    const id = setInterval(() => {
      cycleIdx.current = (cycleIdx.current + 1) % holdings.length
      updateTitle()
    }, 3000)

    return () => clearInterval(id)
  }, [holdings, seriesData])

  // Favicon: portfolio aggregate green/red dot
  useEffect(() => {
    updateFavicon(holdings.map(h => seriesData[h.id]?.latestPct ?? 0))
  }, [holdings, seriesData])

  // Idle detection — dim to 90% after 3 min of no interaction
  useEffect(() => {
    const resetIdle = () => {
      setIdle(false)
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => setIdle(true), 3 * 60 * 1000)
    }
    const events = ['mousemove', 'pointerdown', 'keydown', 'touchstart']
    events.forEach(e => window.addEventListener(e, resetIdle, { passive: true }))
    resetIdle()
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdle))
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [])

  const addHolding = (ticker: string) => {
    const id = normalizeId(ticker)
    if (holdings.find(h => h.id === id)) return
    const exchange = detectExchange(id)
    const color = nextColor(holdings.map(h => h.color))
    setHoldings(prev => [...prev, { id, ticker: id, exchange, color }])
  }

  const removeHolding = (id: string) => {
    setHoldings(prev => prev.filter(h => h.id !== id))
    if (focusedId === id) setFocusedId(null)
  }

  const updateColor = (id: string, color: string) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, color } : h))
  }

  const toggleFocus = (id: string) => {
    setFocusedId(prev => prev === id ? null : id)
  }

  return (
    <div className="app" data-idle={idle ? 'true' : undefined}>
      <Splash loaded={!loading} />
      <Header
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        hoveredTime={hoveredTime}
        selectedExchange={selectedExchange}
        onSelectExchange={toggleExchange}
      />
      {usingMock && (
        <div className="mock-banner">
          Markets closed — showing simulated data
        </div>
      )}
      {selectedExchange === 'TSE' && holdings.every(h => h.exchange !== 'TSE') && (
        <div className="tse-context-hint">
          Tokyo hours shown on the chart; lines follow each ticker&apos;s home market.
        </div>
      )}
      <main className="main">
        <Chart
          holdings={holdings}
          seriesData={seriesData}
          focusedId={focusedId}
          theme={theme}
          onHoverTime={setHoveredTime}
          selectedExchange={selectedExchange}
          timeRange={selectedRange}
          loading={loading}
        />
        <TimeRangePicker value={selectedRange} onChange={setSelectedRange} />
      </main>
      <BottomStrip
        holdings={holdings}
        seriesData={seriesData}
        focusedId={focusedId}
        theme={theme}
        hoveredTime={hoveredTime}
        onFocus={toggleFocus}
        onResetFocus={() => setFocusedId(null)}
        onColorChange={updateColor}
        onAdd={addHolding}
        onRemove={removeHolding}
        tickerErrors={perTickerErrors}
      />
    </div>
  )
}
