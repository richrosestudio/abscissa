import type { Holding, SeriesPoint, TimeRange } from '../types'

export const MOCK_TICK_INTERVAL_SEC = 4

/**
 * Extend an existing series by one tick (small random walk step).
 * Used for continuous live animation between data updates.
 */
export function tickSeries(
  points: SeriesPoint[],
  volatilityPerMinute: number,
  maxPoints = 2000,
): SeriesPoint[] {
  if (points.length === 0) return points
  const last = points[points.length - 1]
  // Scale volatility down to per-tick using random-walk sqrt scaling
  const ticksPerMinute = 60 / MOCK_TICK_INTERVAL_SEC
  const stepScale = (volatilityPerMinute * 2) / Math.sqrt(ticksPerMinute)
  const step = (Math.random() - 0.5) * stepScale
  const nextValue = parseFloat(
    Math.max(-15, Math.min(15, last.value + step)).toFixed(3)
  )
  const trimmed = points.length >= maxPoints ? points.slice(1) : points
  return [...trimmed, { time: last.time + MOCK_TICK_INTERVAL_SEC, value: nextValue }]
}

/**
 * Generate realistic-looking mock intraday % data for a stock.
 * Starts from 0% at market open and random-walks from there.
 */
export function generateMockSeries(
  openUnixSec: number,
  durationMinutes: number,
  seed: number,
  volatility = 0.08,
): SeriesPoint[] {
  const points: SeriesPoint[] = []
  const intervalSec = 60 // 1 data point per minute
  const steps = Math.floor((durationMinutes * 60) / intervalSec)

  let value = 0
  // Simple seeded pseudo-random (mulberry32)
  let s = seed >>> 0
  const rand = () => {
    s += 0x6D2B79F5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  for (let i = 0; i <= steps; i++) {
    const time = openUnixSec + i * intervalSec
    if (i > 0) {
      value += (rand() - 0.5) * volatility * 2
      value = Math.max(-15, Math.min(15, value))
    }
    points.push({ time, value: parseFloat(value.toFixed(3)) })
  }

  return points
}

/** Realistic open prices for known tickers (used when showing mock/simulated data) */
export const MOCK_OPEN_PRICES: Record<string, { price: number; currency: string }> = {
  'AAPL':    { price: 185.00,  currency: 'USD' },
  'TSLA':    { price: 178.00,  currency: 'USD' },
  'NVDA':    { price: 820.00,  currency: 'USD' },
  'VOD.L':   { price: 68.50,   currency: 'GBp' },
  'BP.L':    { price: 452.00,  currency: 'GBp' },
  // TSE examples (prices in JPY)
  '7203.T':  { price: 3200.00, currency: 'JPY' }, // Toyota
  '6758.T':  { price: 2800.00, currency: 'JPY' }, // Sony
  '9984.T':  { price: 7500.00, currency: 'JPY' }, // SoftBank
}

/** Fallback prices by exchange for unknown tickers */
const FALLBACK_PRICES: Record<string, { price: number; currency: string }> = {
  LSE: { price: 100.00, currency: 'GBp' },
  TSE: { price: 1000.00, currency: 'JPY' },
  US:  { price: 100.00, currency: 'USD' },
}

/** Per-ticker volatility used for both seeded generation and live ticks */
export const MOCK_VOLATILITIES: Record<string, number> = {
  'AAPL':   0.06,
  'TSLA':   0.14,
  'NVDA':   0.10,
  'VOD.L':  0.05,
  'BP.L':   0.07,
  '7203.T': 0.06,
  '6758.T': 0.08,
  '9984.T': 0.12,
}
export const DEFAULT_VOLATILITY = 0.08

/** Derive a stable numeric seed from a ticker string */
function tickerSeed(ticker: string): number {
  let h = 0
  for (let i = 0; i < ticker.length; i++) {
    h = Math.imul(31, h) + ticker.charCodeAt(i) | 0
  }
  return (h >>> 0) + 1 // ensure non-zero
}

function getLondonOffsetMinutes(): number {
  const now = new Date()
  const londonStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const lh = parseInt(londonStr.find(p => p.type === 'hour')?.value ?? '0')
  const lm = parseInt(londonStr.find(p => p.type === 'minute')?.value ?? '0')
  const utcH = now.getUTCHours()
  const utcM = now.getUTCMinutes()
  return (lh * 60 + lm) - (utcH * 60 + utcM)
}

function getTokyoOffsetMinutes(): number {
  const now = new Date()
  const tokyoStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const th = parseInt(tokyoStr.find(p => p.type === 'hour')?.value ?? '0')
  const tm = parseInt(tokyoStr.find(p => p.type === 'minute')?.value ?? '0')
  const utcH = now.getUTCHours()
  const utcM = now.getUTCMinutes()
  return (th * 60 + tm) - (utcH * 60 + utcM)
}

/**
 * Returns mock series data for every holding in the provided list.
 * Known tickers get their calibrated seeds/volatilities; unknown tickers
 * get a deterministic seed derived from the ticker string so they always
 * produce the same-shaped line across renders.
 */
export function getMockSeriesData(
  holdings: Holding[],
): Record<string, { points: SeriesPoint[]; latestPct: number }> {
  const now = Date.now() / 1000
  const londonOffset = getLondonOffsetMinutes()
  const tokyoOffset  = getTokyoOffsetMinutes()

  const todayUTCMidnight = Math.floor(Date.now() / 86400000) * 86400

  // Session open times in UTC seconds
  const lseOpenUTC = todayUTCMidnight + (8 * 60 - londonOffset) * 60
  const usOpenUTC  = todayUTCMidnight + (14 * 60 + 30 - londonOffset) * 60
  // TSE opens 09:00 JST
  const tseOpenUTC = todayUTCMidnight + (9 * 60 - tokyoOffset) * 60

  const lseMins = Math.max(0, Math.floor((now - lseOpenUTC) / 60))
  const usMins  = Math.max(0, Math.floor((now - usOpenUTC)  / 60))
  const tseMins = Math.max(0, Math.floor((now - tseOpenUTC) / 60))

  const make = (open: number, mins: number, seed: number, vol: number) => {
    const pts = generateMockSeries(open, mins, seed, vol)
    return { points: pts, latestPct: pts[pts.length - 1]?.value ?? 0 }
  }

  const result: Record<string, { points: SeriesPoint[]; latestPct: number }> = {}

  for (const h of holdings) {
    const vol  = MOCK_VOLATILITIES[h.id] ?? DEFAULT_VOLATILITY
    const seed = tickerSeed(h.id)

    if (h.exchange === 'LSE') {
      result[h.id] = make(lseOpenUTC, lseMins, seed, vol)
    } else if (h.exchange === 'TSE') {
      result[h.id] = make(tseOpenUTC, tseMins, seed, vol)
    } else {
      result[h.id] = make(usOpenUTC, usMins, seed, vol)
    }
  }

  return result
}

/** Days of history and volatility multiplier per range */
const RANGE_PARAMS: Record<Exclude<TimeRange, '1D'>, { days: number; volMult: number }> = {
  '1W': { days: 7,   volMult: 3 },
  '1M': { days: 30,  volMult: 5 },
  '3M': { days: 91,  volMult: 8 },
  '1Y': { days: 365, volMult: 15 },
}

/**
 * Generate mock historical series data for a given time range.
 * Returns points at daily (or hourly for 1W) intervals as % change from first point.
 * Accepts the current holdings so any ticker gets data, not just the 5 defaults.
 */
export function getMockHistoricalData(
  range: Exclude<TimeRange, '1D'>,
  holdings: Holding[],
): Record<string, { points: SeriesPoint[]; latestPct: number; basePrice: number; currency: string }> {
  const { days, volMult } = RANGE_PARAMS[range]
  const intervalSec = range === '1Y' ? 86400 : 3600  // hourly for 1W/1M/3M, daily for 1Y
  const nowSec = Math.floor(Date.now() / 1000)
  const startSec = nowSec - days * 86400

  const result: Record<string, { points: SeriesPoint[]; latestPct: number; basePrice: number; currency: string }> = {}

  holdings.forEach((h, ti) => {
    const vol  = (MOCK_VOLATILITIES[h.id] ?? DEFAULT_VOLATILITY) * volMult
    const meta = MOCK_OPEN_PRICES[h.id] ?? FALLBACK_PRICES[h.exchange]
    const seed = tickerSeed(h.id) + ti * 99 + 7
    const pts  = generateMockSeries(startSec, (days * 86400) / 60, seed, vol / Math.sqrt(days))
    // Resample to correct interval granularity
    const step    = Math.max(1, Math.round(intervalSec / 60))
    const sampled = pts.filter((_, i) => i % step === 0)
    result[h.id] = {
      points:    sampled,
      latestPct: sampled[sampled.length - 1]?.value ?? 0,
      basePrice: meta.price,
      currency:  meta.currency,
    }
  })

  return result
}
