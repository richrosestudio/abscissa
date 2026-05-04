import { useMemo, useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Liveline } from 'liveline'
import type { LivelinePoint, LivelineSeries } from 'liveline'
import type { Exchange, Holding, SeriesData, Theme, TimeRange } from '../types'
import { detectExchange } from '../utils/exchange'
import { computeDataDomain } from '../utils/yAxis'
import './Chart.css'


const RANGE_WINDOW_SECS: Record<TimeRange, number> = {
  '1D': 13 * 3600,
  '1W': 7   * 86400,
  '1M': 30  * 86400,
  '3M': 91  * 86400,
  '1Y': 365 * 86400,
}

const WINDOW_ZOOM_LIMITS: Record<TimeRange, { min: number; max: number }> = {
  '1D': { min: 3_600,       max: 32_400       },
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
  /** Toggle line focus (same behaviour as bottom-strip chip). */
  onFocusLine?: (id: string) => void
  /** Clear focus when the user clicks the plot without hitting a line. */
  onClearLineFocus?: () => void
  selectedExchange?: Exchange | null
  timeRange?: TimeRange
  loading?: boolean
  /** Fires when chart zoom / pan / Y-override state changes so UI can enable a reset control. */
  onCanResetChange?: (canReset: boolean) => void
}

export interface ChartRef {
  resetView: () => void
}

// Zone colours — open: solid green tint; closed: warm red gradient (Fear & Greed bar red #ef4444)
const OPEN_ZONE = 'rgba(34,197,94,0.055)'
const CLOSED_ZONE_BG =
  'linear-gradient(90deg, rgba(239,68,68,0.04) 0%, rgba(239,68,68,0.078) 45%, rgba(239,68,68,0.068) 55%, rgba(239,68,68,0.04) 100%)'
/** When merged session interval ends flush with the live cap, end was clipped — not a real session close. */
const SESSION_CLOSE_MARKER_MIN_GAP_SEC = 90
/** ~2px at ~650px plot: venue cash times aligned within this fraction collapse to one tick. */
const SESSION_MARKER_DEDUPE_FRAC = 0.0032
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

const WINDOW_NO_TSE_H = 9   // covers pre-market open through mid-session
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

/** Liveline default padding when `grid` is on and no `padding` override. */
const LIVELINE_PAD = { top: 12, left: 12, bottom: 28, right: 54 } as const
const LINE_HIT_MAX_DIST_PX = 16
const LINE_HIT_DRAG_THRESHOLD_PX = 6

function interpolatedValueAtTime(points: LivelinePoint[], t: number): number | null {
  if (points.length === 0) return null
  const sorted =
    points.length < 2 || points[0].time <= points[1].time ? points : [...points].sort((a, b) => a.time - b.time)
  if (t <= sorted[0].time) return sorted[0].value
  const lastPt = sorted[sorted.length - 1]
  if (t >= lastPt.time) return lastPt.value
  let i = 0
  while (i < sorted.length - 1 && sorted[i + 1].time < t) i++
  const a = sorted[i]
  const b = sorted[i + 1]
  if (!b || b.time === a.time) return a.value
  const u = (t - a.time) / (b.time - a.time)
  return a.value + u * (b.value - a.value)
}

interface LinePickContext {
  plotSeries: LivelineSeries[]
  leftEdge: number
  rightEdge: number
  labelReserve: number
  minVal: number
  maxVal: number
  onFocusLine?: (id: string) => void
}

