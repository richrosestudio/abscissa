/**
 * Compute symmetric Y-axis bounds for the chart.
 *
 * Rule (from brief):
 *   1. Find max absolute % across all visible (non-hidden) series' current data window.
 *   2. Apply a buffer of ~12.5% (within 10–15%) beyond the outermost value.
 *   3. Round UP to the nearest whole 1%, so 0% is always vertically centred.
 *
 * Returns { min: -B, max: +B } where B is a whole integer percent.
 */
export function computeSymmetricDomain(
  allPcts: number[],   // flat array of every visible pct value on screen
  buffer = 0.125,      // 12.5% buffer
  minB = 1,            // never go below ±1%
): { min: number; max: number } {
  if (allPcts.length === 0) return { min: -minB, max: minB }

  const maxAbs = Math.max(...allPcts.map(Math.abs))
  if (maxAbs === 0) return { min: -minB, max: minB }

  const buffered = maxAbs * (1 + buffer)
  const B = Math.max(Math.ceil(buffered), minB)
  return { min: -B, max: B }
}

/**
 * Compute data-centred Y-axis bounds for historical ranges.
 *
 * Historical views should use the actual data range so a strongly positive
 * yearly chart is not compressed by a huge unused negative half.
 */
export function computeDataDomain(
  allPcts: number[],
  buffer = 0.125,
  minSpan = 4,
): { min: number; max: number } {
  const finite = allPcts.filter(Number.isFinite)
  if (finite.length === 0) return { min: -1, max: 1 }

  let min = Math.min(...finite)
  let max = Math.max(...finite)

  // Keep the 0% baseline visible when data is near it, but avoid forcing it
  // into view for strongly one-sided historical moves.
  const spanBeforeZero = max - min
  const zeroPadding = Math.max(spanBeforeZero * 0.15, 2)
  if (min > 0 && min <= zeroPadding) min = 0
  if (max < 0 && Math.abs(max) <= zeroPadding) max = 0

  let span = max - min
  if (span < minSpan) {
    const mid = (min + max) / 2
    min = mid - minSpan / 2
    max = mid + minSpan / 2
    span = minSpan
  }

  const pad = span * buffer
  return {
    min: Math.floor(min - pad),
    max: Math.ceil(max + pad),
  }
}
