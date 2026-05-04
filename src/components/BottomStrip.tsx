import { useState, useRef, useEffect, useCallback } from 'react'
import type { Holding, SeriesData, Theme, TimeRange } from '../types'
import { pctToColor } from '../utils/colors'
import LineStylePicker from './LineStylePicker'
import Portal from './Portal'
import './BottomStrip.css'

interface Props {
  holdings: Holding[]
  seriesData: Record<string, SeriesData>
  focusedId: string | null
  theme: Theme
  hoveredTime?: number | null
  onFocus: (id: string) => void
  onResetFocus?: () => void
  onColorChange: (id: string, color: string) => void
  onStyleChange: (id: string, patch: Partial<Pick<Holding, 'lineStyle' | 'lineThickness' | 'gradientColors'>>) => void
  onAdd: (ticker: string) => void
  onRemove: (id: string) => void
  tickerErrors?: Record<string, string>
  timeRange: TimeRange
  pctFootnoteHidden: boolean
  onPctFootnoteHiddenChange: (hidden: boolean) => void
}

/** Binary-search for the nearest data point to `targetTime` */
function nearestPct(points: SeriesData['points'], targetTime: number): number | null {
  if (points.length === 0) return null
  let lo = 0, hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].time < targetTime) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(points[lo - 1].time - targetTime) < Math.abs(points[lo].time - targetTime)) {
    return points[lo - 1].value
  }
  return points[lo].value
}

function formatPrice(price: number, currency: string | undefined): string {
  if (!currency) return price.toFixed(2)
  if (currency === 'USD') return `$${price.toFixed(2)}`
  if (currency === 'GBP') return `£${price.toFixed(2)}`
  if (currency === 'GBp' || currency === 'GBX') return `${Math.round(price)}p`
  if (currency === 'EUR') return `€${price.toFixed(2)}`
  return price.toFixed(2)
}

interface AnimatedPct {
  displayed: number
  target: number
}

interface SearchResult {
  symbol: string
  name: string
  exchange: string
  type: string
}

interface PopupPos {
  top: number
  left: number
  right: number
  bottom: number
}

/** Used only for the line-appearance panel (still needs a portal above the chart). */
function useAnchoredPopup(anchorRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<PopupPos | null>(null)

  const update = useCallback(() => {
    const el = anchorRef.current
    if (!el) { setPos(null); return }
    const r = el.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - r.top + 8,
      top: r.top,
      left: r.left,
      right: window.innerWidth - r.right,
    })
  }, [anchorRef])

  useEffect(() => {
    if (!pos) return
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [pos, update])

  return { pos, open: update, close: () => setPos(null) }
}

function pctFootnote(timeRange: TimeRange): { short: string; detail: string } {
  if (timeRange === '1D') {
    return {
      short: '% vs yesterday\'s close (pre-market), then vs session open once trading starts.',
      detail: 'Extended hours use the previous closing price as the baseline. Regular trading hours use the official opening price for that session.',
    }
  }
  return {
    short: `% change from each line's first price in the ${timeRange} window.`,
    detail: 'The baseline is the first reliable closing price at the start of the period you selected.',
  }
}

