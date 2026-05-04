import { useState, useEffect, useId, useMemo } from 'react'
import type { Holding, LineStyle } from '../types'
import ColorPicker from './ColorPicker'
import { gradientCompanion, mixHex } from '../utils/colors'
import './LineStylePicker.css'

type ColorFocus = 'primary' | number

interface Props {
  holding: Holding
  onPrimaryColorChange: (color: string) => void
  onStyleChange: (patch: Partial<Pick<Holding, 'lineStyle' | 'lineThickness' | 'gradientColors'>>) => void
}

const LINE_STYLES: { value: LineStyle; label: string; dash: string | undefined }[] = [
  { value: 'solid', label: 'Solid', dash: undefined },
  { value: 'dashed', label: 'Dashed', dash: '11 9' },
  { value: 'dotted', label: 'Dotted', dash: '2 7' },
]

const THICKNESSES: { value: number; label: string }[] = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'Thick' },
  { value: 4, label: 'Bold' },
]

function gradientPatchFromArray(arr: string[]): Holding['gradientColors'] {
  if (arr.length === 1) return [arr[0]!]
  if (arr.length === 2) return [arr[0]!, arr[1]!]
  return [arr[0]!, arr[1]!, arr[2]!]
}

export default function LineStylePicker({ holding, onPrimaryColorChange, onStyleChange }: Props) {
  const uid = useId().replace(/:/g, '')
  const activeStyle = holding.lineStyle ?? 'solid'
  const activeThick = holding.lineThickness ?? 2
  const grad = holding.gradientColors ?? []
  const isGradient = grad.length > 0

  const [colorFocus, setColorFocus] = useState<ColorFocus>('primary')

  const strokeStops = useMemo(
    () => (isGradient ? [holding.color, ...grad] : [holding.color, holding.color]),
    [isGradient, holding.color, grad],
  )

  const gradPreviewCss = useMemo(() => {
    if (!isGradient || strokeStops.length < 2) return holding.color
    return `linear-gradient(to right, ${strokeStops.join(', ')})`
  }, [isGradient, strokeStops, holding.color])

  useEffect(() => {
    setColorFocus('primary')
  }, [holding.id])

  useEffect(() => {
    if (colorFocus === 'primary') return
    if (typeof colorFocus === 'number' && (colorFocus < 0 || colorFocus >= grad.length)) {
      setColorFocus('primary')
    }
  }, [colorFocus, grad.length])

  const setSolid = () => {
    onStyleChange({ gradientColors: undefined })
    setColorFocus('primary')
  }

  const setGradientTwo = () => {
    onStyleChange({ gradientColors: [gradientCompanion(holding.color)] })
    setColorFocus(0)
  }

  const setThreeStops = () => {
    if (grad.length === 1) {
      const end = grad[0]!
      onStyleChange({
        gradientColors: [mixHex(holding.color, end, 0.5), end],
      })
      setColorFocus(0)
    }
  }

  const setTwoStops = () => {
    if (grad.length === 2) {
      onStyleChange({ gradientColors: [grad[1]!] })
      setColorFocus(0)
    }
  }

  const updateGradStop = (idx: number, hex: string) => {
    const next = [...grad]
    next[idx] = hex
    onStyleChange({ gradientColors: gradientPatchFromArray(next) })
  }

  const pickerColor =
    colorFocus === 'primary'
      ? holding.color
      : grad[colorFocus] ?? holding.color

  const applyPickerColor = (hex: string) => {
    if (colorFocus === 'primary') onPrimaryColorChange(hex)
    else if (typeof colorFocus === 'number') updateGradStop(colorFocus, hex)
  }

  const stopLabel =
    colorFocus === 'primary'
      ? 'Line start'
      : grad.length === 1 && colorFocus === 0
        ? 'Line end'
        : grad.length === 2 && colorFocus === 0
          ? 'Middle'
          : grad.length === 2 && colorFocus === 1
            ? 'Line end'
            : `Stop ${colorFocus + 2}`

  const gradId = `lsp-grad-${uid}`
  const nStops = strokeStops.length

  return (
    <div className="lsp">
      <p className="lsp-heading">Line appearance</p>

      <div
        className="lsp-preview-wrap"
        role="img"
        aria-label="Preview of line stroke, weight, and colours"
      >
        <svg
          className="lsp-preview-svg"
          viewBox="0 0 220 22"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              {strokeStops.map((c, i) => (
                <stop
                  key={i}
                  offset={`${nStops <= 1 ? 0 : (i / (nStops - 1)) * 100}%`}
                  stopColor={c}
                />
              ))}
            </linearGradient>
          </defs>
          <line
            x1="6"
            y1="11"
            x2="214"
            y2="11"
            stroke={`url(#${gradId})`}
            strokeWidth={activeThick}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={LINE_STYLES.find(s => s.value === activeStyle)?.dash}
          />
        </svg>
      </div>

      <div className="lsp-block">
        <span className="lsp-sublabel">Stroke</span>
        <div className="lsp-seg-row">
          {LINE_STYLES.map(s => (
            <button
              key={s.value}
              type="button"
              className={`lsp-seg ${activeStyle === s.value ? 'is-on' : ''}`}
              onClick={() => onStyleChange({ lineStyle: s.value })}
              aria-pressed={activeStyle === s.value}
            >
              {s.label}
            </button>
          ))}
        </div>

        <span className="lsp-sublabel lsp-sublabel--gap">Weight</span>
        <div className="lsp-weight-row">
          {THICKNESSES.map(t => (
            <button
              key={t.value}
              type="button"
              className={`lsp-weight ${activeThick === t.value ? 'is-on' : ''}`}
              onClick={() => onStyleChange({ lineThickness: t.value })}
              aria-pressed={activeThick === t.value}
              title={t.label}
            >
              <span className="lsp-weight-barwrap" aria-hidden>
                <span className="lsp-weight-bar" data-w={t.value} />
              </span>
              <span className="lsp-weight-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="lsp-block">
        <span className="lsp-sublabel">Colour</span>
        <div className="lsp-seg-row">
          <button
            type="button"
            className={`lsp-seg ${!isGradient ? 'is-on' : ''}`}
            onClick={setSolid}
            aria-pressed={!isGradient}
          >
            Solid
          </button>
          <button
            type="button"
            className={`lsp-seg ${isGradient ? 'is-on' : ''}`}
            onClick={() => {
              if (!isGradient) setGradientTwo()
            }}
            aria-pressed={isGradient}
          >
            Gradient
          </button>
        </div>

        {isGradient && (
          <>
            <div className="lsp-ramp-wrap">
              <div className="lsp-ramp-inner">
                <div className="lsp-ramp-track" style={{ background: gradPreviewCss }} />
                <div className="lsp-ramp-stops">
                  <button
                    type="button"
                    className={`lsp-ramp-dot ${colorFocus === 'primary' ? 'is-on' : ''}`}
                    style={{ left: '0%', background: holding.color }}
                    onClick={() => setColorFocus('primary')}
                    aria-label="Line start colour"
                    title="Start"
                  />
                  {grad.map((c, i) => {
                    const posPct = nStops <= 1 ? 100 : (100 * (i + 1)) / (nStops - 1)
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`lsp-ramp-dot ${colorFocus === i ? 'is-on' : ''}`}
                        style={{ left: `${posPct}%`, background: c }}
                        onClick={() => setColorFocus(i)}
                        aria-label={
                          grad.length === 1 && i === 0
                            ? 'Line end colour'
                            : grad.length === 2 && i === 0
                              ? 'Middle colour'
                              : `Colour stop ${i + 2}`
                        }
                        title={
                          grad.length === 1 ? 'End' : grad.length === 2 && i === 0 ? 'Middle' : 'End'
                        }
                      />
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="lsp-grad-tools">
              {grad.length === 1 ? (
                <button type="button" className="lsp-mini-btn" onClick={setThreeStops}>
                  Add middle colour
                </button>
              ) : (
                <button type="button" className="lsp-mini-btn" onClick={setTwoStops}>
                  Two colours only
                </button>
              )}
            </div>

            <div className="lsp-picker-embed">
              <p className="lsp-picker-cap">{stopLabel}</p>
              <ColorPicker color={pickerColor} onChange={applyPickerColor} />
            </div>
          </>
        )}

        {!isGradient && (
          <div className="lsp-picker-embed lsp-picker-embed--solo">
            <p className="lsp-picker-cap">Line colour</p>
            <ColorPicker color={holding.color} onChange={onPrimaryColorChange} />
          </div>
        )}
      </div>
    </div>
  )
}
