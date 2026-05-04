import { useState, useEffect } from 'react'
import type { Exchange, Theme } from '../types'
import AnalogClock from './AnalogClock'
import FearGreed from './FearGreed'
import './Header.css'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  hoveredTime?: number | null
  selectedExchange?: Exchange | null
  onSelectExchange?: (exchange: Exchange) => void
}

const CLOCKS: { city: string; tz: string; exchange: Exchange; offset: () => string; isOpen: () => boolean }[] = [
  { city: 'London',   tz: 'Europe/London',   exchange: 'LSE', offset: () => tzOffset('Europe/London'),   isOpen: () => isLSEOpen() },
  { city: 'New York', tz: 'America/New_York', exchange: 'US',  offset: () => tzOffset('America/New_York'), isOpen: () => isUSOpen() },
  { city: 'Tokyo',    tz: 'Asia/Tokyo',       exchange: 'TSE', offset: () => tzOffset('Asia/Tokyo'),       isOpen: () => isTSEOpen() },
]

function tzOffset(tz: string): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).formatToParts(now)
  return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
}

function getLondonMins(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

function isLSEOpen(): boolean {
  const m = getLondonMins(); return m >= 480 && m < 990
}

function isUSOpen(): boolean {
  const m = getLondonMins(); return m >= 870 && m < 1260
}

function isTSEOpen(): boolean {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  const mins = h * 60 + m
  return mins >= 540 && mins < 900
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

export default function Header({ theme, onToggleTheme, hoveredTime, selectedExchange, onSelectExchange }: Props) {
  // Tick every 30s so open/closed state stays current
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="header">
      <img
        src="/abscissa-logo.png"
        alt="Abscissa"
        className="header-wordmark"
      />

      <div className="header-clocks">
        {CLOCKS.map(c => {
          const isSelected = selectedExchange === c.exchange
          const isUnselected = selectedExchange !== null && !isSelected
          return (
            <AnalogClock
              key={c.city}
              city={c.city}
              timezone={c.tz}
              offsetLabel={c.offset()}
              isOpen={c.isOpen()}
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
            <button
              type="button"
              className="theme-toggle"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          }
        />
      </div>
    </header>
  )
}