export default function BottomStrip({
  holdings, seriesData, focusedId, theme, hoveredTime,
  onFocus, onResetFocus, onColorChange, onStyleChange, onAdd, onRemove,
  tickerErrors = {},
  timeRange,
}: Props) {
  const [stylePickerId, setStylePickerId] = useState<string | null>(null)
  const [addInput, setAddInput] = useState('')
  const [animPcts, setAnimPcts] = useState<Record<string, AnimatedPct>>({})
  const rafRef = useRef<number | null>(null)
  const animPctsRef = useRef<Record<string, AnimatedPct>>({})
  const swatchRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Search state — dropdown is absolutely positioned, no portal needed
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Line-appearance picker still uses a portal to float above the chart
  const styleAnchorRef = useRef<HTMLButtonElement | null>(null)
  const lineAppearancePopupRef = useRef<HTMLDivElement | null>(null)
  const stylePopup = useAnchoredPopup(styleAnchorRef)

  // --- pct animation ---
  useEffect(() => {
    setAnimPcts(prev => {
      const next = { ...prev }
      for (const h of holdings) {
        const target = seriesData[h.id]?.latestPct ?? 0
        if (!next[h.id]) {
          next[h.id] = { displayed: target, target }
        } else {
          next[h.id] = { ...next[h.id], target }
        }
      }
      return next
    })
  }, [seriesData, holdings])

  useEffect(() => { animPctsRef.current = animPcts }, [animPcts])

  useEffect(() => {
    let lastTime: number | null = null
    const animate = (time: number) => {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0.016
      lastTime = time
      const curr = animPctsRef.current
      let needsUpdate = false
      const next: Record<string, AnimatedPct> = {}
      for (const [id, anim] of Object.entries(curr)) {
        const diff = anim.target - anim.displayed
        if (Math.abs(diff) < 0.001) {
          next[id] = { ...anim, displayed: anim.target }
        } else {
          next[id] = { ...anim, displayed: anim.displayed + diff * Math.min(dt * 3, 1) }
          needsUpdate = true
        }
      }
      if (needsUpdate) setAnimPcts(next)
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  // --- search ---
  const runSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setSearchResults([]); setSearchOpen(false); return }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      const results = data.results ?? []
      setSearchResults(results)
      setSearchOpen(results.length > 0)
      setHighlightedIdx(-1)
    } catch {
      setSearchResults([])
      setSearchOpen(false)
    } finally {
      setSearchLoading(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase()
    setAddInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length === 0) { setSearchResults([]); setSearchOpen(false); return }
    debounceRef.current = setTimeout(() => runSearch(val), 220)
  }

  const selectResult = (result: SearchResult) => {
    onAdd(result.symbol)
    setAddInput('')
    setSearchResults([])
    setSearchOpen(false)
    setHighlightedIdx(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIdx(i => Math.min(i + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchOpen && highlightedIdx >= 0 && searchResults[highlightedIdx]) {
        selectResult(searchResults[highlightedIdx])
      } else if (addInput.trim()) {
        onAdd(addInput.trim())
        setAddInput('')
        setSearchResults([])
        setSearchOpen(false)
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false)
      setHighlightedIdx(-1)
    }
  }

  // Blur closes the dropdown — mousedown on a result fires first (onMouseDown), selecting it
  const handleInputBlur = () => {
    setTimeout(() => setSearchOpen(false), 160)
  }

  const handleInputFocus = () => {
    if (searchResults.length > 0) setSearchOpen(true)
  }

  // --- line-appearance picker ---
  const openLineAppearance = (id: string, btn: HTMLButtonElement) => {
    if (stylePickerId === id) {
      setStylePickerId(null)
      stylePopup.close()
    } else {
      setStylePickerId(id)
      styleAnchorRef.current = btn
      stylePopup.open()
    }
  }

  // Close picker on mousedown outside the floating panel and outside the active swatch
  useEffect(() => {
    if (!stylePickerId) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      const inPopup = lineAppearancePopupRef.current?.contains(t) ?? false
      const activeSwatch = swatchRefs.current[stylePickerId]
      const onActiveSwatch = activeSwatch?.contains(t) ?? false
      if (!inPopup && !onActiveSwatch) {
        setStylePickerId(null)
        stylePopup.close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [stylePickerId, stylePopup])

  useEffect(() => {
    if (!stylePickerId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStylePickerId(null)
        stylePopup.close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [stylePickerId, stylePopup])

  // Keyboard scroll for highlighted search item
  useEffect(() => {
    if (highlightedIdx >= 0 && dropdownRef.current) {
      const item = dropdownRef.current.children[highlightedIdx] as HTMLElement
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIdx])

  const note = pctFootnote(timeRange)
  const tooltipText = `${note.short}\n\n${note.detail}`

  const isEmpty = holdings.length === 0

  return (
    <div className="strip">

      {/* Reset-focus × — only meaningful when something is focused */}
      <button
        className="strip-reset"
        onClick={e => { e.stopPropagation(); onResetFocus?.() }}
        disabled={focusedId === null}
        aria-label="Show all tickers"
        title="Show all"
      >
        ×
      </button>

      {/* Scrollable ticker chips */}
      <div className="strip-chips" role="list">
        {holdings.map(h => {
          const anim = animPcts[h.id] ?? { displayed: 0, target: 0 }
          const pct = anim.displayed
          const pctColor = pctToColor(pct, theme)
          const isFocused = focusedId === h.id
          const isDimmed  = focusedId !== null && !isFocused

          let hoveredPrice: string | null = null
          if (hoveredTime != null) {
            const sd = seriesData[h.id]
            if (sd?.openPrice != null && sd.points.length > 0) {
              const hovPct = nearestPct(sd.points, hoveredTime)
              if (hovPct !== null) {
                hoveredPrice = formatPrice(sd.openPrice * (1 + hovPct / 100), sd.currency)
              }
            }
          }

          const errMsg = tickerErrors[h.id]

          return (
            <div
              key={h.id}
              role="listitem"
              className={`strip-chip${isFocused ? ' focused' : ''}${isDimmed ? ' dimmed' : ''}`}
              onClick={() => onFocus(h.id)}
              title={errMsg ? `Data error: ${errMsg}` : undefined}
            >
              {/* Color swatch — opens line appearance picker */}
              <button
                type="button"
                className={`swatch${stylePickerId === h.id ? ' swatch--open' : ''}`}
                style={{
                  background: h.gradientColors?.length
                    ? `linear-gradient(to right, ${[h.color, ...h.gradientColors].join(', ')})`
                    : h.color,
                }}
                ref={el => { swatchRefs.current[h.id] = el }}
                onClick={e => {
                  e.stopPropagation()
                  const btn = swatchRefs.current[h.id]
                  if (btn) openLineAppearance(h.id, btn)
                }}
                aria-label={`Line appearance for ${h.ticker}`}
                aria-expanded={stylePickerId === h.id}
                title="Line & colour"
              />

              <span className="chip-ticker">{h.ticker}</span>
              <span className="chip-exch">{h.exchange}</span>

              {/* % and hover price always on same line — no height change */}
              <span className="chip-pct" style={{ color: pctColor }}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                {hoveredPrice && (
                  <span className="chip-price"> · {hoveredPrice}</span>
                )}
              </span>

              <button
                className="chip-remove"
                onClick={e => { e.stopPropagation(); onRemove(h.id) }}
                aria-label={`Remove ${h.ticker}`}
                tabIndex={-1}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {/* % info tooltip — no inline footnote row; strip stays single-height */}
      {!isEmpty && (
        <button
          type="button"
          className="strip-info"
          title={tooltipText}
          aria-label="About percentage changes"
        >
          ?
        </button>
      )}

      {/* Add ticker input with inline dropdown (no portal, no position calculation) */}
      <div className={`strip-add${isEmpty ? ' strip-add--hint' : ''}`}>
        <div className="strip-search-wrap">
          <input
            ref={inputRef}
            className="strip-input"
            placeholder={isEmpty ? 'Add a ticker to get started…' : 'Add ticker…'}
            value={addInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            maxLength={16}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Search for a ticker"
            aria-autocomplete="list"
            aria-expanded={searchOpen}
            aria-haspopup="listbox"
          />

          {searchLoading && <span className="strip-search-spinner" aria-hidden />}

          {/* Dropdown — absolute within strip-search-wrap, above the strip */}
          {searchOpen && searchResults.length > 0 && (
            <div
              className="strip-dropdown"
              ref={dropdownRef}
              role="listbox"
              aria-label="Search results"
            >
              {searchResults.map((r, i) => (
                <button
                  key={r.symbol}
                  role="option"
                  aria-selected={i === highlightedIdx}
                  className={`strip-dropdown-item${i === highlightedIdx ? ' highlighted' : ''}`}
                  onMouseDown={e => { e.preventDefault(); selectResult(r) }}
                  onMouseEnter={() => setHighlightedIdx(i)}
                >
                  <span className="sd-symbol">{r.symbol}</span>
                  <span className="sd-name">{r.name}</span>
                  <span className="sd-exchange">{r.exchange}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Line-appearance portal (needs to float above the chart canvas) */}
      {stylePickerId && stylePopup.pos && (() => {
        const h = holdings.find(hh => hh.id === stylePickerId)
        if (!h) return null
        return (
          <Portal>
            <div
              ref={lineAppearancePopupRef}
              className="portal-popup"
              style={{
                position: 'fixed',
                bottom: stylePopup.pos!.bottom,
                left: stylePopup.pos!.left,
                zIndex: 9999,
              }}
            >
              <LineStylePicker
                key={h.id}
                holding={h}
                onPrimaryColorChange={c => onColorChange(stylePickerId, c)}
                onStyleChange={patch => onStyleChange(stylePickerId, patch)}
              />
            </div>
          </Portal>
        )
      })()}
    </div>
  )
}
