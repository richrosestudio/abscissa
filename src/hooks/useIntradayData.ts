import { useState, useEffect, useRef, useCallback } from 'react'
import type { Holding, SeriesData, TimeRange } from '../types'
import { shouldPoll } from '../utils/exchange'
import {
  getMockSeriesData,
  getMockHistoricalData,
  tickSeries,
  MOCK_TICK_INTERVAL_SEC,
  MOCK_VOLATILITIES,
  MOCK_OPEN_PRICES,
  DEFAULT_VOLATILITY,
} from '../utils/mockData'

const POLL_INTERVAL_MS  = 60_000
const HIST_REFRESH_MS   = 10 * 60_000  // re-fetch historical every 10 min
const MOCK_TICK_MS      = MOCK_TICK_INTERVAL_SEC * 1000

/** Merge intraday API JSON with prior series so one symbol failing does not drop others. */
function mergeIntradayFromApi(
  prev: Record<string, SeriesData>,
  json: { series?: Record<string, unknown> },
  holdings: Holding[],
): { nextData: Record<string, SeriesData>; perTickerErrors: Record<string, string> } {
  const perTickerErrors: Record<string, string> = {}
  const nextData: Record<string, SeriesData> = {}

  for (const h of holdings) {
    const entry = json.series?.[h.id] as
      | { points?: { t: number; pct: number }[]; meta?: { openPrice?: number; currency?: string }; error?: string }
      | undefined
    const apiErr = entry && typeof entry.error === 'string' ? entry.error : null

    if (entry && !entry.error && Array.isArray(entry.points)) {
      const points = entry.points.map(p => ({ time: p.t, value: p.pct }))
      if (points.length > 0) {
        nextData[h.id] = {
          id: h.id,
          points,
          latestPct: points[points.length - 1]?.value ?? 0,
          openPrice: entry.meta?.openPrice,
          currency: entry.meta?.currency,
        }
        continue
      }
    }

    const stale = prev[h.id]
    if (stale && stale.points.length > 0) {
      nextData[h.id] = stale
      if (apiErr) perTickerErrors[h.id] = apiErr
    } else if (apiErr) {
      perTickerErrors[h.id] = apiErr
    } else if (!entry) {
      perTickerErrors[h.id] = 'No data returned'
    } else {
      perTickerErrors[h.id] = 'No intraday points'
    }
  }

  for (const h of holdings) {
    if (nextData[h.id]) continue
    const m = getMockSeriesData([h])[h.id]
    if (!m?.points?.length) continue
    nextData[h.id] = {
      id: h.id,
      points: m.points,
      latestPct: m.latestPct,
      openPrice: MOCK_OPEN_PRICES[h.id]?.price,
      currency:
        MOCK_OPEN_PRICES[h.id]?.currency ??
        (h.exchange === 'LSE' ? 'GBp' : h.exchange === 'TSE' ? 'JPY' : 'USD'),
    }
    perTickerErrors[h.id] = perTickerErrors[h.id]
      ? `${perTickerErrors[h.id]} (simulated until live data loads)`
      : 'Live feed unavailable for this symbol — showing simulated intraday'
  }

  return { nextData, perTickerErrors }
}

/** Merge historical API JSON with prior series (non-1D ranges). */
function mergeHistoricalFromApi(
  prev: Record<string, SeriesData>,
  json: { series?: Record<string, unknown> },
  holdings: Holding[],
): { nextData: Record<string, SeriesData>; perTickerErrors: Record<string, string> } {
  const perTickerErrors: Record<string, string> = {}
  const nextData: Record<string, SeriesData> = {}

  for (const h of holdings) {
    const entry = json.series?.[h.id] as
      | { points?: { t: number; pct: number }[]; meta?: { basePrice?: number; currency?: string }; error?: string }
      | undefined
    const apiErr = entry && typeof entry.error === 'string' ? entry.error : null

    if (entry && !entry.error && Array.isArray(entry.points)) {
      const points = entry.points.map(p => ({ time: p.t, value: p.pct }))
      if (points.length > 0) {
        nextData[h.id] = {
          id: h.id,
          points,
          latestPct: points[points.length - 1]?.value ?? 0,
          openPrice: entry.meta?.basePrice,
          currency: entry.meta?.currency,
        }
        continue
      }
    }

    const stale = prev[h.id]
    if (stale && stale.points.length > 0) {
      nextData[h.id] = stale
      if (apiErr) perTickerErrors[h.id] = apiErr
    } else if (apiErr) {
      perTickerErrors[h.id] = apiErr
    } else if (!entry) {
      perTickerErrors[h.id] = 'No data returned'
    } else {
      perTickerErrors[h.id] = 'No historical points'
    }
  }

  return { nextData, perTickerErrors }
}

