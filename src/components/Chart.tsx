import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { Liveline } from 'liveline'
import type { LivelinePoint, LivelineSeries } from 'liveline'
import type { Exchange, Holding, SeriesData, Theme, TimeRange } from '../types'
import { computeDataDomain, computeSymmetricDomain } from '../utils/yAxis'
import './Chart.css'


const RANGE_WINDOW_SECS: Record<TimeRange, number> = {
  '1D': 13 * 3600,
  '1W': 7   * 86400,
  '1M': 30  * 86400,
  '3M': 91  * 86400,
  '1Y': 365 * 86400,
}

const WINDOW_ZOOM_LIMITS: Record<TimeRange, { min: number; max: number }> = {
  '1D': { min: 3_600,       max: 46_800       },
  '1W': { min: 86_400,      max: 7 * 86_400   },
  '1M': { min: 2 * 86_400,  max: 30 * 86_400  },
  '3M': { min: 7 * 86_400,  max: 91 * 86_400  },
  '1Y': { min: 30 * 86_400, max: 365 * 86_400 },
}

// Maximum seconds the user can pan back in time for each range
const MAX_PAN_SECS: Record<TimeRange, number> = {
  '1D': 46_800,
  '1W': 7   * 86_400,
  '1M': 30  * 86_400,
  '3M': 91  * 86_400,
  '1Y': 365 * 86_400,
}

interface Props {
  holdings: Holding[]
  seriesData: Record<string, SeriesData>
  focusedId: string | null
  theme: Theme
  onHoverTime?: (time: number | null) => void
  selectedExchange?: Exchange | null
  timeRange?: TimeRange
  loading?: boolean
}

// Zone colours — keep closed periods quiet so open market hours remain the focus
const OPEN_ZONE = 'rgba(34,197,94,0.055)'
const CLOSED_ZONE = 'rgba(239,68,68,0.022)'
const LIVELINE_RIGHT_BUFFER = 0.015

interface MarketZone {
  left: number  // 0–1 fraction of the chart area width
  width: number
  color: string
}

interface SessionMarker {
  /** 0–1 horizontal position within plot width (same basis as MarketZone.left) */
  left: number
}

const WINDOW_NO_TSE_H = 13  // 08:00–21:00
const WINDOW_TSE_H    = 21  // 00:00–21:00

interface ExchangeSession {
  timezone: string
  intervals: { openHour: number; openMinute: number; closeHour: number; closeMinute: number }[]
}

const EXCHANGE_SESSIONS: Record<Exchange, ExchangeSession> = {
  LSE: {
    timezone: 'Europe/London',
    intervals: [{ openHour: 8, openMinute: 0, closeHour: 16, closeMinute: 30 }],
  },
  US: {
    timezone: 'America/New_York',
    intervals: [{ openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 }],
  },
  TSE: {
    timezone: 'Asia/Tokyo',
    intervals: [
      { openHour: 9, openMinute: 0, closeHour: 11, closeMinute: 30 },
      { openHour: 12, openMinute: 30, closeHour: 15, closeMinute: 0 },
    ],
  },
}

interface ZonedDateParts {
  year: number
  month: number
  day: number
}

function getZonedDateParts(timeZone: string, date = new Date()): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  }
}

function addDays({ year, month, day }: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function zonedSessionTimestamp(
  timeZone: string,
  dateParts: ZonedDateParts,
  hour: number,
  minute: number,
): number {
  const utcGuess = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcGuess))

  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10)
  const zonedAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  const offsetMs = zonedAsUtc - utcGuess
  return (utcGuess - offsetMs) / 1000
}

function clipIntervalToWindow(start: number, end: number, leftEdge: number, rightEdge: number) {
  const clippedStart = Math.max(start, leftEdge)
  const clippedEnd = Math.min(end, rightEdge)
  return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : null
}

