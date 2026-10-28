import { format } from 'date-fns'
import type { Child } from './api/types'
import type { TimelineItem } from './events'

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  // Free text starting with = + - @ or a tab is run as a formula by Excel, Numbers and Sheets (CSV injection).
  // A leading apostrophe makes spreadsheets treat it as text; numbers are never prefixed.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function timelineToCsv(items: TimelineItem[], child: Child): string {
  const header = ['child', 'type', 'title', 'start', 'end', 'detail', 'notes']
  const rows = items.map((i) => {
    const notes = 'notes' in i.raw ? (i.raw as { notes?: string | null }).notes ?? '' : ''
    return [child.first_name, i.kind, i.title, format(i.at, 'yyyy-MM-dd HH:mm'), i.end ? format(i.end, 'yyyy-MM-dd HH:mm') : '', i.detail, notes].map(cell).join(',')
  })
  return [header.join(','), ...rows].join('\n')
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
