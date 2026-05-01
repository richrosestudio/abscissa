import { useState, useRef, useEffect, useCallback } from 'react'
import type { Holding, SeriesData, Theme } from '../types'
import { pctToColor } from '../utils/colors'
import ColorPicker from './ColorPicker'
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
  onAdd: (ticker: string) => void
  onRemove: (id: string) => void
}

/** Binary-search for the point in a sorted series closest to targetTime */
function nearestPct(points: SeriesData['points'], targetTime: number): number | null {
  if (points.length === 0) return null
  let lo = 0, hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].time < targetTime) lo = mid + 1
    else hi = mid
  }
  // Check both sides of the boundary
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

function useAnchoredPopup(anchorRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<PopupPos | null>(null)

  const update = useCallback(() => {
    const el = anchorRef.current
    if (!el) { setPos(null); return }
    const r = el.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - r.top + 6,
      top: r.top,
      left: r.left,
      right: window.innerWidth - r.right,
    })
  }, [anchorRef])

  useEffect(() => {
    if (!pos) return
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [pos, update])

  return { pos, open: update, close: () => setPos(null) }
}

export default function BottomStrip({
  holdings, seriesData, focusedId, theme, hoveredTime,
  onFocus, onResetFocus, onColorChange, onAdd, onRemove,
}: Props) {
  const [colorPickerId, setColorPickerId] = useState<string | null>(null)
  const [addInput, setAddInput] = useState('')
  const [animPcts, setAnimPcts] = useState<Record<string, AnimatedPct>>({})
  const rafRef = useRef<number | null>(null)
  const animPctsRef = useRef<Record<string, AnimatedPct>>({})
  const swatchRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputWrapRef = useRef<HTMLDivElement>(null)

  // Portal position for search dropdown
  const searchAnchor = useAnchoredPopup(inputWrapRef as React.RefObject<HTMLElement | null>)

  // Portal position for colour picker
  const colorAnchorRef = useRef<HTMLButtonElement | null>(null)
  const colorPopup = useAnchoredPopup(colorAnchorRef)

  // Sync pct animation targets
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

  // Debounced search
  const runSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setSearchResults([]); setSearchOpen(false); return }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      const results = data.results ?? []
      setSearchResults(results)
      if (results.length > 0) {
        setSearchOpen(true)
        searchAnchor.open()
      } else {
        setSearchOpen(false)
        searchAnchor.close()
      }
      setHighlightedIdx(-1)
    } catch {
      setSearchResults([])
      setSearchOpen(false)
      searchAnchor.close()
    } finally {
      setSearchLoading(false)
    }
  }, [searchAnchor])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase()
    setAddInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length === 0) { setSearchResults([]); setSearchOpen(false); searchAnchor.close(); return }
    debounceRef.current = setTimeout(() => runSearch(val), 220)
  }

  const selectResult = (result: SearchResult) => {
    onAdd(result.symbol)
    setAddInput('')
    setSearchResults([])
    setSearchOpen(false)
    searchAnchor.close()
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
        searchAnchor.close()
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false)
      searchAnchor.close()
    }
  }

  const openColorPicker = (id: string, btn: HTMLButtonElement) => {
    if (colorPickerId === id) {
      setColorPickerId(null)
      colorPopup.close()
    } else {
      setColorPickerId(id)
      colorAnchorRef.current = btn
      colorPopup.open()
    }
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      // Check if click is inside any portal popup or the strip itself
      const inStrip = document.querySelector('.strip')?.contains(t)
      const inPortals = document.querySelectorAll('.portal-popup')
      let inPortal = false
      inPortals.forEach(p => { if (p.contains(t)) inPortal = true })
      if (!inStrip && !inPortal) {
        setColorPickerId(null)
        colorPopup.close()
        setSearchOpen(false)
        searchAnchor.close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colorPopup, searchAnchor])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIdx >= 0 && dropdownRef.current) {
      const item = dropdownRef.current.children[highlightedIdx] as HTMLElement
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIdx])

  return (
    <div className="strip">
      <button
        className={`strip-reset ${focusedId === null ? 'disabled' : ''}`}
        onClick={e => {
          e.stopPropagation()
          onResetFocus?.()
        }}
        disabled={focusedId === null}
        aria-label="Show all tickers"
        title="Show all tickers"
      >
        ×
      </button>

      <div className="strip-items">
        {holdings.map(h => {
          const anim = animPcts[h.id] ?? { displayed: 0, target: 0 }
          const pct = anim.displayed
          const pctColor = pctToColor(pct, theme)
          const isFocused = focusedId === h.id
          const isDimmed = focusedId !== null && !isFocused

          // Compute hovered price if applicable
          const sd = seriesData[h.id]
          let hoveredPrice: string | null = null
          if (hoveredTime != null && sd?.openPrice != null && sd.points.length > 0) {
            const hovPct = nearestPct(sd.points, hoveredTime)
            if (hovPct !== null) {
              const price = sd.openPrice * (1 + hovPct / 100)
              hoveredPrice = formatPrice(price, sd.currency)
            }
          }

          return (
            <div
              key={h.id}
              className={`strip-item ${isFocused ? 'focused' : ''} ${isDimmed ? 'dimmed' : ''}`}
              onClick={() => onFocus(h.id)}
            >
              <div className="swatch-wrap">
                <button
                  className="swatch"
                  style={{ background: h.color }}
                  ref={el => { swatchRefs.current[h.id] = el }}
                  onClick={e => {
                    e.stopPropagation()
                    const btn = swatchRefs.current[h.id]
                    if (btn) openColorPicker(h.id, btn)
                  }}
                  aria-label={`Change colour for ${h.ticker}`}
                />
              </div>

              <span className="strip-ticker">{h.ticker}</span>
              <span className="strip-exchange">{h.exchange}</span>

              <div className="strip-pct-wrap">
                <span className="strip-pct" style={{ color: pctColor }}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </span>
                {hoveredPrice && (
                  <span className="strip-price">{hoveredPrice}</span>
                )}
              </div>

              <button
                className="strip-remove"
                onClick={e => { e.stopPropagation(); onRemove(h.id) }}
                aria-label={`Remove ${h.ticker}`}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {/* Add input */}
      <div className="strip-add">
        <div className="strip-search-wrap" ref={inputWrapRef}>
          <input
            ref={inputRef}
            className="strip-input"
            placeholder="Add ticker…"
            value={addInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (searchResults.length > 0) { setSearchOpen(true); searchAnchor.open() } }}
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
          />
          {searchLoading && <span className="strip-search-spinner" />}
        </div>
      </div>

      {/* Portalled: search dropdown — right-anchored to input right edge */}
      {searchOpen && searchResults.length > 0 && searchAnchor.pos && (
        <Portal>
          <div
            className="portal-popup strip-dropdown"
            ref={dropdownRef}
            style={{
              position: 'fixed',
              bottom: searchAnchor.pos.bottom,
              right: searchAnchor.pos.right,
              zIndex: 9999,
            }}
          >
            {searchResults.map((r, i) => (
              <button
                key={r.symbol}
                className={`strip-dropdown-item ${i === highlightedIdx ? 'highlighted' : ''}`}
                onMouseDown={e => { e.preventDefault(); selectResult(r) }}
                onMouseEnter={() => setHighlightedIdx(i)}
              >
                <span className="sd-symbol">{r.symbol}</span>
                <span className="sd-name">{r.name}</span>
                <span className="sd-exchange">{r.exchange}</span>
              </button>
            ))}
          </div>
        </Portal>
      )}

      {/* Portalled: colour picker — left-anchored to swatch left edge */}
      {colorPickerId && colorPopup.pos && (
        <Portal>
          <div
            className="portal-popup color-picker-portal"
            style={{
              position: 'fixed',
              bottom: colorPopup.pos.bottom,
              left: colorPopup.pos.left,
              zIndex: 9999,
            }}
          >
            <ColorPicker
              color={holdings.find(h => h.id === colorPickerId)?.color ?? '#6366f1'}
              onChange={c => onColorChange(colorPickerId, c)}
            />
          </div>
        </Portal>
      )}
    </div>
  )
}
