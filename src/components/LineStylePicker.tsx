import { useState, useRef } from 'react'
import type { Holding, LineStyle } from '../types'
import ColorPicker from './ColorPicker'
import './LineStylePicker.css'

interface Props {
  holding: Holding
  onStyleChange: (patch: Partial<Pick<Holding, 'lineStyle' | 'lineThickness' | 'gradientColors'>>) => void
}

const LINE_STYLES: { value: LineStyle; label: string; dash: string }[] = [
  { value: 'solid',  label: 'Solid',  dash: 'none' },
  { value: 'dashed', label: 'Dashed', dash: '8 5'  },
  { value: 'dotted', label: 'Dotted', dash: '2 5'  },
]

const THICKNESSES: { value: number; label: string }[] = [
  { value: 1, label: 'Thin'   },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'Thick'  },
  { value: 4, label: 'Bold'   },
]

export default function LineStylePicker({ holding, onStyleChange }: Props) {
  const activeStyle    = holding.lineStyle     ?? 'solid'
  const activeThick    = holding.lineThickness ?? 2
  const gradColors     = holding.gradientColors ?? []

  // Which gradient stop colour-picker is open (0=none, 1=stop2, 2=stop3)
  const [gradPickerIdx, setGradPickerIdx] = useState<number>(0)
  // Nested colour-picker position
  const [gradPickerPos, setGradPickerPos] = useState<{ top: number; left: number } | null>(null)
  const stopBtnRefs = useRef<(HTMLButtonElement | null)[]>([null, null])

  const openGradPicker = (idx: number, btn: HTMLButtonElement | null) => {
    if (gradPickerIdx === idx + 1) {
      setGradPickerIdx(0)
      setGradPickerPos(null)
    } else {
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setGradPickerPos({ top: r.top, left: r.right + 8 })
      setGradPickerIdx(idx + 1)
    }
  }

  const updateGradStop = (idx: number, color: string) => {
    const next = [...gradColors] as [string, string] | [string, string, string] | string[]
    next[idx] = color
    onStyleChange({ gradientColors: next.length >= 3
      ? [next[0], next[1], next[2]] as [string, string, string]
      : [next[0], next[1]] as [string, string]
    })
  }

  const addGradStop = () => {
    if (gradColors.length === 0) {
      onStyleChange({ gradientColors: [holding.color, holding.color] })
    } else if (gradColors.length === 1) {
      onStyleChange({ gradientColors: [gradColors[0], holding.color] as [string, string] })
    } else {
      onStyleChange({ gradientColors: [gradColors[0], gradColors[1], holding.color] as [string, string, string] })
    }
  }

  const removeGradStop = (idx: number) => {
    if (gradPickerIdx === idx + 1) { setGradPickerIdx(0); setGradPickerPos(null) }
    const next = gradColors.filter((_, i) => i !== idx)
    if (next.length === 0) {
      onStyleChange({ gradientColors: undefined })
    } else {
      onStyleChange({ gradientColors: next as [string, string] | [string, string, string] })
    }
  }

  const gradientPreview = gradColors.length >= 1
    ? `linear-gradient(to right, ${[holding.color, ...gradColors].join(', ')})`
    : holding.color

  return (
    <div className="lsp">
      {/* Line style section */}
      <div className="lsp-section">
        <span className="lsp-label">Style</span>
        <div className="lsp-style-row">
          {LINE_STYLES.map(s => (
            <button
              key={s.value}
              type="button"
              className={`lsp-style-btn ${activeStyle === s.value ? 'active' : ''}`}
              onClick={() => onStyleChange({ lineStyle: s.value })}
              title={s.label}
              aria-pressed={activeStyle === s.value}
            >
              <svg viewBox="0 0 40 10" className="lsp-style-icon" aria-hidden>
                <line
                  x1="2" y1="5" x2="38" y2="5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={s.dash}
                />
              </svg>
              <span className="lsp-style-label">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Thickness section */}
      <div className="lsp-section">
        <span className="lsp-label">Thickness</span>
        <div className="lsp-thick-row">
          {THICKNESSES.map(t => (
            <button
              key={t.value}
              type="button"
              className={`lsp-thick-btn ${activeThick === t.value ? 'active' : ''}`}
              onClick={() => onStyleChange({ lineThickness: t.value })}
              title={t.label}
              aria-pressed={activeThick === t.value}
            >
              <svg viewBox="0 0 36 12" className="lsp-thick-icon" aria-hidden>
                <line
                  x1="2" y1="6" x2="34" y2="6"
                  stroke="currentColor"
                  strokeWidth={t.value}
                  strokeLinecap="round"
                />
              </svg>
              <span className="lsp-thick-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Gradient section */}
      <div className="lsp-section">
        <span className="lsp-label">Gradient</span>
        <div className="lsp-grad-row">
          {/* Primary colour — read-only swatch (use the swatch on the chip to change it) */}
          <div className="lsp-grad-stop lsp-grad-stop--primary" title="Primary colour (edit via chip swatch)">
            <span className="lsp-swatch" style={{ background: holding.color }} />
          </div>

          {/* Extra stops */}
          {gradColors.map((c, i) => (
            <div key={i} className="lsp-grad-stop">
              <button
                ref={el => { stopBtnRefs.current[i] = el }}
                type="button"
                className={`lsp-swatch lsp-swatch--btn ${gradPickerIdx === i + 1 ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => openGradPicker(i, stopBtnRefs.current[i])}
                aria-label={`Edit gradient colour stop ${i + 2}`}
              />
              <button
                type="button"
                className="lsp-grad-remove"
                onClick={() => removeGradStop(i)}
                aria-label={`Remove gradient colour stop ${i + 2}`}
                title="Remove stop"
              >
                ×
              </button>
            </div>
          ))}

          {/* Add stop button (up to 2 extra stops = 3 total) */}
          {gradColors.length < 2 && (
            <button
              type="button"
              className="lsp-grad-add"
              onClick={addGradStop}
              title="Add colour stop"
              aria-label="Add gradient colour stop"
            >
              +
            </button>
          )}
        </div>

        {/* Gradient preview bar */}
        {gradColors.length > 0 && (
          <div className="lsp-grad-preview" style={{ background: gradientPreview }} />
        )}
      </div>

      {/* Nested colour picker for gradient stops — absolutely positioned */}
      {gradPickerIdx > 0 && gradPickerPos && (
        <div
          className="lsp-nested-picker"
          style={{ position: 'fixed', top: gradPickerPos.top, left: gradPickerPos.left, zIndex: 10001 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <ColorPicker
            color={gradColors[gradPickerIdx - 1] ?? holding.color}
            onChange={c => updateGradStop(gradPickerIdx - 1, c)}
          />
        </div>
      )}
    </div>
  )
}
