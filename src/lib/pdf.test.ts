import { describe, expect, it } from 'vitest'
import { jpegToPdf, LETTER_PT } from './pdf'

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

describe('jpegToPdf', () => {
  it('writes one letter page holding the image fitted from the top, with a valid cross-reference table', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const pdf = jpegToPdf({ jpeg, width: 816, height: 1056 }, LETTER_PT, "Ada's visit (Nov 3)")
    const s = text(pdf)
    expect(s.startsWith('%PDF-1.4\n')).toBe(true)
    expect(s.endsWith('%%EOF\n')).toBe(true)
    expect(s.match(/\/Type \/Page[^s]/g)).toHaveLength(1)
    expect(s).toContain('/MediaBox [0 0 612 792]')
    expect(s).toContain('/Filter /DCTDecode /Length 4')
    // 816 × 1056 scales to the full page: 612 wide, 792 tall, drawn from the bottom-left corner
    expect(s).toContain('q 612 0 0 792 0 0 cm /Im0 Do Q')
    expect(s).toContain("/Title (Ada's visit \\(Nov 3\\))")
    // every xref offset points at its object
    const xrefAt = Number(s.match(/startxref\n(\d+)/)![1])
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const offsets = [...s.slice(xrefAt).matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(6)
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
  })

  it('keeps a shorter image at the top of the page at full width', () => {
    const s = text(jpegToPdf({ jpeg: new Uint8Array(2), width: 816, height: 528 }))
    expect(s).toContain('q 612 0 0 396 0 396 cm /Im0 Do Q')
  })
})
