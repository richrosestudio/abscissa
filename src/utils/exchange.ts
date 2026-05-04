import type { Exchange } from '../types'

export function detectExchange(ticker: string): Exchange {
  const upper = ticker.toUpperCase()
  if (upper.endsWith('.L')) return 'LSE'
  if (upper.endsWith('.T')) return 'TSE'
  return 'US'
}

export function normalizeId(ticker: string): string {
  let s = ticker.trim().toUpperCase()
  if (s.startsWith('$')) s = s.slice(1).trim().toUpperCase()
  return s
}

/**
 * Session windows in UTC minutes from midnight.
 * LSE: 08:00–16:30 UK time. UK is UTC+1 in BST (Apr–Oct), UTC+0 in GMT (Nov–Mar).
 * US:  09:30–16:00 ET → 14:30–21:00 UK BST / 14:30–21:00 UK GMT (ET is UTC-4 BST / UTC-5 GMT).
 * We use the user's local clock for display; for session logic we compare wall-clock London time.
 */
export function getLondonNow(): Date {
  // Intl gives us London wall-clock time
  const londonStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())

  const get = (type: string) => parseInt(londonStr.find(p => p.type === type)?.value ?? '0')
  const d = new Date()
  d.setFullYear(get('year'), get('month') - 1, get('day'))
  d.setHours(get('hour'), get('minute'), get('second'), 0)
  return d
}

export function getLondonMinutes(): number {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

// LSE: 08:00–16:30 London time
export function isLSEOpen(): boolean {
  const m = getLondonMinutes()
  return m >= 8 * 60 && m < 16 * 60 + 30
}

// US: 14:30–21:00 London time (09:30–16:00 ET, adjusted for UK offset)
export function isUSOpen(): boolean {
  const m = getLondonMinutes()
  return m >= 14 * 60 + 30 && m < 21 * 60
}

// TSE: 09:00–11:30 and 12:30–15:00 JST (lunch 11:30–12:30 closed), matches chart zones
export function isTSEOpen(): boolean {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  const mins = h * 60 + m
  const morning   = mins >= 9 * 60 && mins < 11 * 60 + 30
  const afternoon = mins >= 12 * 60 + 30 && mins < 15 * 60
  return morning || afternoon
}

export function isExchangeOpen(exchange: Exchange): boolean {
  if (exchange === 'LSE') return isLSEOpen()
  if (exchange === 'TSE') return isTSEOpen()
  return isUSOpen()
}

export function shouldPoll(exchanges: Exchange[]): boolean {
  return exchanges.some(isExchangeOpen)
}
