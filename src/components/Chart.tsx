import { useMemo, useRef, useEffect, useState } from 'react'
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

function getActiveExchanges(
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

function getMergedOpenIntervals(
  activeExchanges: Exchange[],
  leftEdge: number,
  rightClip: number,
): { start: number; end: number }[] {
  if (activeExchanges.length === 0) return []
  return mergeIntervals(
    activeExchanges.flatMap(ex => getOpenIntervalsForExchange(ex, leftEdge, rightClip)),
  )
}

function timeInOpenSession(t: number, merged: { start: number; end: number }[]): boolean {
  return merged.some(({ start, end }) => t >= start && t < end)
}

/**
 * Split points into runs matching open vs closed session bands (same geometry as zone overlay).
 * Bridges segment boundaries with a duplicated point so Liveline draws a continuous path.
 */
function splitSeriesByOpenZones(
  points: LivelinePoint[],
  mergedOpen: { start: number; end: number }[],
): { points: LivelinePoint[]; inOpen: boolean }[] {
  if (points.length === 0) return []

  const runs: { points: LivelinePoint[]; inOpen: boolean }[] = []
  let bucket: LivelinePoint[] = []
  let prevOpen: boolean | null = null

  for (const p of points) {
    const open = timeInOpenSession(p.time, mergedOpen)
    if (prevOpen !== null && open !== prevOpen && bucket.length > 0) {
      if (bucket.length >= 2) runs.push({ points: bucket, inOpen: prevOpen })
      const last = bucket[bucket.length - 1]
      bucket = [last, p]
    } else {
      bucket.push(p)
    }
    prevOpen = open
  }

  if (bucket.length >= 2 && prevOpen !== null) {
    runs.push({ points: bucket, inOpen: prevOpen })
  } else if (bucket.length === 1 && prevOpen !== null && runs.length > 0) {
    const br = runs[runs.length - 1]
    const bridge = br.points[br.points.length - 1]
    runs.push({ points: [bridge, bucket[0]], inOpen: prevOpen })
  }

  if (runs.length === 0 && points.length >= 2 && prevOpen !== null) {
    runs.push({ points, inOpen: prevOpen })
  }

  return runs.filter(r => r.points.length >= 2)
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

export default function Chart({ holdings, seriesData, focusedId, theme, onHoverTime, selectedExchange, timeRange = '1D', loading = false }: Props) {
  const prevPcts = useRef<Record<string, number>>({})
  const [refLineGlow, setRefLineGlow] = useState(false)
  const [clockTick, setClockTick] = useState(() => Date.now())
  /** Cap zone shading at live time; rolling window still uses minute clockTick */
  const [zoneLiveMs, setZoneLiveMs] = useState(() => Date.now())

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

  const visibleWindow = useMemo(() => {
    const rightEdge = clockTick / 1000 + windowSecs * LIVELINE_RIGHT_BUFFER
    return {
      leftEdge: rightEdge - windowSecs,
      rightEdge,
    }
  }, [clockTick, windowSecs])

  // Build Liveline series array
  const series = useMemo((): LivelineSeries[] => {
    const leftEdge = visibleWindow.leftEdge
    const plotRightEdge = visibleWindow.rightEdge
    const liveSec = zoneLiveMs / 1000
    const zoneEnd = Math.min(plotRightEdge, liveSec)

    const activeExchanges = getActiveExchanges(hasLSE, hasUS, hasTSE, selectedExchange ?? null)
    const mergedOpen =
      timeRange === '1D' && activeExchanges.length > 0
        ? getMergedOpenIntervals(activeExchanges, leftEdge, zoneEnd)
        : []

    return holdings
      .filter(h => seriesData[h.id])
      .flatMap(h => {
        const d = seriesData[h.id]
        const rawData: LivelinePoint[] = d.points.map(p => ({
          time: p.time,
          value: p.value,
        }))
        let data = timeRange === '1D' ? smoothNoisyIntradayPoints(rawData) : rawData

        const isDimmedByFocus = focusedId !== null && focusedId !== h.id

        if (timeRange === '1D' && data.length > 0 && data[0].time > leftEdge) {
          data = [{ time: leftEdge, value: 0 }, ...data]
        }

        if (timeRange !== '1D') {
          const color = isDimmedByFocus ? hexToRgba(h.color, 0.15) : h.color
          return [{ id: h.id, data, value: d.latestPct, color, label: h.ticker, extendToNow: true }]
        }

        const runs = splitSeriesByOpenZones(data, mergedOpen)
        if (runs.length === 0) return []

        return runs.map((run, i) => {
          const isLast = i === runs.length - 1
          const base = run.inOpen ? h.color : hexToRgba(h.color, 0.25)
          const color = isDimmedByFocus ? hexToRgba(h.color, 0.12) : base

          return {
            id: `${h.id}:${i}`,
            data: run.points,
            value: d.latestPct,
            color,
            label: isLast ? h.ticker : undefined,
            extendToNow: isLast,
          }
        })
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
    selectedExchange,
    hasLSE,
    hasUS,
    hasTSE,
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

  return (
    <div className="chart-wrapper">
      <div className={`ref-line-glow ${refLineGlow ? 'active' : ''}`} />
      <div className={`liveline-container${loading && hasData ? ' liveline-container--loading' : ''}`}>
        <Liveline
          data={[]}
          value={0}
          series={series}
          theme={theme}
          referenceLine={{ value: 0 }}
          formatValue={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
          formatTime={formatTime}
          window={windowSecs}
          grid
          scrub
          pulse={isIntraday}
          loading={false}
          onHover={pt => onHoverTime?.(pt ? pt.time : null)}
          badge={false}
          fill={false}
          momentum={false}
          showSeriesChips={false}
          yDomain={yDomain}
          lerpSpeed={isIntraday ? 0.04 : 1}
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
          </div>
        )}
      </div>
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
