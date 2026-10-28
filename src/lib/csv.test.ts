import { describe, expect, it } from 'vitest'
import { timelineToCsv } from './csv'
import type { TimelineItem } from './events'

describe('timelineToCsv', () => {
  it('escapes commas and quotes', () => {
    const item: TimelineItem = {
      key: 'note-1',
      kind: 'note',
      at: new Date('2026-09-01T09:00:00'),
      end: null,
      title: 'Note',
      detail: 'said "hi", smiled',
      raw: { id: 1, child: 1, note: 'said "hi", smiled', image: null, time: '2026-09-01T09:00:00', tags: [] },
    }
    const csv = timelineToCsv([item], { id: 1, first_name: 'Oscar', last_name: '', birth_date: '2026-05-01', birth_time: null, slug: 'oscar', picture: null })
    expect(csv.split('\n')[0]).toBe('child,type,title,start,end,detail,notes')
    expect(csv.split('\n')[1]).toBe('Oscar,note,Note,2026-09-01 09:00,,"said ""hi"", smiled",')
  })
  it('neutralises spreadsheet formulas and quotes bare carriage returns in free text', () => {
    const base = { key: 'note-2', kind: 'note' as const, at: new Date('2026-09-01T09:00:00'), end: null, title: 'Note', raw: { id: 2, child: 1, note: '', image: null, time: '2026-09-01T09:00:00', tags: [] } }
    const child = { id: 1, first_name: 'Oscar', last_name: '', birth_date: '2026-05-01', birth_time: null, slug: 'oscar', picture: null }
    const formula = timelineToCsv([{ ...base, detail: '=2+2' }], child).split('\n')[1]
    expect(formula).toBe("Oscar,note,Note,2026-09-01 09:00,,'=2+2,")
    const cr = timelineToCsv([{ ...base, detail: 'line one\rline two' }], child).split('\n')[1]
    expect(cr).toBe('Oscar,note,Note,2026-09-01 09:00,,"line one\rline two",')
    const negativeText = timelineToCsv([{ ...base, detail: '-1 oz less than usual' }], child).split('\n')[1]
    expect(negativeText).toContain("'-1 oz less than usual")
  })
})
