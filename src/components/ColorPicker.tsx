import { useState, useEffect, useCallback } from 'react'
import { HexColorPicker } from 'react-colorful'
import './ColorPicker.css'

interface Props {
  color: string
  onChange: (color: string) => void
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex
  const m = /^#([0-9a-f]{6})$/i.exec(full)
  if (!m) return null
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
}

function clamp(v: number) { return Math.max(0, Math.min(255, Math.round(v))) }

export default function ColorPicker({ color, onChange }: Props) {
  const [hexInput, setHexInput] = useState(color)
  const [rgb, setRgb] = useState(() => hexToRgb(color) ?? { r: 99, g: 102, b: 241 })

  // Keep local state in sync when external color changes (e.g. canvas drag)
  useEffect(() => {
    setHexInput(color)
    const parsed = hexToRgb(color)
    if (parsed) setRgb(parsed)
  }, [color])

  const handleCanvasChange = useCallback((h: string) => {
    onChange(h)
    setHexInput(h)
    const parsed = hexToRgb(h)
    if (parsed) setRgb(parsed)
  }, [onChange])

  const handleHexInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setHexInput(raw)
    const normalised = raw.startsWith('#') ? raw : `#${raw}`
    if (/^#[0-9a-f]{6}$/i.test(normalised)) {
      onChange(normalised)
      const parsed = hexToRgb(normalised)
      if (parsed) setRgb(parsed)
    }
  }

  const handleHexBlur = () => {
    // Normalise on blur — reset to valid current color if input is malformed
    setHexInput(color)
  }

  const handleRgbChange = (channel: 'r' | 'g' | 'b', raw: string) => {
    const val = parseInt(raw, 10)
    if (isNaN(val)) return
    const next = { ...rgb, [channel]: clamp(val) }
    setRgb(next)
    const hex = rgbToHex(next.r, next.g, next.b)
    setHexInput(hex)
    onChange(hex)
  }

  return (
    <div className="cpicker">
      <HexColorPicker color={color} onChange={handleCanvasChange} />
      <div className="cpicker-inputs">
        <div className="cpicker-field cpicker-hex">
          <label className="cpicker-label">Hex</label>
          <input
            className="cpicker-input"
            value={hexInput}
            onChange={handleHexInput}
            onBlur={handleHexBlur}
            spellCheck={false}
            maxLength={7}
          />
        </div>
        <div className="cpicker-rgb">
          {(['r', 'g', 'b'] as const).map(ch => (
            <div key={ch} className="cpicker-field">
              <label className="cpicker-label">{ch.toUpperCase()}</label>
              <input
                className="cpicker-input cpicker-num"
                type="number"
                min={0}
                max={255}
                value={rgb[ch]}
                onChange={e => handleRgbChange(ch, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