function getOpenIntervalsForExchange(exchange: Exchange, leftEdge: number, rightEdge: number) {
  const session = EXCHANGE_SESSIONS[exchange]
  const today = getZonedDateParts(session.timezone)
  const intervals: { start: number; end: number }[] = []

  for (const dayOffset of [-1, 0, 1]) {
    const dateParts = addDays(today, dayOffset)
    for (const interval of session.intervals) {
      const start = zonedSessionTimestamp(session.timezone, dateParts, interval.openHour, interval.openMinute)
      const end = zonedSessionTimestamp(session.timezone, dateParts, interval.closeHour, interval.closeMinute)
      const clipped = clipIntervalToWindow(start, end, leftEdge, rightEdge)
      if (clipped) intervals.push(clipped)
    }
  }

  return intervals
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function smoothNoisyIntradayPoints(points: LivelinePoint[]): LivelinePoint[] {
  if (points.length < 5) return points

  return points.map((point, idx) => {
    if (idx < 2 || idx > points.length - 3) return point

    const window = points.slice(idx - 2, idx + 3)
    const maxGap = Math.max(...window.slice(1).map((p, i) => p.time - window[i].time))
    if (maxGap > 4 * 60) return point

    const values = window.map(p => p.value)
    const localMedian = median(values)
    const localRange = Math.max(...values) - Math.min(...values)
    const deviation = Math.abs(point.value - localMedian)

    // Yahoo's 1m feed can alternate stale/auction prints for thin LSE names,
    // creating comb-like teeth. Only correct obvious local quote noise.
    if (localRange > 0.35 && deviation > 0.22) {
      return { ...point, value: localMedian }
    }

    return point
  })
}

/**
 * Liveline's multi-series path only draws when at least two points fall inside the visible
 * X window; bridge flat segments otherwise so thin venues (e.g. LSE) still render.
 */
function ensureDrawableInWindow(
  points: LivelinePoint[],
  leftEdge: number,
  rightEdge: number,
  liveSec: number,
): LivelinePoint[] {
  if (points.length === 0) return points
  const sorted = [...points].sort((a, b) => a.time - b.time)
  const right = Math.min(rightEdge, liveSec)
  const inWin = sorted.filter(p => p.time >= leftEdge - 2 && p.time <= right)

  if (inWin.length >= 2) return sorted

  if (inWin.length === 1) {
    const p = inWin[0]
    const carryEnd = right
    const carryStart = leftEdge + 2 * 60
    const t2 = p.time < carryEnd - 2 ? carryEnd : Math.min(p.time + 60, right)
    const extra = t2 > p.time
      ? { time: t2, value: p.value }
      : { time: carryStart, value: p.value }
    return [...sorted, extra].sort((a, b) => a.time - b.time)
  }

  const lastBefore = sorted.filter(p => p.time < leftEdge - 2).pop()
  const last = lastBefore ?? sorted[sorted.length - 1]
  const carryEnd = right
  const carryStart = leftEdge + 2 * 60
  const t1 = carryStart
  const t2 = carryEnd
  if (t2 <= t1) {
    return [...sorted, { time: t1, value: last.value }, { time: t1 + 1, value: last.value }].sort(
      (a, b) => a.time - b.time,
    )
  }
  return [...sorted, { time: t1, value: last.value }, { time: t2, value: last.value }].sort(
    (a, b) => a.time - b.time,
  )
}

function mergeIntervals(intervals: { start: number; end: number }[]) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []

  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }

  return merged
}


/**
 * Session shading ends at liveTimeSec (not in Liveline's future buffer strip).
 * plotRightEdge is the chart nominal right edge (now + buffer); percentages still
 * use (plotRightEdge - leftEdge) so X alignment matches Liveline.
 */
