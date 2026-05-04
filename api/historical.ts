import type { VercelRequest, VercelResponse } from '@vercel/node'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

type Range = '1W' | '1M' | '3M' | '1Y'

interface RangeConfig {
  interval: '60m' | '1d' | '1wk'
  daysBack: number
  cacheSeconds: number
}

const RANGE_CONFIG: Record<Range, RangeConfig> = {
  '1W': { interval: '60m', daysBack: 7,   cacheSeconds: 300  },
  '1M': { interval: '60m', daysBack: 30,  cacheSeconds: 600  },
  '3M': { interval: '60m', daysBack: 91,  cacheSeconds: 600  },
  '1Y': { interval: '1d',  daysBack: 365, cacheSeconds: 3600 },
}

export interface HistoricalPoint {
  t: number   // unix seconds
  pct: number // % change from period basePrice
}

export interface HistoricalMeta {
  basePrice: number
  currency: string
}

export interface HistoricalResponse {
  series: Record<string, { points: HistoricalPoint[]; meta: HistoricalMeta } | { error: string }>
  fetchedAt: number
}

/**
 * GET /api/historical?symbols=AAPL,TSLA&range=1W
 *
 * Returns % change from the first valid close price in the period for each symbol.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rawSymbols = req.query['symbols']
  const rawRange   = req.query['range']

  if (!rawSymbols || typeof rawSymbols !== 'string') {
    return res.status(400).json({ error: 'Missing symbols param' })
  }
  if (!rawRange || typeof rawRange !== 'string' || !(rawRange in RANGE_CONFIG)) {
    return res.status(400).json({ error: 'Invalid range param (must be 1W|1M|3M|1Y)' })
  }

  const symbols = rawSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 20)
  const range   = rawRange as Range
  const config  = RANGE_CONFIG[range]

  const period1 = new Date(Date.now() - config.daysBack * 86400 * 1000)
  const now     = new Date()

  const result: HistoricalResponse = { series: {}, fetchedAt: Math.floor(Date.now() / 1000) }

  await Promise.allSettled(
    symbols.map(async symbol => {
      try {
        const chart = await yahooFinance.chart(symbol, {
          period1,
          period2: now,
          interval: config.interval,
        })

        const quotes = chart.quotes ?? []
        if (quotes.length === 0) {
          result.series[symbol] = { error: 'No data returned' }
          return
        }

        // Base price = first valid close (or open fallback) in the period
        const firstValid = quotes.find(q => (q.close ?? q.open) != null && (q.close ?? q.open)! > 0)
        const basePrice  = firstValid?.close ?? firstValid?.open
        if (!basePrice || basePrice <= 0) {
          result.series[symbol] = { error: 'Could not determine base price' }
          return
        }

        const points: HistoricalPoint[] = []
        for (const q of quotes) {
          const price = q.close ?? q.open
          if (price == null || price <= 0) continue
          const ts  = q.date instanceof Date
            ? Math.floor(q.date.getTime() / 1000)
            : Math.floor(Number(q.date) / 1000)
          const pct = ((price - basePrice) / basePrice) * 100
          points.push({ t: ts, pct: parseFloat(pct.toFixed(3)) })
        }

        const currency = chart.meta.currency ?? 'USD'
        result.series[symbol] = { points, meta: { basePrice, currency } }
      } catch (err) {
        result.series[symbol] = { error: err instanceof Error ? err.message : String(err) }
      }
    })
  )

  res.setHeader('Cache-Control', `s-maxage=${config.cacheSeconds}, stale-while-revalidate=30`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  return res.status(200).json(result)
}
