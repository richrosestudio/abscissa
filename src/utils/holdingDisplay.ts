import type { Exchange, Holding } from '../types'

const FALLBACK_VENUE: Record<Exchange, string> = {
  LSE: 'London',
  US: 'U.S.',
  TSE: 'Tokyo',
}

/** Venue line for UI: stored Yahoo `exchDisp`, optional search backfill, else coarse market bucket. */
export function venueSubtitle(h: Holding, resolvedExchDisp?: string): string {
  const fromSearch = resolvedExchDisp?.trim()
  return h.venueDisplay ?? (fromSearch || undefined) ?? FALLBACK_VENUE[h.exchange]
}
