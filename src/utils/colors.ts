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

const HEX6 = /^#([0-9a-f]{6})$/i

function parseHex6(hex: string): { r: number; g: number; b: number } | null {
  const m = HEX6.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h, s: s * 100, l: l * 100 }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rp = 0
  let gp = 0
  let bp = 0
  if (h < 60) [rp, gp, bp] = [c, x, 0]
  else if (h < 120) [rp, gp, bp] = [x, c, 0]
  else if (h < 180) [rp, gp, bp] = [0, c, x]
  else if (h < 240) [rp, gp, bp] = [0, x, c]
  else if (h < 300) [rp, gp, bp] = [x, 0, c]
  else [rp, gp, bp] = [c, 0, x]
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  }
}

/** Pick a second colour that reads clearly as a blend partner on a chart line. */
export function gradientCompanion(hex: string): string {
  const rgb = parseHex6(hex)
  if (!rgb) return '#f59e0b'
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  const nh = (h + 52) % 360
  const ns = Math.min(92, s + (s < 18 ? 28 : 14))
  let nl = l
  if (l > 62) nl = Math.max(34, l - 22)
  else if (l < 38) nl = Math.min(66, l + 20)
  else nl = l > 52 ? l - 14 : l + 14
  const out = hslToRgb(nh, ns, nl)
  return rgbToHex(out.r, out.g, out.b)
}

/** Linear mix in RGB space, `t` in [0,1]. */
export function mixHex(a: string, b: string, t: number): string {
  const A = parseHex6(a)
  const B = parseHex6(b)
  if (!A || !B) return b
  const u = Math.max(0, Math.min(1, t))
  return rgbToHex(
    A.r + (B.r - A.r) * u,
    A.g + (B.g - A.g) * u,
    A.b + (B.b - A.b) * u,
  )
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
