import { useState, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { Exchange, Holding, SeriesData, Theme } from '../types'
import { isExchangeOpen, normalizeId } from '../utils/exchange'
import { pctToColor } from '../utils/colors'
import { nearestPct, formatPrice } from '../utils/quoteDisplay'
import { venueSubtitle } from '../utils/holdingDisplay'
import AnalogClock from './AnalogClock'
import FearGreed from './FearGreed'
import './Header.css'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  onScreenshot?: () => Promise<void>
  hoveredTime?: number | null
  selectedExchange?: Exchange | null
  onSelectExchange?: (exchange: Exchange) => void
  focusedHolding?: Holding | null
  seriesData?: Record<string, SeriesData>
  onHoldingMetaResolved?: (id: string, meta: Partial<Pick<Holding, 'companyName' | 'venueDisplay'>>) => void
}

interface SearchApiResult {
  symbol: string
  name: string
  exchange: string
  type: string
}

/** Match CSS `grid-template-rows` / hero fade timing */
const HEADER_HERO_MS = 400

const CLOCKS: { city: string; tz: string; exchange: Exchange; offset: () => string }[] = [
  { city: 'London',   tz: 'Europe/London',   exchange: 'LSE', offset: () => tzOffset('Europe/London') },
  { city: 'New York', tz: 'America/New_York', exchange: 'US',  offset: () => tzOffset('America/New_York') },
  { city: 'Tokyo',    tz: 'Asia/Tokyo',       exchange: 'TSE', offset: () => tzOffset('Asia/Tokyo') },
]

function tzOffset(tz: string): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).formatToParts(now)
  return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
}

