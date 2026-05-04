import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendInternalError, logServerError } from './_security'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    const upstream = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://edition.cnn.com/',
        },
      }
    )

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upstream service unavailable' })
    }

    const data = await upstream.json()
    const fg = data?.fear_and_greed

    if (!fg || typeof fg.score !== 'number') {
      return res.status(502).json({ error: 'Unexpected response from upstream' })
    }

    return res.status(200).json({
      score: Math.round(fg.score),
      rating: (fg.rating as string) ?? 'neutral',
    })
  } catch (err) {
    logServerError('feargreed', err)
    return sendInternalError(res)
  }
}
