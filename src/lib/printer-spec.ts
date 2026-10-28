/**
 * The printer on a household's Bramble server, as the Settings form edits it: a kind and its few fields, turned
 * into the address the server understands (`zebra://192.0.2.2:9100`, `brother_ql://tcp/…?model=…&label=…`,
 * `bridge://host:8110?token=…`) and back. Anything the form cannot show field by field stays as typed ('other').
 */
export type PrinterKind = 'none' | 'zebra' | 'brother_ql' | 'bridge' | 'other'

export interface PrinterForm {
  kind: PrinterKind
  host: string
  port: string
  model: string
  label: string
  token: string
  /** The whole address, for 'other'. */
  raw: string
}

export const PRINTER_KIND_LABEL: Record<PrinterKind, string> = {
  none: 'None',
  zebra: 'Zebra',
  brother_ql: 'Brother QL',
  bridge: 'Print bridge',
  other: 'Other',
}

const blank: PrinterForm = { kind: 'none', host: '', port: '9100', model: 'QL-810W', label: '29x62', token: '', raw: '' }

export function parsePrinterSpec(spec: string | null | undefined): PrinterForm {
  const s = (spec ?? '').trim()
  if (!s || s.toLowerCase() === 'none') return { ...blank }
  let m = /^zebra:\/\/([^:/?#\s]+)(?::(\d+))?\/?$/i.exec(s)
  if (m) return { ...blank, kind: 'zebra', host: m[1], port: m[2] ?? '9100' }
  m = /^brother_ql:\/\/tcp\/([^/?#\s]+)\?(.*)$/i.exec(s)
  if (m) {
    const q = new URLSearchParams(m[2])
    const keys = [...q.keys()]
    // An address with a port (brother_ql://tcp/192.0.2.5:9100?…) is kept whole as "Other", so it can be saved as it is.
    if (!m[1].includes(':') && keys.every((k) => k === 'model' || k === 'label')) return { ...blank, kind: 'brother_ql', host: m[1], model: q.get('model') ?? blank.model, label: q.get('label') ?? blank.label }
  }
  m = /^bridge:\/\/([^:/?#\s]+)(?::(\d+))?\/?\?token=([^&]+)$/i.exec(s)
  if (m) return { ...blank, kind: 'bridge', host: m[1], port: m[2] ?? '8110', token: m[3] }
  return { ...blank, kind: 'other', raw: s }
}

const hostOk = (h: string) => /^[A-Za-z0-9.-]+$/.test(h.trim())
const portOk = (p: string) => /^\d{1,5}$/.test(p.trim()) && Number(p) > 0 && Number(p) < 65536

/** Why the form cannot be saved, in words; null when it can. */
export function printerFormProblem(f: PrinterForm): string | null {
  if (f.kind === 'none') return null
  if (f.kind === 'other') return /^[a-z_]+:\/\/\S+$/i.test(f.raw.trim()) ? null : 'Enter the printer address, e.g. zebra://192.0.2.2:9100.'
  if (!hostOk(f.host)) return "Enter the printer's IP address or name on your network."
  if ((f.kind === 'zebra' || f.kind === 'bridge') && !portOk(f.port)) return 'The port is a number (a Zebra listens on 9100).'
  if (f.kind === 'bridge' && !f.token.trim()) return 'Enter the print bridge token.'
  if (f.kind === 'brother_ql' && (!f.model.trim() || !f.label.trim())) return 'Enter the Brother model and the label size.'
  return null
}

/** The address for the server; 'none' for no printer (labels go through the share sheet). */
export function buildPrinterSpec(f: PrinterForm): string {
  const host = f.host.trim()
  switch (f.kind) {
    case 'none':
      return 'none'
    case 'zebra':
      return `zebra://${host}:${f.port.trim()}`
    case 'brother_ql':
      return `brother_ql://tcp/${host}?model=${encodeURIComponent(f.model.trim())}&label=${encodeURIComponent(f.label.trim())}`
    case 'bridge':
      return `bridge://${host}:${f.port.trim()}?token=${f.token.trim()}`
    case 'other':
      return f.raw.trim() || 'none'
  }
}
