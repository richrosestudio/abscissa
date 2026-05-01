import type { TimeRange } from '../types'
import './TimeRangePicker.css'

const HISTORICAL_RANGES: TimeRange[] = ['1W', '1M', '3M', '1Y']

interface Props {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

export default function TimeRangePicker({ value, onChange }: Props) {
  const isLive = value === '1D'

  return (
    <div className="trp">
      {/* Live button */}
      <button
        className={`trp-btn trp-btn--live ${isLive ? 'trp-btn--active' : ''}`}
        onClick={() => onChange('1D')}
      >
        <span className={`trp-live-dot ${isLive ? 'trp-live-dot--on' : ''}`} />
        Live
      </button>

      <span className="trp-divider" />

      {/* Historical range buttons */}
      {HISTORICAL_RANGES.map(r => (
        <button
          key={r}
          className={`trp-btn ${r === value ? 'trp-btn--active' : ''}`}
          onClick={() => onChange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  )
}
