import { useState, useEffect, useRef, useCallback } from 'react'
import type { Exchange, Holding, HoldingSearchMeta, Theme, TimeRange } from './types'
import { detectExchange, normalizeId } from './utils/exchange'
import { nextColor } from './utils/colors'
import {
  loadHoldings,
  saveHoldings,
  loadTheme,
  saveTheme,
  loadPctFootnoteHidden,
  savePctFootnoteHidden,
  loadSessionExchange,
  saveSessionExchange,
} from './utils/storage'
import { updateFavicon } from './utils/favicon'
import { useIntradayData } from './hooks/useIntradayData'
import Header from './components/Header'
import { captureAppAsPng } from './utils/capturePagePng'
import Chart, { type ChartRef } from './components/Chart'
import BottomStrip from './components/BottomStrip'
import Splash from './components/Splash'
import TimeRangePicker from './components/TimeRangePicker'
import './index.css'

const META_CTRL = /[\u0000-\u001F\u007F]/g

function sanitizeAddMeta(meta?: HoldingSearchMeta): Partial<Pick<Holding, 'companyName' | 'venueDisplay'>> {
  if (!meta) return {}
  const out: Partial<Pick<Holding, 'companyName' | 'venueDisplay'>> = {}
  if (typeof meta.companyName === 'string') {
    const s = meta.companyName.replace(META_CTRL, '').trim().slice(0, 120)
    if (s) out.companyName = s
  }
  if (typeof meta.venueDisplay === 'string') {
    const s = meta.venueDisplay.replace(META_CTRL, '').trim().slice(0, 48)
    if (s) out.venueDisplay = s
  }
  return out
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [holdings, setHoldings] = useState<Holding[]>(() => loadHoldings())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)
  const [selectedExchange, setSelectedExchange] = useState<Exchange | null>(() => loadSessionExchange())
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1D')
  const chartRef = useRef<ChartRef | null>(null)
  const [chartCanReset, setChartCanReset] = useState(false)

  const onCanResetChange = useCallback((can: boolean) => {
    setChartCanReset(can)
  }, [])

  const [pctFootnoteHidden, setPctFootnoteHidden] = useState(() => loadPctFootnoteHidden())

  const toggleExchange = (exchange: Exchange) =>
    setSelectedExchange(prev => prev === exchange ? null : exchange)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [idle, setIdle] = useState(false)

  const { data: seriesData, usingMock, loading, perTickerErrors, simulatedReason } = useIntradayData(holdings, selectedRange)

  const splashLoaded =
    !loading &&
    (holdings.length === 0 || holdings.every(h => seriesData[h.id] != null))

  // Persist
  useEffect(() => { saveTheme(theme) }, [theme])
  useEffect(() => { saveHoldings(holdings) }, [holdings])
  useEffect(() => { savePctFootnoteHidden(pctFootnoteHidden) }, [pctFootnoteHidden])
  useEffect(() => { saveSessionExchange(selectedExchange) }, [selectedExchange])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Match Safari / mobile toolbar tint to active theme
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    meta.setAttribute('content', theme === 'dark' ? '#0a0a0f' : '#f8f8f6')
  }, [theme])

  // Cycle tab title through each holding every 2s when the tab is visible
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
      if (document.visibilityState !== 'visible') return
      cycleIdx.current = (cycleIdx.current + 1) % holdings.length
      updateTitle()
    }, 2000)

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

  const addHolding = (ticker: string, meta?: HoldingSearchMeta) => {
    const id = normalizeId(ticker)
    if (holdings.find(h => h.id === id)) return
    const exchange = detectExchange(id)
    const color = nextColor(holdings.map(h => h.color))
    const extra = sanitizeAddMeta(meta)
    setHoldings(prev => [...prev, { id, ticker: id, exchange, color, ...extra }])
  }

  const removeHolding = (id: string) => {
    setHoldings(prev => prev.filter(h => h.id !== id))
    if (focusedId === id) setFocusedId(null)
  }

  const updateColor = (id: string, color: string) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, color } : h))
  }

  const updateDotColor = (id: string, dotColor: string | undefined) => {
    setHoldings(prev => prev.map(h => {
      if (h.id !== id) return h
      if (dotColor === undefined) {
        const { dotColor: _removed, ...rest } = h
        return rest as typeof h
      }
      return { ...h, dotColor }
    }))
  }

  const updateStyle = useCallback(
    (id: string, patch: Partial<Pick<Holding, 'lineStyle' | 'lineThickness' | 'gradientColors'>>) => {
      setHoldings(prev => prev.map(h => h.id === id ? { ...h, ...patch } : h))
    },
    [],
  )

  const updateLinear = useCallback((id: string, linear: boolean) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, linear } : h))
  }, [])

  const updateOpacity = useCallback((id: string, lineOpacity: number) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, lineOpacity } : h))
  }, [])

  const toggleFocus = (id: string) => {
    setFocusedId(prev => prev === id ? null : id)
  }

  const focusedHolding = holdings.find(h => h.id === focusedId) ?? null

  const onScreenshot = useCallback(async () => {
    try {
      await captureAppAsPng()
    } catch (e) {
      console.error('Screenshot failed', e, String(e))
      alert('Could not save screenshot. Please try again.')
    }
  }, [])

  const onHoldingMetaResolved = useCallback(
    (id: string, meta: Partial<Pick<Holding, 'companyName' | 'venueDisplay'>>) => {
      const sanitized = sanitizeAddMeta(meta)
      if (Object.keys(sanitized).length === 0) return
      setHoldings(prev => prev.map(h => (h.id === id ? { ...h, ...sanitized } : h)))
    },
    [],
  )

  return (
    <div className="app" data-idle={idle ? 'true' : undefined}>
      <Splash loaded={splashLoaded} />
      <Header
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onScreenshot={onScreenshot}
        hoveredTime={hoveredTime}
        selectedExchange={selectedExchange}
        onSelectExchange={toggleExchange}
        focusedHolding={focusedHolding}
        seriesData={seriesData}
        onHoldingMetaResolved={onHoldingMetaResolved}
      />
      {usingMock && simulatedReason === 'after_hours' && (
        <div role="status" aria-live="polite" className="mock-banner">
          Markets closed — showing simulated intraday
        </div>
      )}
      {usingMock && simulatedReason === 'offline' && (
        <div role="status" aria-live="polite" className="mock-banner mock-banner--warn">
          Can&apos;t reach market data — showing simulated series. Check your connection or try refreshing.
        </div>
      )}
      {usingMock && simulatedReason === 'historical_demo' && (
        <div role="status" aria-live="polite" className="mock-banner mock-banner--warn">
          Historical data unavailable — showing demo series for this range.
        </div>
      )}
      {selectedExchange === 'TSE' && holdings.every(h => h.exchange !== 'TSE') && (
        <div className="tse-context-hint">
          Tokyo hours shown on the chart; lines follow each ticker&apos;s home market.
        </div>
      )}
      <main className="main">
        <Chart
          ref={chartRef}
          holdings={holdings}
          seriesData={seriesData}
          focusedId={focusedId}
          theme={theme}
          onHoverTime={setHoveredTime}
          onFocusLine={toggleFocus}
          onClearLineFocus={() => setFocusedId(null)}
          selectedExchange={selectedExchange}
          timeRange={selectedRange}
          loading={loading}
          onCanResetChange={onCanResetChange}
        />
        <TimeRangePicker
          value={selectedRange}
          onChange={setSelectedRange}
          chartCanReset={chartCanReset}
          onChartReset={() => chartRef.current?.resetView()}
        />
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
        onDotColorChange={updateDotColor}
        onLinearChange={updateLinear}
        onOpacityChange={updateOpacity}
        onStyleChange={updateStyle}
        onAdd={addHolding}
        onRemove={removeHolding}
        tickerErrors={perTickerErrors}
        timeRange={selectedRange}
        pctFootnoteHidden={pctFootnoteHidden}
        onPctFootnoteHiddenChange={setPctFootnoteHidden}
      />
    </div>
  )
}
