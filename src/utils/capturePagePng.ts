function defaultFilename(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `abscissa-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`
}

function triggerDownload(href: string, name: string, blobUrlToRevoke?: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (blobUrlToRevoke) {
    setTimeout(() => URL.revokeObjectURL(blobUrlToRevoke), 300)
  }
}

/** Save canvas as PNG via blob URL (revoked after delay) or data URL fallback. */
function downloadCanvasPng(canvas: HTMLCanvasElement, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          const url = URL.createObjectURL(blob)
          try {
            triggerDownload(url, name, url)
            resolve()
          } catch (e) {
            URL.revokeObjectURL(url)
            reject(e instanceof Error ? e : new Error(String(e)))
          }
          return
        }
        try {
          const dataUrl = canvas.toDataURL('image/png')
          triggerDownload(dataUrl, name)
          resolve()
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      },
      'image/png',
      1,
    )
  })
}

/**
 * Rasterises the main app shell (`.app`) and triggers a PNG download.
 * Loads html2canvas on first use to keep the initial bundle smaller.
 */
export async function captureAppAsPng(filename?: string): Promise<void> {
  const { default: html2canvas } = await import('html2canvas')
  const name = filename ?? defaultFilename()
  const el = document.querySelector('.app') as HTMLElement | null
  if (!el) throw new Error('App root not found')

  const bg = getComputedStyle(el).backgroundColor || '#0a0a0f'

  const canvas = await html2canvas(el, {
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    useCORS: true,
    allowTaint: false,
    foreignObjectRendering: false,
    logging: false,
    backgroundColor: bg,
    scrollX: 0,
    scrollY: -window.scrollY,
    onclone: clonedDoc => {
      clonedDoc.querySelectorAll('.splash').forEach(node => node.remove())
    },
  })

  await downloadCanvasPng(canvas, name)
}
