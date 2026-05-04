export type Exchange = 'LSE' | 'US' | 'TSE'

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export interface Holding {
  id: string        // e.g. "AAPL" or "VOD.L"
  ticker: string    // display ticker
  exchange: Exchange
  color: string
  /** Extra stops after `color` along the line: 1 → 2-stop gradient, 2 → 3-stop, 3 → 4-stop. */
  gradientColors?: [string] | [string, string] | [string, string, string]
  lineStyle?: LineStyle
  lineThickness?: number  // 1–4
}

export interface SeriesPoint {
  time: number  // unix seconds
  value: number // % from open
}

export interface SeriesData {
  id: string
  points: SeriesPoint[]
  latestPct: number
  openPrice?: number  // session open price in native currency
  currency?: string   // 'USD', 'GBp', 'GBP', 'EUR', etc.
}

export type Theme = 'dark' | 'light'

export type TimeRange = '1D' | '1W' | '1M' | '3M' | '1Y'
