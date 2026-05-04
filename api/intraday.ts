import type { VercelRequest, VercelResponse } from '@vercel/node'
import YahooFinance from 'yahoo-finance2'
import { parseSymbolsParam, logServerError } from './_security.js'

/** Minimal chart payload — yahoo-finance2 can type chart() as `unknown` under strict NodeNext builds (e.g. Vercel). */
interface YahooChartPayload {
  quotes?: unknown[]
  meta?: {
    previousClose?: number | null
    chartPreviousClose?: number | null
    regularMarketPrice?: number | null
    currency?: string
  }
}

// yahoo-finance2 v3 requires instantiation
const yahooFinance = new YahooFinance()

export interface IntradayPoint {
  t: number   // unix seconds
  pct: number // % change from session open
}

export interface SeriesMeta {
  exchange: Exchange
  openTime: number  // unix seconds when session opened
  currency: string
  openPrice: number // session open price in native currency
}

export interface IntradayResponse {
  series: Record<string, { points: IntradayPoint[]; meta: SeriesMeta } | { error: string }>
  fetchedAt: number
}

type Exchange = 'LSE' | 'US' | 'TSE'

interface ZonedDateParts {
  year: number
  month: number
  day: number
}

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

function detectExchange(symbol: string): Exchange {
  if (symbol.endsWith('.L')) return 'LSE'
  if (symbol.endsWith('.T')) return 'TSE'
  return 'US'
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
  return (utcGuess - (zonedAsUtc - utcGuess)) / 1000
}

function getSessionIntervals(exchange: Exchange, date = new Date()) {
  const session = EXCHANGE_SESSIONS[exchange]
  const today = getZonedDateParts(session.timezone, date)

  return [-1, 0, 1].flatMap(dayOffset => {
    const dateParts = addDays(today, dayOffset)
    return session.intervals.map(interval => ({
      start: zonedSessionTimestamp(session.timezone, dateParts, interval.openHour, interval.openMinute),
      end: zonedSessionTimestamp(session.timezone, dateParts, interval.closeHour, interval.closeMinute),
    }))
  })
}

function isInRegularSession(exchange: Exchange, time: number): boolean {
  return getSessionIntervals(exchange, new Date(time * 1000)).some(({ start, end }) => time >= start && time < end)
}

/** Pre/post + RTH window in each market's local time (minute-of-day), inclusive end. */
const EXTENDED_BAND: Record<Exchange, { startMin: number; endMin: number }> = {
  US: { startMin: 4 * 60, endMin: 20 * 60 + 59 },
  LSE: { startMin: 0, endMin: 21 * 60 + 59 },
  TSE: { startMin: 7 * 60 + 30, endMin: 18 * 60 + 29 },
}

function isInExtendedChartWindow(exchange: Exchange, unixSec: number): boolean {
  const session = EXCHANGE_SESSIONS[exchange]
  const { startMin, endMin } = EXTENDED_BAND[exchange]
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: session.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unixSec * 1000))
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  const mins = h * 60 + m
  return mins >= startMin && mins <= endMin
}

function quoteTimestamp(q: { date?: Date | number | string }): number {
  if (q.date instanceof Date) return Math.floor(q.date.getTime() / 1000)
  if (typeof q.date === 'string') {
    const ms = Date.parse(q.date)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN
  }
  const n = Number(q.date)
  if (!Number.isFinite(n)) return NaN
  if (n > 1e12) return Math.floor(n / 1000)
  return Math.floor(n)
}

function firstPositivePrice(q: {
  close?: number | null
  open?: number | null
  low?: number | null
  high?: number | null
}): number | null {
  for (const k of ['close', 'open', 'low', 'high'] as const) {
    const v = q[k]
    if (v != null && Number.isFinite(v) && v > 0) return v
  }
  return null
}

