import { useState, useEffect, useId, useMemo } from 'react'
import type { Holding, LineStyle } from '../types'
import ColorPicker from './ColorPicker'
import { gradientCompanion, mixHex, DEFAULT_PALETTE } from '../utils/colors'
import './LineStylePicker.css'

type ColorFocus = 'primary' | 'dot' | number

interface Props {
  holding: Holding
  onPrimaryColorChange: (color: string) => void
  onDotColorChange: (color: string | undefined) => void
  onStyleChange: (patch: Partial<Pick<Holding, 'lineStyle' | 'lineThickness' | 'gradientColors'>>) => void
  onLinearChange: (linear: boolean) => void
  onOpacityChange: (opacity: number) => void
}

const LINE_STYLES: { value: LineStyle; label: string; dash: string | undefined }[] = [
  { value: 'solid', label: 'Solid', dash: undefined },
  { value: 'dashed', label: 'Dashed', dash: '10 8' },
  { value: 'dotted', label: 'Dotted', dash: '2 6' },
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

const PREVIEW_CURVE =
  'M 8 36 C 50 36 60 22 90 20 C 120 18 130 28 160 24 C 190 20 200 10 240 8 C 270 6 280 12 308 10'
const PREVIEW_SHARP_POINTS = '8,36 90,20 160,24 240,8 308,10'

export default function LineStylePicker({
  holding,
  onPrimaryColorChange,
  onDotColorChange,
  onStyleChange,
  onLinearChange,
  onOpacityChange,
}: Props) {
  const uid = useId().replace(/:/g, '')
  const activeStyle = holding.lineStyle ?? 'solid'
  const activeThick = holding.lineThickness ?? 2
  const grad = holding.gradientColors ?? []
  const isGradient = grad.length > 0
  const activeDotColor = holding.dotColor ?? holding.color
  const isLinear = holding.linear ?? false
  const activeOpacity = holding.lineOpacity ?? 1

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
    if (colorFocus === 'primary' || colorFocus === 'dot') return
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
      onStyleChange({ gradientColors: [mixHex(holding.color, end, 0.5), end] })
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
      : colorFocus === 'dot'
        ? activeDotColor
        : grad[colorFocus as number] ?? holding.color

  const applyPickerColor = (hex: string) => {
    if (colorFocus === 'primary') onPrimaryColorChange(hex)
    else if (colorFocus === 'dot') onDotColorChange(hex)
    else if (typeof colorFocus === 'number') updateGradStop(colorFocus, hex)
  }

  const onPresetClick = (c: string) => {
    if (colorFocus === 'dot') {
      onPrimaryColorChange(c)
      setColorFocus('primary')
      return
    }
    if (colorFocus === 'primary') {
      onPrimaryColorChange(c)
      return
    }
    if (typeof colorFocus === 'number') {
      updateGradStop(colorFocus, c)
    }
  }

  const previewGradId = `lsp-prev-grad-${uid}`
  const nStops = strokeStops.length
  const dotIsCustom = holding.dotColor != null
  const opacityPct = Math.round(activeOpacity * 100)
  const dashSpec = LINE_STYLES.find(s => s.value === activeStyle)?.dash
  const previewStrokeW = activeThick * 1.4 + 0.5

  return (
    <div className="lsp">
      <p className="lsp-heading">Line appearance</p>

      <div className="lsp-body">
        <div className="lsp-col lsp-col--controls">
          <div
            className="lsp-preview-wrap"
            role="img"
            aria-label={`Preview: ${isLinear ? 'sharp segments' : 'smooth curve'}, ${activeStyle} stroke`}
          >
            <svg className="lsp-preview-svg" viewBox="0 0 320 44" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id={previewGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  {strokeStops.map((c, i) => (
                    <stop
                      key={i}
                      offset={`${nStops <= 1 ? 0 : (i / (nStops - 1)) * 100}%`}
                      stopColor={c}
                      stopOpacity={activeOpacity}
                    />
                  ))}
                </linearGradient>
              </defs>
              {isLinear ? (
                <polyline
                  points={PREVIEW_SHARP_POINTS}
                  stroke={`url(#${previewGradId})`}
                  strokeWidth={previewStrokeW}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={dashSpec}
                  fill="none"
                />
              ) : (
                <path
                  d={PREVIEW_CURVE}
                  stroke={`url(#${previewGradId})`}
                  strokeWidth={previewStrokeW}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={dashSpec}
                  fill="none"
                />
              )}
              <circle cx="308" cy="10" r="5" fill={activeDotColor} opacity={activeOpacity} />
            </svg>
          </div>

          <div className="lsp-block lsp-block--controls">
            <div className="lsp-controls-main">
              <span className="lsp-sublabel">Style</span>
              <div className="lsp-stroke-row">
                {LINE_STYLES.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    className={`lsp-stroke-btn ${activeStyle === s.value ? 'is-on' : ''}`}
                    onClick={() => onStyleChange({ lineStyle: s.value })}
                    aria-pressed={activeStyle === s.value}
                    title={s.label}
                  >
                    <svg viewBox="0 0 48 14" className="lsp-stroke-svg" aria-hidden>
                      <line
                        x1="4"
                        y1="7"
                        x2="44"
                        y2="7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray={s.dash}
                      />
                    </svg>
                    <span className="lsp-opt-label">{s.label}</span>
                  </button>
                ))}
              </div>

              <span className="lsp-sublabel lsp-sublabel--gap">Curve</span>
              <div className="lsp-seg-row lsp-curve-row">
                <button
                  type="button"
                  className={`lsp-seg ${!isLinear ? 'is-on' : ''}`}
                  onClick={() => onLinearChange(false)}
                  aria-pressed={!isLinear}
                >
                  <svg viewBox="0 0 40 14" className="lsp-curve-svg" aria-hidden>
                    <path
                      d="M 3 11 C 12 11 15 3 20 3 C 25 3 28 11 37 11"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </svg>
                  Smooth
                </button>
                <button
                  type="button"
                  className={`lsp-seg ${isLinear ? 'is-on' : ''}`}
                  onClick={() => onLinearChange(true)}
                  aria-pressed={isLinear}
                >
                  <svg viewBox="0 0 40 14" className="lsp-curve-svg" aria-hidden>
                    <polyline
                      points="3,11 12,3 22,9 32,4 37,4"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Sharp
                </button>
              </div>

              <span className="lsp-sublabel lsp-sublabel--gap">Weight</span>
              <div className="lsp-weight-row">
                {THICKNESSES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    className={`lsp-weight-btn ${activeThick === t.value ? 'is-on' : ''}`}
                    onClick={() => onStyleChange({ lineThickness: t.value })}
                    aria-pressed={activeThick === t.value}
                    title={t.label}
                  >
                    <svg viewBox="0 0 36 14" className="lsp-weight-svg" aria-hidden>
                      <line
                        x1="4"
                        y1="7"
                        x2="32"
                        y2="7"
                        stroke="currentColor"
                        strokeWidth={t.value * 1.3 + 0.5}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="lsp-opt-label">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="lsp-controls-footer">
              <div className="lsp-opacity-row">
                <span className="lsp-sublabel lsp-sublabel--plain">Opacity</span>
                <span className="lsp-opacity-readout">{opacityPct}%</span>
              </div>
              <div className="lsp-slider-wrap">
                <input
                  type="range"
                  className="lsp-slider"
                  min={10}
                  max={100}
                  step={5}
                  value={opacityPct}
                  onChange={e => onOpacityChange(Number(e.target.value) / 100)}
                  aria-label="Line opacity"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="lsp-col lsp-col--colors">
          <div className="lsp-block lsp-block--colour">
            <span className="lsp-sublabel">Line colour</span>
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
                              grad.length === 1
                                ? 'Line end colour'
                                : i === 0
                                  ? 'Middle colour'
                                  : 'Line end colour'
                            }
                            title={grad.length === 1 ? 'End' : i === 0 ? 'Middle' : 'End'}
                          />
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div className="lsp-grad-tools">
                  {grad.length === 1 ? (
                    <button type="button" className="lsp-mini-btn" onClick={setThreeStops}>
                      Add middle stop
                    </button>
                  ) : (
                    <button type="button" className="lsp-mini-btn" onClick={setTwoStops}>
                      Two colours only
                    </button>
                  )}
                </div>
              </>
            )}

            <div className="lsp-presets" aria-label="Preset line colours">
              {DEFAULT_PALETTE.map(c => {
                const lineMatches = !isGradient && c === holding.color
                const startMatches = isGradient && colorFocus === 'primary' && c === holding.color
                const stopMatches =
                  isGradient && typeof colorFocus === 'number' && grad[colorFocus] === c
                const isActive = lineMatches || startMatches || stopMatches
                return (
                  <button
                    key={c}
                    type="button"
                    className={`lsp-preset-swatch ${isActive ? 'is-on' : ''}`}
                    style={{ background: c }}
                    onClick={() => onPresetClick(c)}
                    aria-label={`Use ${c}`}
                    title={c}
                  />
                )
              })}
            </div>

            {colorFocus !== 'dot' && (
              <div className="lsp-picker-embed">
                <ColorPicker color={pickerColor} onChange={applyPickerColor} />
                <p className="lsp-picker-hint">
                  {colorFocus === 'primary'
                    ? 'Editing line start'
                    : `Editing gradient stop ${(colorFocus as number) + 1}`}
                </p>
              </div>
            )}
          </div>

          <div className="lsp-block lsp-block--end-dot">
            <div className="lsp-dot-header">
              <span className="lsp-sublabel">End dot</span>
              <div className="lsp-dot-swatch-row">
                <button
                  type="button"
                  className={`lsp-dot-swatch ${colorFocus === 'dot' ? 'is-on' : ''}`}
                  style={{ background: activeDotColor }}
                  onClick={() => setColorFocus(prev => (prev === 'dot' ? 'primary' : 'dot'))}
                  aria-expanded={colorFocus === 'dot'}
                  aria-label="End dot colour"
                  title="Dot colour"
                />
                {dotIsCustom && (
                  <button
                    type="button"
                    className="lsp-mini-btn"
                    onClick={() => {
                      onDotColorChange(undefined)
                      setColorFocus('primary')
                    }}
                  >
                    Match line
                  </button>
                )}
              </div>
            </div>

            {colorFocus === 'dot' && (
              <div className="lsp-picker-embed">
                <ColorPicker color={activeDotColor} onChange={hex => onDotColorChange(hex)} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
