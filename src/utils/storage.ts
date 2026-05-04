import type { Holding, Theme } from '../types'

const KEYS = {
  holdings: 'abscissa:holdings',
  theme: 'abscissa:theme',
  hidePctFootnote: 'abscissa:hidePctFootnote',
}

export function loadHoldings(): Holding[] {
  try {
    const raw = localStorage.getItem(KEYS.holdings)
    if (!raw) return []
    return JSON.parse(raw) as Holding[]
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