/**
 * GET /api/intraday?symbols=AAPL,TSLA,VOD.L
 *
 * Returns intraday % change for each symbol (pre/post from Yahoo includePrePost).
 * Before the regular session opens, points are % vs previous close (or first tick if missing).
 * After the open, RTH bars are % vs session open; earlier extended-hours bars stay % vs prior close.
 * All Yahoo Finance calls are server-side only — never from the browser.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const raw = req.query['symbols']
  const symbols = parseSymbolsParam(typeof raw === 'string' ? raw : undefined)
  if (!symbols) {
    return res.status(400).json({ error: 'Missing or invalid symbols query param' })
  }

  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const rollingStart = new Date(now.getTime() - 72 * 3600 * 1000)

  const result: IntradayResponse = {
    series: {},
    fetchedAt: Math.floor(Date.now() / 1000),
  }

  await Promise.allSettled(
    symbols.map(async symbol => {
      try {
        const exchange = detectExchange(symbol)

        const cleanFromChart = (chart: YahooChartPayload) => {
          const quotes = chart.quotes ?? []
          return quotes
            .map(q => {
              const ts = quoteTimestamp(q as { date?: Date | number | string })
              const raw = q as {
                close?: number | null
                open?: number | null
                low?: number | null
                high?: number | null
              }
              const price = firstPositivePrice(raw)
              const openVal =
                raw.open != null && Number.isFinite(raw.open) && raw.open > 0 ? raw.open : null
              return { ts, open: openVal, price }
            })
            .filter(
              q =>
                Number.isFinite(q.ts) &&
                q.price != null &&
                q.price > 0 &&
                isInExtendedChartWindow(exchange, q.ts),
            )
            .sort((a, b) => a.ts - b.ts)
            .filter((q, idx, arr) => idx === 0 || q.ts !== arr[idx - 1].ts)
        }

        // Try today's window first; fall back to 72-hour rolling window.
        // No explicit period2 — Yahoo defaults to "now" for live/partial sessions,
        // which ensures today's LSE/TSE bars are returned when markets are open.
        let chart: YahooChartPayload | null = null
        let cleaned: ReturnType<typeof cleanFromChart> = []

        for (const period1 of [todayStart, rollingStart]) {
          const c = (await yahooFinance.chart(symbol, {
            period1,
            interval: '1m',
            includePrePost: true,
          })) as YahooChartPayload
          const candidate = cleanFromChart(c)
          if (candidate.length > 0) {
            chart = c
            cleaned = candidate
            break
          }
        }

        if (!chart || cleaned.length === 0) {
          result.series[symbol] = { error: 'No intraday data returned' }
          return
        }

        const meta = chart.meta ?? {}
        const prevClose =
          meta.previousClose != null && meta.previousClose > 0
            ? meta.previousClose
            : meta.chartPreviousClose != null && meta.chartPreviousClose > 0
              ? meta.chartPreviousClose
              : null

        const firstRthIdx = cleaned.findIndex(q => isInRegularSession(exchange, q.ts))
        const firstBar = cleaned[0]
        const firstBarPx =
          (firstBar.open != null && firstBar.open > 0 ? firstBar.open : firstBar.price) ?? 0

        let rthOpen: number | null = null
        if (firstRthIdx >= 0) {
          const rthFirst = cleaned[firstRthIdx]
          rthOpen =
            (rthFirst.open != null && rthFirst.open > 0 ? rthFirst.open : rthFirst.price) ?? null
          if (rthOpen == null || rthOpen <= 0) {
            rthOpen = meta.regularMarketPrice && meta.regularMarketPrice > 0 ? meta.regularMarketPrice : null
          }
        }

        // Pre / post hours before first RTH bar: % vs previous close (or first tick of the day).
        // From RTH onward: % vs cash session open — avoids an empty chart before the bell.
        const preAnchor = prevClose ?? (firstBarPx > 0 ? firstBarPx : null)
        let openPrice: number
        let openTime: number

        if (firstRthIdx >= 0 && rthOpen != null && rthOpen > 0) {
          openPrice = rthOpen
          openTime = cleaned[firstRthIdx].ts
        } else if (preAnchor != null && preAnchor > 0) {
          openPrice = preAnchor
          openTime = firstBar.ts
        } else {
          result.series[symbol] = { error: 'Could not determine open price' }
          return
        }

        const points: IntradayPoint[] = []
        for (let i = 0; i < cleaned.length; i++) {
          const q = cleaned[i]
          const price = q.price!
          let base: number
          if (firstRthIdx >= 0 && rthOpen != null && rthOpen > 0 && i < firstRthIdx) {
            base = preAnchor ?? firstBarPx
          } else if (firstRthIdx >= 0 && rthOpen != null && rthOpen > 0) {
            base = rthOpen
          } else {
            base = preAnchor ?? firstBarPx
          }
          const pct = ((price - base) / base) * 100
          points.push({ t: q.ts, pct: parseFloat(pct.toFixed(3)) })
        }

        const currency = meta.currency ?? 'USD'

        result.series[symbol] = { points, meta: { exchange, openTime, currency, openPrice } }
      } catch (err) {
        logServerError(`intraday:${symbol}`, err)
        result.series[symbol] = { error: 'Unable to load market data' }
      }
    })
  )

  // Cache for 55 seconds (slightly under the 60s poll interval)
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=10')
  return res.status(200).json(result)
}