function pickSeriesIdAtClientPixel(
  clientX: number,
  clientY: number,
  rect: DOMRectReadOnly,
  ctx: LinePickContext,
): string | null {
  const pad = LIVELINE_PAD
  const w = rect.width
  const h = rect.height
  const chartW = w - pad.left - pad.right - ctx.labelReserve
  const chartH = h - pad.top - pad.bottom
  if (chartW <= 1 || chartH <= 1) return null

  const x = clientX - rect.left
  const y = clientY - rect.top
  if (x < pad.left || x > pad.left + chartW) return null
  if (y < pad.top || y > h - pad.bottom) return null

  const { leftEdge, rightEdge, minVal, maxVal } = ctx
  const spanT = rightEdge - leftEdge
  if (!(spanT > 0)) return null
  const valRange = Math.max(1e-9, maxVal - minVal)
  const t = leftEdge + ((x - pad.left) / chartW) * spanT

  let bestId: string | null = null
  let bestDist = LINE_HIT_MAX_DIST_PX + 1

  for (const s of ctx.plotSeries) {
    if (s.data.length < 2) continue
    const visible = s.data.filter(p => p.time >= leftEdge - 2 && p.time <= rightEdge)
    if (visible.length < 2) continue
    const val = interpolatedValueAtTime(visible, t)
    if (val == null) continue
    const yLine = pad.top + (1 - (val - minVal) / valRange) * chartH
    const d = Math.abs(y - yLine)
    if (d < bestDist) {
      bestDist = d
      bestId = s.id
    }
  }

  return bestId
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
    color: s.open ? OPEN_ZONE : CLOSED_ZONE_BG,
  }))
}

function getActiveExchangesForSessionUI(
  hasLSE: boolean,
  hasUS: boolean,
  hasTSE: boolean,
  selectedExchange: Exchange | null,
): Exchange[] {
  if (selectedExchange) return [selectedExchange]
  return [
    ...(hasLSE ? (['LSE'] as const) : []),
    ...(hasUS ? (['US'] as const) : []),
    ...(hasTSE ? (['TSE'] as const) : []),
  ]
}

function dedupeMarkerFractions(fractions: number[], eps: number): SessionMarker[] {
  if (fractions.length === 0) return []
  const sorted = [...fractions].sort((a, b) => a - b)
  const uniq: number[] = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i]!
    if (v - uniq[uniq.length - 1]! >= eps) uniq.push(v)
  }
  return uniq.map(left => ({ left }))
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
  const activeExchanges = getActiveExchangesForSessionUI(hasLSE, hasUS, hasTSE, selectedExchange)
  if (activeExchanges.length === 0) return []

  const zoneEnd = Math.min(plotRightEdge, liveTimeSec)
  if (!(zoneEnd > leftEdge)) return []

  const windowWidth = plotRightEdge - leftEdge
  const fracs: number[] = []

  for (const exchange of activeExchanges) {
    for (const interval of getOpenIntervalsForExchange(exchange, leftEdge, zoneEnd)) {
      if (interval.start >= leftEdge && interval.start <= zoneEnd) {
        fracs.push((interval.start - leftEdge) / windowWidth)
      }
    }
  }

  return dedupeMarkerFractions(fracs, SESSION_MARKER_DEDUPE_FRAC)
}

function computeSessionCloseMarkers(
  hasLSE: boolean,
  hasUS: boolean,
  hasTSE: boolean,
  selectedExchange: Exchange | null,
  leftEdge: number,
  plotRightEdge: number,
  liveTimeSec: number,
): SessionMarker[] {
  const activeExchanges = getActiveExchangesForSessionUI(hasLSE, hasUS, hasTSE, selectedExchange)
  if (activeExchanges.length === 0) return []

  const zoneEnd = Math.min(plotRightEdge, liveTimeSec)
  if (!(zoneEnd > leftEdge)) return []

  const windowWidth = plotRightEdge - leftEdge
  const fracs: number[] = []

  for (const exchange of activeExchanges) {
    for (const interval of getOpenIntervalsForExchange(exchange, leftEdge, zoneEnd)) {
      if (zoneEnd - interval.end < SESSION_CLOSE_MARKER_MIN_GAP_SEC) continue
      if (interval.end >= leftEdge && interval.end <= zoneEnd) {
        fracs.push((interval.end - leftEdge) / windowWidth)
      }
    }
  }

  return dedupeMarkerFractions(fracs, SESSION_MARKER_DEDUPE_FRAC)
}

