/**
 * Updates the favicon to a coloured dot.
 * Green if portfolio mean % from open is positive, red if negative.
 * Portfolio mean = equal-weight average of all holdings' current pct.
 */
export function updateFavicon(pcts: number[]): void {
  if (pcts.length === 0) return
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length
  const color = mean >= 0 ? '#22c55e' : '#ef4444'

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="${color}"/></svg>`
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`

  let link = document.getElementById('favicon') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = 'favicon'
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    document.head.appendChild(link)
  }
  link.href = url
}
