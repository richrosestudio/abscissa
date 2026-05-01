// Default cycling palette — visually distinct, works on both dark and light
export const DEFAULT_PALETTE = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#3b82f6', // blue
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#a855f7', // purple
  '#84cc16', // lime
]

export function nextColor(usedColors: string[]): string {
  const used = new Set(usedColors)
  return DEFAULT_PALETTE.find(c => !used.has(c)) ?? DEFAULT_PALETTE[usedColors.length % DEFAULT_PALETTE.length]
}

/**
 * Interpolate a percentage value to a green/red colour.
 * 0% → neutral grey-ish; positive → greener; negative → redder.
 * Uses HSL for smooth drift.
 */
export function pctToColor(pct: number, theme: 'dark' | 'light'): string {
  const abs = Math.min(Math.abs(pct), 10) // cap at 10% for full saturation
  const intensity = abs / 10
  if (pct === 0) return theme === 'dark' ? '#9ca3af' : '#6b7280'
  if (pct > 0) {
    const l = theme === 'dark' ? 45 + intensity * 15 : 35 + intensity * 10
    const s = 50 + intensity * 40
    return `hsl(142, ${s}%, ${l}%)`
  }
  const l = theme === 'dark' ? 45 + intensity * 15 : 35 + intensity * 10
  const s = 50 + intensity * 40
  return `hsl(0, ${s}%, ${l}%)`
}
