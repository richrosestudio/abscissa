import type { Exchange, Holding, Theme, LineStyle } from '../types'

const KEYS = {
  holdings: 'abscissa:holdings',
  theme: 'abscissa:theme',
  hidePctFootnote: 'abscissa:hidePctFootnote',
  sessionExchange: 'abscissa:sessionExchange',
}

const EXCHANGES = new Set<Exchange>(['LSE', 'US', 'TSE'])

const HOLDING_ID_RE = /^[A-Z0-9][A-Z0-9.\-^]{0,24}$/
/** Display ticker: conservative allowlist */
const TICKER_DISP_RE = /^[A-Z0-9][A-Z0-9.\-^]{0,31}$/i
const HEX6 = /^#[0-9a-fA-F]{6}$/
const LINE_STYLES = new Set<LineStyle>(['solid', 'dashed', 'dotted'])
const DEFAULT_COLOR = '#6366f1'
const CTRL_CHARS = /[\u0000-\u001F\u007F]/g
const MAX_COMPANY_NAME = 120
const MAX_VENUE_DISPLAY = 48

function sanitizeDisplayField(raw: string, maxLen: number): string | undefined {
  const t = raw.replace(CTRL_CHARS, '').trim().slice(0, maxLen)
  return t.length > 0 ? t : undefined
}

function sanitizeHolding(raw: unknown): Holding | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim().toUpperCase() : ''
  const tickerRaw = typeof o.ticker === 'string' ? o.ticker.trim() : ''
  const ticker = tickerRaw.length > 0 ? tickerRaw.toUpperCase() : id
  const ex = o.exchange

  if (!HOLDING_ID_RE.test(id) || id.length > 25) return null
  if (!TICKER_DISP_RE.test(ticker)) return null
  if (ex !== 'LSE' && ex !== 'US' && ex !== 'TSE') return null

  let color = typeof o.color === 'string' ? o.color.trim() : DEFAULT_COLOR
  if (!HEX6.test(color)) color = DEFAULT_COLOR

  let gradientColors: Holding['gradientColors'] | undefined
  if (
    Array.isArray(o.gradientColors) &&
    (o.gradientColors.length === 1 || o.gradientColors.length === 2 || o.gradientColors.length === 3)
  ) {
    const stops = o.gradientColors
      .map(c => (typeof c === 'string' ? c.trim() : ''))
      .filter(c => HEX6.test(c))
    if (stops.length === 1) gradientColors = [stops[0]!]
    else if (stops.length === 2) gradientColors = [stops[0]!, stops[1]!]
    else if (stops.length === 3) gradientColors = [stops[0]!, stops[1]!, stops[2]!]
  }

  let lineStyle: Holding['lineStyle'] | undefined
  if (typeof o.lineStyle === 'string' && LINE_STYLES.has(o.lineStyle as LineStyle)) {
    lineStyle = o.lineStyle as LineStyle
  }

  let lineThickness: number | undefined
  if (typeof o.lineThickness === 'number' && Number.isInteger(o.lineThickness)) {
    if (o.lineThickness >= 1 && o.lineThickness <= 4) lineThickness = o.lineThickness
  }

  let dotColor: string | undefined
  if (typeof o.dotColor === 'string') {
    const dc = o.dotColor.trim()
    if (HEX6.test(dc)) dotColor = dc
  }

  const linear: boolean | undefined =
    typeof o.linear === 'boolean' ? o.linear : undefined

  let lineOpacity: number | undefined
  if (typeof o.lineOpacity === 'number' && isFinite(o.lineOpacity)) {
    const clamped = Math.round(Math.max(0.1, Math.min(1, o.lineOpacity)) * 100) / 100
    lineOpacity = clamped
  }

  let companyName: string | undefined
  if (typeof o.companyName === 'string') {
    companyName = sanitizeDisplayField(o.companyName, MAX_COMPANY_NAME)
  }

  let venueDisplay: string | undefined
  if (typeof o.venueDisplay === 'string') {
    venueDisplay = sanitizeDisplayField(o.venueDisplay, MAX_VENUE_DISPLAY)
  }

  const h: Holding = { id, ticker, exchange: ex, color }
  if (gradientColors !== undefined) h.gradientColors = gradientColors
  if (lineStyle !== undefined) h.lineStyle = lineStyle
  if (lineThickness !== undefined) h.lineThickness = lineThickness
  if (dotColor !== undefined) h.dotColor = dotColor
  if (linear !== undefined) h.linear = linear
  if (lineOpacity !== undefined) h.lineOpacity = lineOpacity
  if (companyName !== undefined) h.companyName = companyName
  if (venueDisplay !== undefined) h.venueDisplay = venueDisplay
  return h
}

export function loadHoldings(): Holding[] {
  try {
    const raw = localStorage.getItem(KEYS.holdings)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeHolding).filter((h): h is Holding => h != null)
  } catch {
    return []
  }
}

export function saveHoldings(holdings: Holding[]): void {
  localStorage.setItem(KEYS.holdings, JSON.stringify(holdings))
}

export function loadTheme(): Theme {
  const raw = localStorage.getItem(KEYS.theme)
  if (raw === 'light' || raw === 'dark') return raw
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(KEYS.theme, theme)
}

export function loadPctFootnoteHidden(): boolean {
  try {
    const raw = localStorage.getItem(KEYS.hidePctFootnote)
    if (raw === '1' || raw === 'true') return true
    return false
  } catch {
    return false
  }
}

export function savePctFootnoteHidden(hidden: boolean): void {
  localStorage.setItem(KEYS.hidePctFootnote, hidden ? '1' : '0')
}

/** Default US (New York) when unset; `"all"` in storage maps to `null` (every venue). */
export function loadSessionExchange(): Exchange | null {
  try {
    const raw = localStorage.getItem(KEYS.sessionExchange)
    if (raw === null) return 'US'
    if (raw === 'all') return null
    if (EXCHANGES.has(raw as Exchange)) return raw as Exchange
    return 'US'
  } catch {
    return 'US'
  }
}

export function saveSessionExchange(exchange: Exchange | null): void {
  localStorage.setItem(KEYS.sessionExchange, exchange ?? 'all')
}
