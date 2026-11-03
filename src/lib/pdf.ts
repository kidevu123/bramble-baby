/**
 * A one-page PDF around a JPEG, written by hand: a Home Screen web app on iOS has no print dialog
 * (`window.print()` does nothing there), so the pediatrician report is drawn to a canvas, packed into a PDF and
 * handed to the share sheet, which has Print, AirDrop, Mail and Save to Files. PDF needs nothing more than the
 * page tree, one image XObject (DCTDecode is JPEG as it comes) and a content stream that scales it onto the page.
 */

/** US letter in PDF points (1/72 in). */
export const LETTER_PT = { width: 612, height: 792 }

export interface PdfImage {
  /** The JPEG bytes. */
  jpeg: Uint8Array
  /** The JPEG's pixel size. */
  width: number
  height: number
}

/**
 * Builds a PDF with one page of `page` points holding `image`, fitted inside the page from its top-left (the
 * image already carries the margins), keeping its aspect ratio. Returns the file's bytes.
 */
export function jpegToPdf(image: PdfImage, page = LETTER_PT, title = ''): Uint8Array {
  const scale = Math.min(page.width / image.width, page.height / image.height)
  const w = image.width * scale
  const h = image.height * scale
  const x = 0
  const y = page.height - h
  const content = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im0 Do Q`
  const objects: (string | Uint8Array)[][] = []
  objects.push([`<< /Type /Catalog /Pages 2 0 R >>`])
  objects.push([`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`])
  objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`])
  objects.push([`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`, image.jpeg, `\nendstream`])
  objects.push([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`])
  objects.push([`<< /Producer (Bramble)${title ? ` /Title (${pdfString(title)})` : ''} >>`])

  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  let length = 0
  const push = (p: string | Uint8Array) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p
    parts.push(bytes)
    length += bytes.length
  }
  push('%PDF-1.4\n%âãÏÓ\n')
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(length)
    push(`${i + 1} 0 obj\n`)
    for (const p of body) push(p)
    push(`\nendobj\n`)
  })
  const xref = length
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3))
const pdfString = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '')
