import type { TimeRange } from '../types'
import './TimeRangePicker.css'

const HISTORICAL_RANGES: TimeRange[] = ['1W', '1M', '3M', '1Y']

interface Props {
  value: TimeRange
  onChange: (range: TimeRange) => void
  /** Chart zoom / pan reset — shown after the range buttons */
  chartCanReset?: boolean
  onChartReset?: () => void
}

export default function TimeRangePicker({ value, onChange, chartCanReset = false, onChartReset }: Props) {
  const isLive = value === '1D'

  return (
    <div className="trp">
      <button
        type="button"
        className={`trp-btn trp-btn--live ${isLive ? 'trp-btn--active' : ''}`}
        onClick={() => onChange('1D')}
      >
        <span className={`trp-live-dot ${isLive ? 'trp-live-dot--on' : ''}`} />
        Live
      </button>

      <span className="trp-divider" />

      {HISTORICAL_RANGES.map(r => (
        <button
          key={r}
          type="button"
          className={`trp-btn ${r === value ? 'trp-btn--active' : ''}`}
          onClick={() => onChange(r)}
        >
          {r}
        </button>
      ))}

      {onChartReset != null && (
        <>
          <span className="trp-divider" />
          <button
            type="button"
            className="trp-btn trp-btn--reset"
            onClick={onChartReset}
            disabled={!chartCanReset}
            aria-label="Reset chart zoom and vertical scale"
            title={
              chartCanReset
                ? 'Reset zoom and vertical scale (double-click chart also works)'
                : 'Nothing to reset'
            }
          >
            <svg className="trp-reset-icon" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
              />
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 3v5h5"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}
