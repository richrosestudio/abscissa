import type { Holding, Theme, LineStyle } from '../types'

const KEYS = {
  holdings: 'abscissa:holdings',
  theme: 'abscissa:theme',
  hidePctFootnote: 'abscissa:hidePctFootnote',
}

const HOLDING_ID_RE = /^[A-Z0-9][A-Z0-9.\-^]{0,24}$/
/** Display ticker: conservative allowlist */
const TICKER_DISP_RE = /^[A-Z0-9][A-Z0-9.\-^]{0,31}$/i
const HEX6 = /^#[0-9a-fA-F]{6}$/
const LINE_STYLES = new Set<LineStyle>(['solid', 'dashed', 'dotted'])
const DEFAULT_COLOR = '#6366f1'

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

  const h: Holding = { id, ticker, exchange: ex, color }
  if (gradientColors !== undefined) h.gradientColors = gradientColors
  if (lineStyle !== undefined) h.lineStyle = lineStyle
  if (lineThickness !== undefined) h.lineThickness = lineThickness
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
