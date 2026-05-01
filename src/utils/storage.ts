import type { Holding, Theme } from '../types'

const KEYS = {
  holdings: 'abscissa:holdings',
  theme: 'abscissa:theme',
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