interface FetchState {
  data: Record<string, SeriesData>
  loading: boolean
  error: string | null
  lastFetchAt: number | null
  usingMock: boolean
  /** Set when the last fetch returned an error or empty series for that holding id */
  perTickerErrors: Record<string, string>
}

export function useIntradayData(holdings: Holding[], timeRange: TimeRange = '1D') {
  const [state, setState] = useState<FetchState>({
    data: {},
    loading: true,
    error: null,
    lastFetchAt: null,
    usingMock: false,
    perTickerErrors: {},
  })

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Persists the evolving mock data between ticks so each tick extends from the last
  const mockDataRef = useRef<Record<string, SeriesData>>({})
  const dataRef = useRef<Record<string, SeriesData>>(state.data)
  dataRef.current = state.data

  const fetchData = useCallback(async (signal: AbortSignal) => {
    if (holdings.length === 0) {
      setState(s => ({ ...s, loading: false, data: {}, perTickerErrors: {} }))
      return
    }

    const symbols = holdings.map(h => h.id).join(',')

    try {
      const resp = await fetch(`/api/intraday?symbols=${encodeURIComponent(symbols)}`, { signal })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()

      if (signal.aborted) return

      const { nextData, perTickerErrors } = mergeIntradayFromApi(dataRef.current, json, holdings)
      if (Object.keys(nextData).length === 0) {
        throw new Error('No usable data returned from API')
      }

      setState(s => ({
        ...s,
        data: nextData,
        perTickerErrors,
        loading: false,
        error: null,
        lastFetchAt: Date.now(),
        usingMock: false,
      }))
    } catch (err) {
      if (signal.aborted) return
      // Build mock entries for every holding so we always have something to show.
      const mockRaw = getMockSeriesData(holdings)
      const mockEntries: Record<string, SeriesData> = {}
      for (const h of holdings) {
        const d = mockRaw[h.id]
        if (d) {
          const mockMeta = MOCK_OPEN_PRICES[h.id]
          mockEntries[h.id] = {
            id: h.id,
            points: d.points,
            latestPct: d.latestPct,
            openPrice: mockMeta?.price,
            currency:
              mockMeta?.currency ??
              (h.exchange === 'LSE' ? 'GBp' : h.exchange === 'TSE' ? 'JPY' : 'USD'),
          }
        }
      }
      setState(s => {
        // Merge: keep existing real data and fill in any holdings that are missing.
        const merged: Record<string, SeriesData> = { ...s.data }
        for (const h of holdings) {
          if (!merged[h.id] && mockEntries[h.id]) {
            merged[h.id] = mockEntries[h.id]
          }
        }
        const hasAny = Object.keys(merged).length > 0
        return {
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          data: hasAny ? merged : mockEntries,
          usingMock: Object.keys(s.data).length === 0,
          perTickerErrors: {},
        }
      })
    }
  }, [holdings])

  // Seed mock data from the deterministic PRNG (called once per session or on holdings change)
  const initMock = useCallback((signal: AbortSignal) => {
    if (signal.aborted) return
    const mockRaw = getMockSeriesData(holdings)
    const mockData: Record<string, SeriesData> = {}
    for (const h of holdings) {
      const d = mockRaw[h.id]
      if (d) {
        const mockMeta = MOCK_OPEN_PRICES[h.id]
        mockData[h.id] = {
          id: h.id,
          points: d.points,
          latestPct: d.latestPct,
          openPrice: mockMeta?.price,
          currency: mockMeta?.currency,
        }
      }
    }
    mockDataRef.current = mockData
    setState(s => ({
      ...s,
      data: mockData,
      loading: false,
      error: null,
      usingMock: true,
      perTickerErrors: {},
    }))
  }, [holdings])

  // Advance each series by one tiny step — called every MOCK_TICK_MS for continuous animation
  const tickMock = useCallback(() => {
    const current = mockDataRef.current
    const next: Record<string, SeriesData> = {}
    for (const h of holdings) {
      const sd = current[h.id]
      if (!sd || sd.points.length === 0) continue
      const vol = MOCK_VOLATILITIES[h.id] ?? DEFAULT_VOLATILITY
      const newPoints = tickSeries(sd.points, vol)
      next[h.id] = {
        id: h.id,
        points: newPoints,
        latestPct: newPoints[newPoints.length - 1].value,
        openPrice: sd.openPrice,
        currency: sd.currency,
      }
    }
    // Stale interval from an empty portfolio can queue a tick with holdings=[] after first add —
    // do not wipe real data.
    if (holdings.length > 0 && Object.keys(next).length === 0) return
    mockDataRef.current = next
    setState(s => ({ ...s, data: next, usingMock: true, perTickerErrors: {} }))
  }, [holdings])

  // ── Historical fetch (non-1D ranges) ──────────────────────────────────────
  const fetchHistorical = useCallback(async (signal: AbortSignal) => {
    if (holdings.length === 0 || timeRange === '1D') return
    setState(s => ({ ...s, loading: s.data && Object.keys(s.data).length === 0 }))

    const symbols = holdings.map(h => h.id).join(',')
    try {
      const resp = await fetch(
        `/api/historical?symbols=${encodeURIComponent(symbols)}&range=${timeRange}`,
        { signal },
      )
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      if (signal.aborted) return

      const { nextData, perTickerErrors } = mergeHistoricalFromApi(dataRef.current, json, holdings)
      if (Object.keys(nextData).length === 0) throw new Error('No historical data')

      const hasUsableSeries = Object.values(nextData).some(d => d.points.length >= 2)
      if (!hasUsableSeries) throw new Error('Insufficient historical points for chart')

      setState(s => ({
        ...s,
        data: nextData,
        perTickerErrors,
        loading: false,
        error: null,
        lastFetchAt: Date.now(),
        usingMock: false,
      }))
    } catch {
      if (signal.aborted) return
      // Fall back to generated mock historical data (never keep 1D intraday for multi-day ranges)
      const mockRaw = getMockHistoricalData(timeRange as Exclude<TimeRange, '1D'>, holdings)
      const mockData: Record<string, SeriesData> = {}
      for (const h of holdings) {
        const d = mockRaw[h.id]
        if (d) mockData[h.id] = { id: h.id, points: d.points, latestPct: d.latestPct, openPrice: d.basePrice, currency: d.currency }
      }
      setState(s => ({
        ...s,
        loading: false,
        data: Object.keys(mockData).length > 0 ? mockData : s.data,
        usingMock: Object.keys(mockData).length > 0,
        perTickerErrors: {},
      }))
    }
  }, [holdings, timeRange])

  // Initial load
  useEffect(() => {
    // Each effect invocation gets its own AbortController so stale in-flight
    // requests from previous holdings/timeRange configurations are cancelled
    // the moment a new effect fires, preventing stale setState calls.
    const controller = new AbortController()
    const { signal } = controller

    if (holdings.length === 0) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current)
        pollTimer.current = null
      }
      mockDataRef.current = {}
      setState({
        data: {},
        loading: false,
        error: null,
        lastFetchAt: null,
        usingMock: false,
        perTickerErrors: {},
      })
      return () => {
        controller.abort()
        if (pollTimer.current) clearInterval(pollTimer.current)
      }
    }

    // Preserve existing data during transitions — only mark loading, don't blank the chart
    setState(s => ({ ...s, loading: true }))

    // ── Historical (non-1D) branch ──────────────────────────────────────────
    if (timeRange !== '1D') {
      fetchHistorical(signal)
      pollTimer.current = setInterval(() => fetchHistorical(signal), HIST_REFRESH_MS)
      return () => {
        controller.abort()
        if (pollTimer.current) clearInterval(pollTimer.current)
      }
    }

    // ── Intraday (1D) branch ────────────────────────────────────────────────
    const exchanges = holdings.map(h => h.exchange)
    if (!shouldPoll(exchanges)) {
      // Markets closed — fetch completed session data for real closed-session lines;
      // fall back to animated mock only if the API yields nothing useful.
      ;(async () => {
        await fetchData(signal)
        if (signal.aborted) return
        setState(s => {
          if (Object.keys(s.data).length === 0 || s.usingMock) {
            initMock(signal)
            pollTimer.current = setInterval(tickMock, MOCK_TICK_MS)
          }
          return s
        })
      })()
      return () => {
        controller.abort()
        if (pollTimer.current) clearInterval(pollTimer.current)
      }
    }

    fetchData(signal)

    // Poll every 60s during market hours; switch to mock animation if markets close
    pollTimer.current = setInterval(() => {
      const exch = holdings.map(h => h.exchange)
      if (shouldPoll(exch)) {
        fetchData(signal)
      } else {
        if (pollTimer.current) clearInterval(pollTimer.current)
        initMock(signal)
        pollTimer.current = setInterval(tickMock, MOCK_TICK_MS)
      }
    }, POLL_INTERVAL_MS)

    return () => {
      controller.abort()
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [fetchData, fetchHistorical, initMock, tickMock, holdings, timeRange])

  return state
}