function computeZones(
  hasLSE: boolean,
  hasUS: boolean,
  hasTSE: boolean,
  selectedExchange: Exchange | null,
  leftEdge: number,
  plotRightEdge: number,
  liveTimeSec: number,
): MarketZone[] {
  if (!hasLSE && !hasUS && !hasTSE && !selectedExchange) return []

  const zoneEnd = Math.min(plotRightEdge, liveTimeSec)
  if (!(zoneEnd > leftEdge)) return []

  const activeExchanges: Exchange[] = selectedExchange
    ? [selectedExchange]
    : [
        ...(hasLSE ? (['LSE'] as const) : []),
        ...(hasUS  ? (['US'] as const)  : []),
        ...(hasTSE ? (['TSE'] as const) : []),
      ]

  const openIntervals = mergeIntervals(
    activeExchanges.flatMap(exchange => getOpenIntervalsForExchange(exchange, leftEdge, zoneEnd))
  )

  const segments: { start: number; end: number; open: boolean }[] = []
  let cursor = leftEdge

  for (const interval of openIntervals) {
    if (interval.start > cursor) {
      segments.push({ start: cursor, end: interval.start, open: false })
    }
    segments.push({ start: interval.start, end: interval.end, open: true })
    cursor = Math.max(cursor, interval.end)
  }

  if (cursor < zoneEnd) {
    segments.push({ start: cursor, end: zoneEnd, open: false })
  }

  const windowWidth = plotRightEdge - leftEdge
  return segments.map(s => ({
    left: (s.start - leftEdge) / windowWidth,
    width: (s.end - s.start) / windowWidth,
    color: s.open ? OPEN_ZONE : CLOSED_ZONE,
  }))
}

function computeSessionMarkers(
  hasLSE: boolean,
  hasUS: boolean,
  hasTSE: boolean,
  selectedExchange: Exchange | null,
  leftEdge: number,
  plotRightEdge: number,
  liveTimeSec: number,
): SessionMarker[] {
  if (!hasLSE && !hasUS && !hasTSE && !selectedExchange) return []

  const zoneEnd = Math.min(plotRightEdge, liveTimeSec)
  if (!(zoneEnd > leftEdge)) return []

  const activeExchanges: Exchange[] = selectedExchange
    ? [selectedExchange]
    : [
        ...(hasLSE ? (['LSE'] as const) : []),
        ...(hasUS  ? (['US'] as const)  : []),
        ...(hasTSE ? (['TSE'] as const) : []),
      ]

  const openIntervals = mergeIntervals(
    activeExchanges.flatMap(exchange => getOpenIntervalsForExchange(exchange, leftEdge, zoneEnd)),
  )

  const windowWidth = plotRightEdge - leftEdge
  const markers: SessionMarker[] = []

  for (const interval of openIntervals) {
    if (interval.start >= leftEdge && interval.start <= zoneEnd) {
      markers.push({
        left: (interval.start - leftEdge) / windowWidth,
      })
    }
  }

  return markers
}

