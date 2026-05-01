import type { VercelRequest, VercelResponse } from '@vercel/node'
import YahooFinance from 'yahoo-finance2'

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
  LSE: { startMin: 1 * 60, endMin: 21 * 60 + 59 },
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
  return Math.floor(Number(q.date) / 1000)
}

/**
 * GET /api/intraday?symbols=AAPL,TSLA,VOD.L
 *
 * Returns intraday % change from session open for each symbol.
 * All Yahoo Finance calls are server-side only — never from the browser.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const raw = req.query['symbols']
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'Missing symbols query param' })
  }

  const symbols = raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20) // guard against abuse

  if (symbols.length === 0) {
    return res.status(400).json({ error: 'No valid symbols' })
  }

  // Start of today in UTC (Yahoo period1 accepts Date or string)
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)

  const result: IntradayResponse = {
    series: {},
    fetchedAt: Math.floor(Date.now() / 1000),
  }

  await Promise.allSettled(
    symbols.map(async symbol => {
      try {
        const exchange = detectExchange(symbol)

        const chart = await yahooFinance.chart(symbol, {
          period1: todayStart,
          interval: '1m',
          includePrePost: true,
        })

        const quotes = chart.quotes ?? []
        if (quotes.length === 0) {
          result.series[symbol] = { error: 'No data returned' }
          return
        }

        const cleaned = quotes
          .map(q => {
            const ts = quoteTimestamp(q)
            const price = q.close ?? q.open
            return { ts, open: q.open, price }
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

        if (cleaned.length === 0) {
          result.series[symbol] = { error: 'No intraday data returned' }
          return
        }

        const firstRthIdx = cleaned.findIndex(q => isInRegularSession(exchange, q.ts))
        if (firstRthIdx < 0) {
          result.series[symbol] = { error: 'No regular-session data returned' }
          return
        }

        const rthFirst = cleaned[firstRthIdx]
        const openPrice =
          (rthFirst.open != null && rthFirst.open > 0
            ? rthFirst.open
            : rthFirst.price) ??
          chart.meta.regularMarketPrice

        if (!openPrice || openPrice <= 0) {
          result.series[symbol] = { error: 'Could not determine open price' }
          return
        }

        const points: IntradayPoint[] = []
        for (const q of cleaned) {
          const price = q.price
          const pct = ((price - openPrice) / openPrice) * 100
          points.push({ t: q.ts, pct: parseFloat(pct.toFixed(3)) })
        }

        const openTime = rthFirst.ts
        const currency = chart.meta.currency ?? 'USD'

        result.series[symbol] = { points, meta: { exchange, openTime, currency, openPrice } }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.series[symbol] = { error: message }
      }
    })
  )

  // Cache for 55 seconds (slightly under the 60s poll interval)
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=10')
  res.setHeader('Access-Control-Allow-Origin', '*')
  return res.status(200).json(result)
}
