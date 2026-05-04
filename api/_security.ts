import type { VercelResponse } from '@vercel/node'

/**
 * Shared validation and safe responses for serverless API routes.
 */

/** Max tickers per request (cost / abuse control). */
export const MAX_SYMBOLS = 20

/** Single symbol: letters, digits, dot, hyphen, caret (e.g. BRK-B, VOD.L, ^GSPC). */
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-^]{0,24}$/i

export function isValidSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase()
  return s.length >= 1 && s.length <= 25 && SYMBOL_RE.test(s)
}

/**
 * Parse comma-separated symbols; invalid entries dropped; returns null if none valid.
 */
export function parseSymbolsParam(raw: string | undefined): string[] | null {
  if (!raw || typeof raw !== 'string') return null
  const symbols = raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(isValidSymbol)
    .slice(0, MAX_SYMBOLS)
  return symbols.length ? symbols : null
}

const MAX_SEARCH_LEN = 64

export function parseSearchQuery(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const q = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  if (q.length < 1 || q.length > MAX_SEARCH_LEN) return null
  return q
}

export function sendInternalError(res: VercelResponse): void {
  res.status(500).json({ error: 'Internal server error' })
}

export function logServerError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[api] ${context}:`, msg)
}