const Chart = forwardRef<ChartRef, Props>(function Chart(
  {
    holdings,
    seriesData,
    focusedId,
    theme,
    onHoverTime,
    onFocusLine,
    onClearLineFocus,
    selectedExchange,
    timeRange = '1D',
    loading = false,
    onCanResetChange,
  },
  ref,
) {
  const linePickRef = useRef<LinePickContext | null>(null)
  const pointerGestureStartRef = useRef({ x: 0, y: 0 })
  const dragExceededThresholdRef = useRef(false)
  const prevPcts = useRef<Record<string, number>>({})
  const focusedIdRef = useRef<string | null>(null)
  const onClearLineFocusRef = useRef<(() => void) | undefined>(undefined)
  focusedIdRef.current = focusedId
  onClearLineFocusRef.current = onClearLineFocus

  const [chartHintDismissed, setChartHintDismissed] = useState(
    () =>
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem('abx_chart_hint_v1') === '1',
  )

  const dismissChartHint = useCallback(() => {
    sessionStorage.setItem('abx_chart_hint_v1', '1')
    setChartHintDismissed(true)
  }, [])
  const [refLineGlow, setRefLineGlow] = useState(false)
  /** Drives visibleWindow + zone/session alignment with Liveline (1s tick in 1D). */
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

  useEffect(() => {
    if (timeRange !== '1D') return
    const id = setInterval(() => setZoneLiveMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timeRange])

  const hasLSE = holdings.some(h => detectExchange(h.id) === 'LSE')
  const hasUS  = holdings.some(h => detectExchange(h.id) === 'US')
  const hasTSE = holdings.some(h => detectExchange(h.id) === 'TSE')

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
      pointerGestureStartRef.current = { x: e.clientX, y: e.clientY }
      dragExceededThresholdRef.current = false
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      isDraggingRef.current = true
      el.classList.add('liveline-container--dragging')
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!el.hasPointerCapture(e.pointerId) || !isDraggingRef.current) return
      const rect = el.getBoundingClientRect()
      const plotWidth = rect.width - 58  // exclude Y-axis strip

      const sx = pointerGestureStartRef.current.x
      const sy = pointerGestureStartRef.current.y
      const dist = Math.hypot(e.clientX - sx, e.clientY - sy)
      if (!dragExceededThresholdRef.current) {
        if (dist < LINE_HIT_DRAG_THRESHOLD_PX) return
        dragExceededThresholdRef.current = true
        dragStartXRef.current = sx
        dragStartYChartRef.current = sy
        dragStartPanRef.current = panOffsetMsRef.current
        dragStartDomainMainRef.current = yDomainOverrideRef.current ?? yDomainRef.current
      }

      const deltaXPx = e.clientX - dragStartXRef.current
      const secsPerPx = effectiveWindowSecsRef.current / plotWidth
      const rawPan = dragStartPanRef.current - deltaXPx * secsPerPx * 1000
      const maxPan = MAX_PAN_SECS[timeRangeRef.current] * 1000
      const newPan = Math.max(0, Math.min(maxPan, rawPan))
      setPanOffsetMs(newPan)
      panOffsetMsRef.current = newPan

      const deltaYPx = e.clientY - dragStartYChartRef.current
      const { min, max } = dragStartDomainMainRef.current
      const span = max - min
      const chartH = rect.height
      const shift = -(deltaYPx / chartH) * span
      setYDomainOverride({ min: min + shift, max: max + shift })
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!el.hasPointerCapture(e.pointerId)) return
      const wasClick = isDraggingRef.current && !dragExceededThresholdRef.current
      el.releasePointerCapture(e.pointerId)
      isDraggingRef.current = false
      el.classList.remove('liveline-container--dragging')
      if (panOffsetMsRef.current < 2000) {
        setPanOffsetMs(0)
        panOffsetMsRef.current = 0
      }
      if (wasClick && e.button === 0) {
        const rect = el.getBoundingClientRect()
        if (e.clientX <= rect.right - 58) {
          const ctx = linePickRef.current
          const id = ctx
            ? pickSeriesIdAtClientPixel(e.clientX, e.clientY, rect, ctx)
            : null
          if (id && ctx?.onFocusLine) {
            ctx.onFocusLine(id)
          } else if (!id && focusedIdRef.current != null) {
            onClearLineFocusRef.current?.()
          }
        }
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

  useImperativeHandle(ref, () => ({ resetView: resetChartView }), [resetChartView])

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
    const nowSec = zoneLiveMs / 1000 - panOffsetMs / 1000
    const rightEdge = nowSec + effectiveWindowSecs * LIVELINE_RIGHT_BUFFER
    return {
      leftEdge: rightEdge - effectiveWindowSecs,
      rightEdge,
    }
  }, [zoneLiveMs, effectiveWindowSecs, panOffsetMs])

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

        const rawColor  = isDimmedByFocus ? hexToRgba(h.color, 0.07) : h.color
        const color     = !isDimmedByFocus && h.lineOpacity != null && h.lineOpacity < 1
          ? hexToRgba(h.color, h.lineOpacity)
          : rawColor
        const thickness = h.lineThickness ?? 2
        const lineWidth = focusedId === null
          ? thickness
          : isFocused ? Math.min(4, thickness + 1) : 1

        // On 1D, always use solid color + sessions so every line fades outside its exchange hours.
        // Liveline's session-aware renderer (renderCurveWithSessions) uses a plain strokeStyle
        // and cannot combine with gradientStops; strip chip swatches read h.gradientColors directly.
        const gradientStops =
          timeRange !== '1D' && !isDimmedByFocus && h.gradientColors?.length
            ? [h.color, ...h.gradientColors]
            : undefined

        let sessions: { start: number; end: number }[] | undefined
        if (timeRange === '1D' && zoneEnd > leftEdge) {
          // When a header clock filter is active, match zone shading (single venue). Otherwise
          // each line uses its listing venue from the ticker id (suffix), not stored exchange — so
          // LSE names still fade with US hours when viewing "New York" only.
          const exchangeForSessions: Exchange = selectedExchange ?? detectExchange(h.id)
          sessions = mergeIntervals(
            getOpenIntervalsForExchange(exchangeForSessions, leftEdge, zoneEnd),
          )
        }

        return [
          {
            id: h.id,
            data,
            value: d.latestPct,
            color,
            label: h.ticker,
            extendToNow: true,
            linear: h.linear ?? false,
            lineWidth,
            lineStyle: h.lineStyle ?? 'solid',
            ...(gradientStops ? { gradientStops } : {}),
            ...(timeRange === '1D' && sessions != null ? { sessions } : {}),
            ...(h.dotColor != null ? { dotColor: h.dotColor } : {}),
          },
        ]
      })
  }, [
    holdings,
    seriesData,
    focusedId,
    timeRange,
    visibleWindow.leftEdge,
    visibleWindow.rightEdge,
    zoneLiveMs,
    selectedExchange,
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
    return computeDataDomain(allPcts)
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

  const sessionCloseMarkers = useMemo(
    () =>
      isIntraday
        ? computeSessionCloseMarkers(
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
    const fromSeries = series.map(s => s.label).filter((l): l is string => Boolean(l))
    const labels =
      fromSeries.length > 0 ? fromSeries : holdings.map(h => h.ticker).filter(Boolean)
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
  }, [series, holdings])

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

  useEffect(() => {
    const can =
      holdings.length > 0 &&
      (userWindowSecs != null || yDomainOverride != null || panOffsetMs !== 0)
    onCanResetChange?.(can)
  }, [holdings.length, userWindowSecs, yDomainOverride, panOffsetMs, onCanResetChange])

  linePickRef.current = {
    plotSeries: panOffsetMs > 0 ? series.map(s => ({ ...s, extendToNow: false })) : series,
    leftEdge: visibleWindow.leftEdge,
    rightEdge: visibleWindow.rightEdge,
    labelReserve,
    minVal: (yDomainOverride ?? yDomain).min,
    maxVal: (yDomainOverride ?? yDomain).max,
    onFocusLine,
  }

  return (
    <div className="chart-wrapper" onDoubleClick={handleDoubleClick}>
      <div className={`ref-line-glow ${refLineGlow ? 'active' : ''}`} />
      {!chartHintDismissed && !isEmpty && hasData && isIntraday && (
        <div className="chart-hint" role="note">
          <span className="chart-hint-text">
            Drag to pan time · wheel zooms · double-click resets
          </span>
          <button
            type="button"
            className="chart-hint-close"
            onClick={dismissChartHint}
            aria-label="Dismiss chart tips"
          >
            ×
          </button>
        </div>
      )}
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
            {sessionCloseMarkers.map((m, i) => (
              <div
                key={`session-close-${i}-${m.left.toFixed(6)}`}
                className="market-session-close-marker"
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
    </div>
  )
})

export default Chart

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
