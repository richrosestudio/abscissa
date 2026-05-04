import { useState, useEffect } from 'react'
import './AnalogClock.css'

interface Props {
  city: string
  timezone: string
  offsetLabel?: string
  isOpen: boolean
  scrubTime?: number | null  // unix seconds; when set, clock shows this time and pauses live tick
  selected?: boolean
  unselected?: boolean
  onClick?: () => void
}

interface ClockTime {
  hours: number
  minutes: number
  seconds: number
  displayTime: string
}

function getTimeInZoneAt(tz: string, date: Date): ClockTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  const s = parseInt(parts.find(p => p.type === 'second')?.value ?? '0')

  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    hours: h,
    minutes: m,
    seconds: s,
    displayTime: `${pad(h)}:${pad(m)}`,
  }
}

function getTimeInZone(tz: string): ClockTime {
  return getTimeInZoneAt(tz, new Date())
}

export default function AnalogClock({ city, timezone, isOpen, scrubTime, selected, unselected, onClick }: Props) {
  const [time, setTime] = useState<ClockTime>(() => getTimeInZone(timezone))

  // Live tick — paused whenever scrubTime is active
  useEffect(() => {
    if (scrubTime != null) return
    const tick = () => setTime(getTimeInZone(timezone))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timezone, scrubTime])

  // Scrub time — recompute whenever hoveredTime changes
  useEffect(() => {
    if (scrubTime == null) return
    setTime(getTimeInZoneAt(timezone, new Date(scrubTime * 1000)))
  }, [timezone, scrubTime])

  const isScrubbing = scrubTime != null

  // Smooth second hand: seconds * 6 deg
  const secDeg  = time.seconds * 6
  // Minute hand: each minute = 6 deg, plus fractional from seconds
  const minDeg  = time.minutes * 6 + time.seconds * 0.1
  // Hour hand: each hour = 30 deg, plus fractional from minutes
  const hourDeg = (time.hours % 12) * 30 + time.minutes * 0.5

  const selectionClass = selected ? 'selected' : unselected ? 'unselected' : ''

  const label = `${city} clock, ${isOpen ? 'market open' : 'market closed'}${selected ? ', selected' : ''}. Toggle to filter the chart by this session.`

  return (
    <div
      className={`analog-clock ${isOpen ? 'open' : 'closed'} ${isScrubbing ? 'scrubbing' : ''} ${selectionClass}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      aria-pressed={selected}
      aria-label={label}
    >
      <svg className="clock-face" viewBox="0 0 40 40" width="40" height="40">
        {/* Rim */}
        <circle cx="20" cy="20" r="19" className="clock-rim" />
        {/* Hour ticks */}
        {Array.from({ length: 12 }, (_, i) => {
          const angle = (i * 30 * Math.PI) / 180
          const x1 = 20 + 16 * Math.sin(angle)
          const y1 = 20 - 16 * Math.cos(angle)
          const x2 = 20 + 18.5 * Math.sin(angle)
          const y2 = 20 - 18.5 * Math.cos(angle)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="clock-tick" />
        })}
        {/* Hour hand */}
        <line
          x1="20" y1="20"
          x2={20 + 9 * Math.sin((hourDeg * Math.PI) / 180)}
          y2={20 - 9 * Math.cos((hourDeg * Math.PI) / 180)}
          className="clock-hand hour-hand"
        />
        {/* Minute hand */}
        <line
          x1="20" y1="20"
          x2={20 + 12 * Math.sin((minDeg * Math.PI) / 180)}
          y2={20 - 12 * Math.cos((minDeg * Math.PI) / 180)}
          className="clock-hand minute-hand"
        />
        {/* Second hand — hidden while scrubbing */}
        {!isScrubbing && (
          <line
            x1="20" y1="20"
            x2={20 + 14 * Math.sin((secDeg * Math.PI) / 180)}
            y2={20 - 14 * Math.cos((secDeg * Math.PI) / 180)}
            className="clock-hand second-hand"
          />
        )}
      </svg>

      <div className="clock-meta">
        <span className="clock-digital">{time.displayTime}</span>
        <span className="clock-city">{city}</span>
      </div>
    </div>
  )
}
