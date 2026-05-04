import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import './FearGreed.css'

interface FGData {
  score: number
  rating: string
}

interface Props {
  /** e.g. theme toggle — rendered in the same row as the bar for vertical alignment */
  leadingSlot?: ReactNode
}

export default function FearGreed({ leadingSlot }: Props) {
  const [data, setData] = useState<FGData | null>(null)
  const [error, setError] = useState(false)

  const fetchData = async () => {
    try {
      const res = await fetch('/api/feargreed')
      if (!res.ok) throw new Error('bad response')
      const json = await res.json()
      setData(json)
      setError(false)
    } catch {
      setError(true)
    }
  }

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const score = data?.score ?? null
  const rating = data?.rating ?? ''
  const pct = score !== null ? `${score}%` : '50%'

  const href = 'https://edition.cnn.com/markets/fear-and-greed'
  const title = rating ? `Fear & Greed: ${rating} — click to open CNN` : 'Fear & Greed Index — click to open CNN'

  return (
    <div className="fg-widget">
      {leadingSlot ? <span className="fg-toggle-slot">{leadingSlot}</span> : null}
      <a
        className="fg-bar-anchor"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
      >
        <div className="fg-bar-wrap">
          <div className="fg-bar">
            <div className="fg-bar-red" />
            <div className="fg-bar-green" />
            {score !== null && (
              <div className="fg-needle" style={{ left: pct }} />
            )}
          </div>
        </div>
      </a>
      <a
        className="fg-readout-anchor"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
      >
        <div className="fg-readout">
          {error ? (
            <span className="fg-score fg-err">—</span>
          ) : score !== null ? (
            <span className="fg-score">{score}</span>
          ) : (
            <span className="fg-score fg-loading">…</span>
          )}
        </div>
      </a>
    </div>
  )
}