function IconMoon() {
  return (
    <svg
      className="theme-toggle-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSun() {
  return (
    <svg
      className="theme-toggle-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconScreenshot() {
  return (
    <svg
      className="theme-toggle-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export default function Header({
  theme,
  onToggleTheme,
  onScreenshot,
  hoveredTime,
  selectedExchange,
  onSelectExchange,
  focusedHolding = null,
  seriesData = {},
  onHoldingMetaResolved,
}: Props) {
  const [rowOpen, setRowOpen] = useState(false)
  const [mountedHero, setMountedHero] = useState<Holding | null>(null)
  const [shotBusy, setShotBusy] = useState(false)
  const clearMountedRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Search backfill keyed by holding id (manual/legacy holdings without stored meta). */
  const [resolvedSearchMeta, setResolvedSearchMeta] = useState<
    Record<string, { name: string; exchange: string }>
  >({})

  // Tick every 30s so open/closed state stays current
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (focusedHolding) {
      if (clearMountedRef.current) {
        clearTimeout(clearMountedRef.current)
        clearMountedRef.current = null
      }
      setMountedHero(focusedHolding)
      const raf = requestAnimationFrame(() => {
        setRowOpen(true)
      })
      return () => cancelAnimationFrame(raf)
    }
    setRowOpen(false)
    clearMountedRef.current = setTimeout(() => {
      setMountedHero(null)
      clearMountedRef.current = null
    }, HEADER_HERO_MS)
    return () => {
      if (clearMountedRef.current) {
        clearTimeout(clearMountedRef.current)
        clearMountedRef.current = null
      }
    }
  }, [focusedHolding])

  const quoteHolding = focusedHolding ?? mountedHero

  // Backfill company / venue from search when storage is missing (manual add or legacy).
  useEffect(() => {
    if (!quoteHolding) return
    const { id, companyName, venueDisplay } = quoteHolding
    if (companyName && venueDisplay) return

    let cancelled = false
    let ac: AbortController | null = null
    const tid = window.setTimeout(() => {
      ac = new AbortController()
      void (async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(id)}`, { signal: ac!.signal })
          if (!res.ok || cancelled) return
          const data = (await res.json()) as { results?: SearchApiResult[] }
          const match = data.results?.find(r => normalizeId(r.symbol) === id)
          if (!match || cancelled) return
          const name = (match.name ?? '').trim()
          const exchange = (match.exchange ?? '').trim()
          setResolvedSearchMeta(prev => ({ ...prev, [id]: { name, exchange } }))

          const patch: Partial<Pick<Holding, 'companyName' | 'venueDisplay'>> = {}
          if (!companyName && name) patch.companyName = name
          if (!venueDisplay && exchange) patch.venueDisplay = exchange
          if (Object.keys(patch).length > 0) onHoldingMetaResolved?.(id, patch)
        } catch (e: unknown) {
          if (e instanceof Error && e.name === 'AbortError') return
        }
      })()
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(tid)
      ac?.abort()
    }
  }, [quoteHolding, onHoldingMetaResolved])

  const hero = useMemo(() => {
    if (!quoteHolding) return null
    const sd = seriesData[quoteHolding.id]
    const latest = sd?.latestPct ?? 0
    let displayPct = latest
    let priceLabel: string | null = null
    if (sd?.openPrice != null && sd.points.length > 0) {
      if (hoveredTime != null) {
        const hp = nearestPct(sd.points, hoveredTime)
        if (hp != null) {
          displayPct = hp
          priceLabel = formatPrice(sd.openPrice * (1 + hp / 100), sd.currency)
        } else {
          priceLabel = formatPrice(sd.openPrice * (1 + latest / 100), sd.currency)
        }
      } else {
        priceLabel = formatPrice(sd.openPrice * (1 + latest / 100), sd.currency)
      }
    }
    const resolved = resolvedSearchMeta[quoteHolding.id]
    const displayName = (quoteHolding.companyName ?? resolved?.name ?? '').trim()
    const venueLine = venueSubtitle(quoteHolding, resolved?.exchange)
    return {
      ticker: quoteHolding.ticker,
      displayName,
      venueLine,
      displayPct,
      pctStyle: { color: pctToColor(displayPct, theme) },
      priceLabel,
    }
  }, [quoteHolding, resolvedSearchMeta, seriesData, hoveredTime, theme])

  return (
    <header className="header">
      <div className="header-top">
        <img
          src="/abscissa-logo.png"
          alt="Abscissa"
          className="header-wordmark"
        />

        <div
          className="header-clocks"
          title="Click a city to show only that exchange’s session shading; click again to show all venues in your list."
          aria-label="Session filters: click a city clock to shade the chart for that market only; click again to show all venues."
        >
          {CLOCKS.map(c => {
            const isSelected = selectedExchange === c.exchange
            const isUnselected = selectedExchange !== null && !isSelected
            return (
              <AnalogClock
                key={c.city}
                city={c.city}
                timezone={c.tz}
                offsetLabel={c.offset()}
                isOpen={isExchangeOpen(c.exchange)}
                scrubTime={hoveredTime}
                selected={isSelected}
                unselected={isUnselected}
                onClick={() => onSelectExchange?.(c.exchange)}
              />
            )
          })}
        </div>

        <div className="header-actions">
          <FearGreed
            leadingSlot={
              <>
                <button
                  type="button"
                  className="theme-toggle"
                  disabled={shotBusy || !onScreenshot}
                  onClick={() => {
                    if (!onScreenshot || shotBusy) return
                    setShotBusy(true)
                    void onScreenshot().finally(() => setShotBusy(false))
                  }}
                  aria-label="Save screenshot of the app as PNG"
                  title="Save screenshot (PNG)"
                >
                  <IconScreenshot />
                </button>
                <button
                  type="button"
                  className="theme-toggle"
                  onClick={onToggleTheme}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? <IconSun /> : <IconMoon />}
                </button>
              </>
            }
          />
        </div>
      </div>

      <div
        className={`header-hero-slot${rowOpen ? ' header-hero-slot--open' : ''}`}
        style={{ '--header-hero-duration': `${HEADER_HERO_MS}ms` } as CSSProperties}
      >
        <div className="header-hero-slot-inner">
          {hero && (
            <div
              className="header-hero"
              role="status"
              aria-live="polite"
              aria-label={[
                'Focused quote:',
                hero.ticker,
                hero.displayName || undefined,
                hero.venueLine,
                `${hero.displayPct >= 0 ? '+' : ''}${hero.displayPct.toFixed(2)} percent`,
                hero.priceLabel,
              ].filter(Boolean).join(' ')}
            >
              <div className="header-hero-inner">
                <div className="header-hero-led header-hero-led--row" aria-hidden>
                  <span className="header-hero-symbol">{hero.ticker}</span>
                  <span
                    className={`header-hero-company${hero.displayName ? '' : ' header-hero-company--placeholder'}`}
                  >
                    {hero.displayName || '—'}
                  </span>
                  <span className="header-hero-venue">{hero.venueLine}</span>
                </div>
                <div className="header-hero-stats">
                  <span className="header-hero-pct" style={hero.pctStyle}>
                    {hero.displayPct >= 0 ? '+' : ''}{hero.displayPct.toFixed(2)}%
                  </span>
                  {hero.priceLabel && (
                    <span className="header-hero-price">{hero.priceLabel}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
