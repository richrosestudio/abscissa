import type { VercelRequest, VercelResponse } from '@vercel/node'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

export interface SearchResult {
  symbol: string
  name: string
  exchange: string
  type: string
}

export interface SearchResponse {
  results: SearchResult[]
}

/**
 * GET /api/search?q=AAPL
 *
 * Returns ticker autocomplete suggestions from Yahoo Finance.
 * Filtered to equities and ETFs only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const q = req.query['q']
  if (!q || typeof q !== 'string' || q.trim().length < 1) {
    return res.status(400).json({ error: 'Missing q param' })
  }

  try {
    const data = await yahooFinance.search(q.trim(), {
      newsCount: 0,
      quotesCount: 8,
    })

    const results: SearchResult[] = (data.quotes ?? [])
      .filter(item =>
        item.symbol &&
        (item.quoteType === 'EQUITY' || item.quoteType === 'ETF')
      )
      .slice(0, 8)
      .map(item => ({
        symbol: item.symbol ?? '',
        name: (item as { shortname?: string; longname?: string }).shortname
          ?? (item as { shortname?: string; longname?: string }).longname
          ?? item.symbol ?? '',
        exchange: (item as { exchDisp?: string }).exchDisp ?? '',
        type: item.quoteType ?? '',
      }))

    res.setHeader('Cache-Control', 's-maxage=30')
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
}
