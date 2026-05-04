import type { SeriesPoint } from '../types'

/** Nearest intraday % to `targetTime` (unix seconds). */
export function nearestPct(points: SeriesPoint[], targetTime: number): number | null {
  if (points.length === 0) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid]!.time < targetTime) lo = mid + 1
    else hi = mid
  }
  if (
    lo > 0 &&
    Math.abs(points[lo - 1]!.time - targetTime) < Math.abs(points[lo]!.time - targetTime)
  ) {
    return points[lo - 1]!.value
  }
  return points[lo]!.value
}

export function formatPrice(price: number, currency: string | undefined): string {
  if (!currency) return price.toFixed(2)
  if (currency === 'USD') return `$${price.toFixed(2)}`
  if (currency === 'GBP') return `£${price.toFixed(2)}`
  if (currency === 'GBp' || currency === 'GBX') return `${Math.round(price)}p`
  if (currency === 'EUR') return `€${price.toFixed(2)}`
  return price.toFixed(2)
}
