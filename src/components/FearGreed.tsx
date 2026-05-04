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
      const json: unknown = await res.json()
      if (
        !json ||
        typeof json !== 'object' ||
        typeof (json as FGData).score !== 'number' ||
        !Number.isFinite((json as FGData).score)
      ) {
        setData(null)
        setError(true)
        return
      }
      const row = json as FGData
      setData({
        score: row.score,
        rating: typeof row.rating === 'string' ? row.rating : String(row.rating ?? ''),
      })
      setError(false)
    } catch {
      setData(null)
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
    <div className={`fg-widget${error ? ' fg-widget--error' : ''}`}>
      {leadingSlot ? <span className="fg-toggle-slot">{leadingSlot}</span> : null}
      <a
        className="fg-meter-anchor"
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
        <div className="fg-readout-track">
          {error ? (
            <span className="fg-score fg-err fg-score--centered">—</span>
          ) : score !== null ? (
            <span className="fg-score fg-score--at-needle" style={{ left: pct }}>
              {score}
            </span>
          ) : (
            <span className="fg-score fg-loading fg-score--centered">…</span>
          )}
        </div>
      </a>
    </div>
  )
}