export default function Chart({ holdings, seriesData, focusedId, theme, onHoverTime, selectedExchange, timeRange = '1D', loading = false }: Props) {
  const prevPcts = useRef<Record<string, number>>({})
  const [refLineGlow, setRefLineGlow] = useState(false)
  const [clockTick, setClockTick] = useState(() => Date.now())
  /** Cap zone shading at live time; rolling window still uses minute clockTick */
  const [zoneLiveMs, setZoneLiveMs] = useState(() => Date.now())

  // Interaction state — zoom overrides the default window; yDomainOverride pans the Y axis
  const containerRef = useRef<HTMLDivElement>(null)
  const [userWindowSecs, setUserWindowSecs] = useState<number | null>(null)
  const [yDomainOverride, setYDomainOverride] = useState<{ min: number; max: number } | null>(null)
  const [panOffsetMs, setPanOffsetMs] = useState(0)
  const dragStartY = useRef(0)
  const dragStartDomain = useRef({ min: 0, max: 0 })
  // Refs so drag/wheel callbacks always see fresh values without recreating
  const yDomainRef = useRef({ min: -1, max: 1 })
  const yDomainOverrideRef = useRef<{ min: number; max: number } | null>(null)
  const panOffsetMsRef = useRef(0)
  // Horizontal drag refs
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartYChartRef = useRef(0)
  const dragStartPanRef = useRef(0)
  const dragStartDomainMainRef = useRef({ min: 0, max: 0 })
  // Kept-fresh refs for pointer handlers (avoids stale closures in long-lived effects)
  const effectiveWindowSecsRef = useRef(0)
  const timeRangeRef = useRef<TimeRange>('1D')

  // Reset interaction overrides whenever the timeRange tab changes
  useEffect(() => {
    setUserWindowSecs(null)
    setYDomainOverride(null)
    setPanOffsetMs(0)
  }, [timeRange])

  // Detect zero crossings on new data
  useEffect(() => {
    let crossed = false
    for (const h of holdings) {
      const curr = seriesData[h.id]?.latestPct ?? 0
      const prev = prevPcts.current[h.id]
      if (prev !== undefined && Math.sign(curr) !== Math.sign(prev) && prev !== 0) {
        crossed = true
      }
      prevPcts.current[h.id] = curr
    }
    if (crossed) {
      setRefLineGlow(true)
      const t = setTimeout(() => setRefLineGlow(false), 1200)
      return () => clearTimeout(t)
    }
  }, [seriesData, holdings])

  // Keep the market-zone overlay aligned with Liveline's rolling time window.
  useEffect(() => {
    if (timeRange !== '1D') return
    const id = setInterval(() => setClockTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [timeRange])

  useEffect(() => {
    if (timeRange !== '1D') return
    const id = setInterval(() => setZoneLiveMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timeRange])

  const hasLSE = holdings.some(h => h.exchange === 'LSE')
  const hasUS  = holdings.some(h => h.exchange === 'US')
  const hasTSE = holdings.some(h => h.exchange === 'TSE')

  const isIntraday = timeRange === '1D'

  const useTSEWindow = isIntraday && (hasTSE || selectedExchange === 'TSE')
  const windowSecs = isIntraday
    ? (useTSEWindow ? WINDOW_TSE_H : WINDOW_NO_TSE_H) * 3600
    : RANGE_WINDOW_SECS[timeRange]

  const effectiveWindowSecs = userWindowSecs ?? windowSecs

  // Non-passive wheel + pointer drag listeners — synchronous, applied directly on every event
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const isOnYAxis = e.clientX > rect.right - 58  // 54px axis strip + 4px buffer

      if (isOnYAxis) {
        const rawDelta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
        const factor = Math.pow(1.06, rawDelta / 100)
        setYDomainOverride(prev => {
          const cur = prev ?? yDomainRef.current
          const mid = (cur.min + cur.max) / 2
          const span = Math.max(0.5, Math.min(200, (cur.max - cur.min) * factor))
          return { min: mid - span / 2, max: mid + span / 2 }
        })
        return
      }

      // Pinch gesture (ctrlKey on macOS) or mouse wheel — zoom the time window
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
      const sensitivity = e.ctrlKey ? 0.008 : 0.012
      const factor = Math.pow(2, rawDelta * sensitivity)
      setUserWindowSecs(prev => {
        const base = prev ?? windowSecs
        const { min, max } = WINDOW_ZOOM_LIMITS[timeRange]
        return Math.min(max, Math.max(min, base * factor))
      })
    }

    // Horizontal time pan + vertical Y translate on main plot area
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const rect = el.getBoundingClientRect()
      if (e.clientX > rect.right - 58) return  // Y-axis strip — handled by its own overlay
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      isDraggingRef.current = true
      dragStartXRef.current = e.clientX
      dragStartYChartRef.current = e.clientY
      dragStartPanRef.current = panOffsetMsRef.current
      dragStartDomainMainRef.current = yDomainOverrideRef.current ?? yDomainRef.current
      el.classList.add('liveline-container--dragging')
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!el.hasPointerCapture(e.pointerId) || !isDraggingRef.current) return
      const rect = el.getBoundingClientRect()
      const plotWidth = rect.width - 58  // exclude Y-axis strip

      // Horizontal: pan time — drag left scrolls back in time
      const deltaXPx = e.clientX - dragStartXRef.current
      const secsPerPx = effectiveWindowSecsRef.current / plotWidth
      const rawPan = dragStartPanRef.current - deltaXPx * secsPerPx * 1000
      const maxPan = MAX_PAN_SECS[timeRangeRef.current] * 1000
      const newPan = Math.max(0, Math.min(maxPan, rawPan))
      setPanOffsetMs(newPan)
      panOffsetMsRef.current = newPan

      // Vertical: translate Y domain — drag up shifts prices up, drag down shifts down
      const deltaYPx = e.clientY - dragStartYChartRef.current
      const { min, max } = dragStartDomainMainRef.current
      const span = max - min
      const chartH = rect.height
      const shift = -(deltaYPx / chartH) * span
      setYDomainOverride({ min: min + shift, max: max + shift })
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!el.hasPointerCapture(e.pointerId)) return
      el.releasePointerCapture(e.pointerId)
      isDraggingRef.current = false
      el.classList.remove('liveline-container--dragging')
      // Snap back to live edge if pan is negligibly small
      if (panOffsetMsRef.current < 2000) {
        setPanOffsetMs(0)
        panOffsetMsRef.current = 0
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [windowSecs, timeRange])

  // Double-click anywhere on the chart resets zoom, time pan and Y-axis pan
  const resetChartView = useCallback(() => {
    setUserWindowSecs(null)
    setYDomainOverride(null)
    setPanOffsetMs(0)
    panOffsetMsRef.current = 0
  }, [])

  const handleDoubleClick = useCallback(() => {
    resetChartView()
  }, [resetChartView])

  // Y-axis drag — pointer capture keeps tracking smooth even if cursor leaves the overlay
  const handleYAxisPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartY.current = e.clientY
    dragStartDomain.current = yDomainOverrideRef.current ?? yDomainRef.current
  }, [])

  const handleYAxisPointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const { min, max } = dragStartDomain.current
    const mid = (min + max) / 2
    const dy = e.clientY - dragStartY.current
    // Drag down = compress range (zoom in, finer increments); drag up = expand
    const factor = Math.pow(1.04, dy / 10)
    const span = Math.max(0.5, Math.min(200, (max - min) * factor))
    setYDomainOverride({ min: mid - span / 2, max: mid + span / 2 })
  }, [])

  const handleYAxisPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const visibleWindow = useMemo(() => {
    const nowSec = clockTick / 1000 - panOffsetMs / 1000
    const rightEdge = nowSec + effectiveWindowSecs * LIVELINE_RIGHT_BUFFER
    return {
      leftEdge: rightEdge - effectiveWindowSecs,
      rightEdge,
    }
  }, [clockTick, effectiveWindowSecs, panOffsetMs])

  // Build Liveline series array
  const series = useMemo((): LivelineSeries[] => {
    const leftEdge = visibleWindow.leftEdge
    const rightEdge = visibleWindow.rightEdge
    const zoneEnd = Math.min(rightEdge, zoneLiveMs / 1000)

    return holdings
      .filter(h => seriesData[h.id])
      .flatMap((h): LivelineSeries[] => {
        const d = seriesData[h.id]
        const rawData: LivelinePoint[] = d.points.map(p => ({
          time: p.time,
          value: p.value,
        }))
        let data = timeRange === '1D' ? smoothNoisyIntradayPoints(rawData) : rawData
        if (timeRange === '1D') {
          data = ensureDrawableInWindow(data, leftEdge, rightEdge, zoneLiveMs / 1000)
        }

        const isDimmedByFocus = focusedId !== null && focusedId !== h.id
        const isFocused      = focusedId !== null && focusedId === h.id

        const color     = isDimmedByFocus ? hexToRgba(h.color, 0.07) : h.color
        const thickness = h.lineThickness ?? 2
        const lineWidth = focusedId === null
          ? thickness
          : isFocused ? Math.min(4, thickness + 1) : 1

        const gradientStops = !isDimmedByFocus && h.gradientColors?.length
          ? [h.color, ...h.gradientColors]
          : undefined

        // liveline's session-aware renderer (renderCurveWithSessions) uses a plain
        // strokeStyle string and ignores gradientStops entirely. Skip sessions for
        // gradient lines so renderCurve handles the stroke instead.
        let sessions: { start: number; end: number }[] | undefined
        if (!gradientStops && timeRange === '1D' && zoneEnd > leftEdge) {
          sessions = mergeIntervals(getOpenIntervalsForExchange(h.exchange, leftEdge, zoneEnd))
        }

        return [
          {
            id: h.id,
            data,
            value: d.latestPct,
            color,
            label: h.ticker,
            extendToNow: true,
            linear: false,
            lineWidth,
            lineStyle: h.lineStyle ?? 'solid',
            ...(gradientStops ? { gradientStops } : {}),
            ...(timeRange === '1D' && sessions != null ? { sessions } : {}),
          },
        ]
      })
  }, [
    holdings,
    seriesData,
    focusedId,
    timeRange,
    clockTick,
    visibleWindow.leftEdge,
    visibleWindow.rightEdge,
    zoneLiveMs,
  ])

  // Compute symmetric ±B% domain from all intraday points (single visible series)
  const yDomain = useMemo(() => {
    const allPcts = holdings.flatMap(h => {
      const pts = (seriesData[h.id]?.points ?? []).map(p => ({ time: p.time, value: p.value }))
      const smoothed = timeRange === '1D' ? smoothNoisyIntradayPoints(pts) : pts
      const vals = smoothed.map(p => p.value)
      if (timeRange === '1D' && vals.length > 0) return [0, ...vals]
      return vals
    })
    return timeRange === '1D'
      ? computeSymmetricDomain(allPcts)
      : computeDataDomain(allPcts)
  }, [holdings, seriesData, timeRange])

  // Keep refs fresh so drag/wheel callbacks always see current values without stale closures
  yDomainRef.current = yDomain
  yDomainOverrideRef.current = yDomainOverride
  panOffsetMsRef.current = panOffsetMs
  effectiveWindowSecsRef.current = effectiveWindowSecs
  timeRangeRef.current = timeRange

  const hasData = series.some(s => s.data.length > 0)

  const zones = useMemo(
    () =>
      isIntraday
        ? computeZones(
            hasLSE,
            hasUS,
            hasTSE,
            selectedExchange ?? null,
            visibleWindow.leftEdge,
            visibleWindow.rightEdge,
            zoneLiveMs / 1000,
          )
        : [],
    [isIntraday, hasLSE, hasUS, hasTSE, selectedExchange, visibleWindow, zoneLiveMs],
  )

  const sessionMarkers = useMemo(
    () =>
      isIntraday
        ? computeSessionMarkers(
            hasLSE,
            hasUS,
            hasTSE,
            selectedExchange ?? null,
            visibleWindow.leftEdge,
            visibleWindow.rightEdge,
            zoneLiveMs / 1000,
          )
        : [],
    [isIntraday, hasLSE, hasUS, hasTSE, selectedExchange, visibleWindow, zoneLiveMs],
  )

  // Replicate Liveline's internal labelReserve calculation so the zone overlay
  // stays aligned with the actual chart plotting area.
  // Liveline uses: chartW = w - pad.left - pad.right - labelReserve
  // where labelReserve = Math.max(0, maxLabelWidth - 2).
  // Our zone layer's right edge must shrink by the same amount.
  const labelReserve = useMemo(() => {
    const labels = series.map(s => s.label).filter((l): l is string => Boolean(l))
    if (labels.length === 0 || typeof document === 'undefined') return 0
    const cnv = document.createElement('canvas')
    const ctx = cnv.getContext('2d')
    if (!ctx) return 0
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    let maxW = 0
    for (const label of labels) {
      const w = ctx.measureText(label).width
      if (w > maxW) maxW = w
    }
    return Math.max(0, maxW - 2)
  }, [series])

  const formatTime = useMemo(() => {
    const DAY  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const MON  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    switch (timeRange) {
      case '1D':
        return (t: number) => {
          if (selectedExchange != null) {
            const parts = new Intl.DateTimeFormat('en-GB', {
              timeZone: EXCHANGE_SESSIONS[selectedExchange].timezone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).formatToParts(new Date(t * 1000))
            const part = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
            return `${part('hour')}:${part('minute')}`
          }
          const d = new Date(t * 1000)
          return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
        }
      case '1W':
        return (t: number) => {
          const d = new Date(t * 1000)
          return `${DAY[d.getDay()]} ${d.getDate()}`
        }
      case '1M':
      case '3M':
        return (t: number) => {
          const d = new Date(t * 1000)
          return `${d.getDate()} ${MON[d.getMonth()]}`
        }
      case '1Y':
        return (t: number) => {
          const d = new Date(t * 1000)
          return `${MON[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
        }
    }
  }, [timeRange, selectedExchange])

  const isEmpty = holdings.length === 0
  const showResetView =
    !isEmpty && (userWindowSecs != null || yDomainOverride != null || panOffsetMs !== 0)

  return (
    <div className="chart-wrapper" onDoubleClick={handleDoubleClick}>
      <div className={`ref-line-glow ${refLineGlow ? 'active' : ''}`} />
      {isEmpty && (
        <div className="chart-empty-state" aria-live="polite">
          <p className="chart-empty-state__title">No tickers yet</p>
          <p className="chart-empty-state__hint">
            Add a symbol using <span className="chart-empty-state__kbd">Add ticker…</span> at the
            bottom right.
          </p>
        </div>
      )}
      <div
        ref={containerRef}
        className={`liveline-container${loading && hasData ? ' liveline-container--loading' : ''}${isEmpty ? ' liveline-container--empty' : ''}`}
      >
        <Liveline
          data={[]}
          value={0}
          series={panOffsetMs > 0 ? series.map(s => ({ ...s, extendToNow: false })) : series}
          theme={theme}
          referenceLine={{ value: 0 }}
          formatValue={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
          formatTime={formatTime}
          window={effectiveWindowSecs}
          nowOffset={panOffsetMs / 1000}
          grid
          scrub
          pulse={isIntraday && panOffsetMs === 0}
          loading={false}
          onHover={pt => onHoverTime?.(pt ? pt.time : null)}
          badge={false}
          fill={false}
          momentum={false}
          showSeriesChips={false}
          yDomain={yDomainOverride ?? yDomain}
          lerpSpeed={isIntraday ? 0.04 : 0.8}
          style={{ height: '100%', width: '100%' }}
        />
        {zones.length > 0 && (
          <div
            className="market-zones-layer"
            style={{ right: `${54 + Math.round(labelReserve)}px` }}
          >
            {zones.map((z, i) => (
              <div
                key={i}
                className="market-zone"
                style={{
                  left:            `${(z.left  * 100).toFixed(4)}%`,
                  width:           `${(z.width * 100).toFixed(4)}%`,
                  background:      z.color,
                }}
              />
            ))}
            {sessionMarkers.map((m, i) => (
              <div
                key={`session-open-${i}-${m.left.toFixed(6)}`}
                className="market-session-marker"
                style={{ left: `${(m.left * 100).toFixed(4)}%` }}
              />
            ))}
          </div>
        )}
        {/* Y-axis drag overlay — covers Liveline's right-hand axis strip */}
        <div
          className="y-axis-drag-overlay"
          onPointerDown={handleYAxisPointerDown}
          onPointerMove={handleYAxisPointerMove}
          onPointerUp={handleYAxisPointerUp}
        />
      </div>
      {showResetView && (
        <button
          type="button"
          className="chart-reset-view"
          onClick={e => {
            e.stopPropagation()
            resetChartView()
          }}
          aria-label="Reset chart zoom and vertical scale"
          title="Reset zoom to default view (double-click chart also works)"
        >
          <svg className="chart-reset-view__icon" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  // Handle shorthand hex
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex
  const r = parseInt(full.slice(1, 3), 16)
  const g = parseInt(full.slice(3, 5), 16)
  const b = parseInt(full.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
