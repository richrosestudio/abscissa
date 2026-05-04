import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendInternalError, logServerError } from './_security.js'

function toFiniteScore(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Extract score/rating from CNN graphdata JSON with fallbacks for payload drift. */
function extractScoreRating(data: unknown): { score: number; rating: string } | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  const fg = d.fear_and_greed
  if (fg && typeof fg === 'object') {
    const o = fg as Record<string, unknown>
    const s = toFiniteScore(o.score)
    if (s !== null) {
      return { score: s, rating: String(o.rating ?? 'neutral') }
    }
  }

  const hist = d.fear_and_greed_historical
  if (hist && typeof hist === 'object') {
    const h = hist as Record<string, unknown>
    const top = toFiniteScore(h.score)
    if (top !== null) {
      return { score: top, rating: String(h.rating ?? 'neutral') }
    }
    const arr = h.data
    if (Array.isArray(arr) && arr.length > 0) {
      const last = arr[arr.length - 1]
      if (last && typeof last === 'object') {
        const L = last as Record<string, unknown>
        const fromY = toFiniteScore(L.y)
        if (fromY !== null) {
          return { score: fromY, rating: String(L.rating ?? 'neutral') }
        }
        const fromS = toFiniteScore(L.score)
        if (fromS !== null) {
          return { score: fromS, rating: String(L.rating ?? 'neutral') }
        }
      }
    }
  }

  return null
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    const upstream = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://edition.cnn.com/',
        },
      },
    )

    if (!upstream.ok) {
      let snippet = ''
      try {
        snippet = (await upstream.text()).slice(0, 200)
      } catch {
        /* ignore */
      }
      console.error('[api] feargreed: upstream HTTP', upstream.status, snippet)
      return res.status(502).json({ error: 'Upstream service unavailable' })
    }

    const data: unknown = await upstream.json()
    const resolved = extractScoreRating(data)

    if (!resolved) {
      console.error('[api] feargreed: could not parse score from upstream payload')
      return res.status(502).json({ error: 'Unexpected response from upstream' })
    }

    return res.status(200).json({
      score: Math.round(resolved.score),
      rating: resolved.rating,
    })
  } catch (err) {
    logServerError('feargreed', err)
    return sendInternalError(res)
  }
}
