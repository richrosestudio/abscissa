import type { VercelRequest, VercelResponse } from '@vercel/node'
import YahooFinance from 'yahoo-finance2'
import { parseSearchQuery, sendInternalError, logServerError, isValidSymbol } from './_security'

const yahooFinance = new YahooFinance()

/** Yahoo sometimes returns LSE symbols without `.L`; chart + exchange detection need the suffix. */
function normalizeSearchSymbol(symbol: string, exchDisp: string): string {
  const s = symbol.trim().toUpperCase()
  if (s.endsWith('.L') || s.endsWith('.T')) return s
  const ex = exchDisp.toLowerCase()
  const isLondon =
    ex.includes('london') ||
    ex.includes('lse') ||
    ex === 'lon'
  if (isLondon) return `${s}.L`
  return s
}

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

  const rawQ = req.query['q']
  const qRaw = typeof rawQ === 'string' ? parseSearchQuery(rawQ) : null
  if (!qRaw) {
    return res.status(400).json({ error: 'Invalid or missing q param' })
  }

  try {
    const data = await yahooFinance.search(qRaw, {
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
        symbol: normalizeSearchSymbol(
          item.symbol ?? '',
          (item as { exchDisp?: string }).exchDisp ?? '',
        ),
        name: (item as { shortname?: string; longname?: string }).shortname
          ?? (item as { shortname?: string; longname?: string }).longname
          ?? item.symbol ?? '',
        exchange: (item as { exchDisp?: string }).exchDisp ?? '',
        type: item.quoteType ?? '',
      }))
      .filter(r => isValidSymbol(r.symbol))

    res.setHeader('Cache-Control', 's-maxage=30')
    return res.status(200).json({ results })
  } catch (err) {
    logServerError('search', err)
    return sendInternalError(res)
  }
}
