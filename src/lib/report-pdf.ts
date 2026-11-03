import { jpegToPdf, LETTER_PT } from './pdf'

/** The paper at 96 px an inch: US letter is 816 × 1056. */
export const PAPER_PX = { width: 816, height: 1056 }

/**
 * Draws a report article as it prints (the `paper` layout at letter width, off screen) into a JPEG and packs it
 * into a one-page PDF. The renderer is loaded on first use: it is a chunk the rest of the app never needs.
 */
export async function reportToPdf(article: HTMLElement, title: string): Promise<Blob> {
  const { default: html2canvas } = await import('html2canvas')
  const host = document.createElement('div')
  host.className = 'report-paper-host'
  const clone = article.cloneNode(true) as HTMLElement
  clone.classList.add('paper')
  clone.setAttribute('aria-hidden', 'true')
  host.appendChild(clone)
  document.body.appendChild(host)
  try {
    await document.fonts?.ready
    const canvas = await html2canvas(clone, {
      scale: 2,
      backgroundColor: '#ffffff',
      width: PAPER_PX.width,
      height: Math.max(PAPER_PX.height, clone.scrollHeight),
      windowWidth: PAPER_PX.width,
      logging: false,
      useCORS: true,
    })
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The page could not be drawn.'))), 'image/jpeg', 0.92))
    const bytes = jpegToPdf({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height }, LETTER_PT, title)
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  } finally {
    host.remove()
  }
}

/** Hands the PDF to the share sheet when the browser can share a file, else downloads it. Returns how it went. */
export async function deliverPdf(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title })
    return 'shared'
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
