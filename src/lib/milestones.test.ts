import { describe, expect, it } from 'vitest'
import type { Milestone } from './api/companion'
import {
  checklistLine,
  checklistsFor,
  checkpointDay,
  checkpointProgress,
  CHECKPOINTS,
  hearingFollowUp,
  itemForTitle,
  KEEPSAKES,
  loggedByTitle,
  milestoneSuggestions,
  screeningLine,
  seenEntry,
  titleKey,
} from './milestones'
import { ageBasis } from './preterm'

const entry = (id: number, title: string, date = '2026-11-01'): Milestone => ({ id, child: 1, title, date, category: 'motor', notes: '' }) as Milestone
const cp = (months: number) => CHECKPOINTS.find((c) => c.months === months)!

describe('CDC checklists', () => {
  it('carry every item of CDC’s twelve lists, by domain', () => {
    const counts = CHECKPOINTS.map((c) => [c.months, ...(['social', 'language', 'cognitive', 'motor'] as const).map((d) => c.items.filter((i) => i.domain === d).length)])
    expect(counts).toEqual([
      [2, 4, 2, 2, 3],
      [4, 3, 3, 2, 5],
      [6, 3, 3, 3, 3],
      [9, 5, 2, 2, 4],
      [12, 1, 3, 2, 4],
      [15, 5, 4, 2, 2],
      [18, 5, 2, 2, 6],
      [24, 2, 4, 3, 4],
      [30, 3, 4, 4, 4],
      [36, 2, 5, 2, 3],
      [48, 6, 4, 3, 4],
      [60, 3, 4, 6, 2],
    ])
  })

  it('say the ages CDC puts them at', () => {
    expect(itemForTitle('Rolls from tummy to back')?.checkpoint.months).toBe(6)
    expect(itemForTitle('Sits without support')?.checkpoint.months).toBe(9)
    expect(itemForTitle('Pulls up to stand')?.checkpoint.months).toBe(12)
    expect(itemForTitle('Takes a few steps on their own')?.checkpoint.months).toBe(15)
    expect(itemForTitle('Walks without holding on to anyone or anything')?.checkpoint.months).toBe(18)
    expect(itemForTitle('Says at least two words together')?.checkpoint.months).toBe(24)
    expect(itemForTitle('Says about 50 words')?.checkpoint.months).toBe(30)
    // crawling is on no CDC list
    expect(itemForTitle('Crawls')).toBeNull()
  })

  it('name the screenings of the 9, 18, 24 and 30 month visits and no other', () => {
    expect(CHECKPOINTS.filter((c) => c.screening).map((c) => [c.months, c.screening])).toEqual([
      [9, 'general'],
      [18, 'general-autism'],
      [24, 'autism'],
      [30, 'general'],
    ])
    expect(screeningLine(cp(18))).toContain('a developmental screening and an autism screening')
    expect(screeningLine(cp(12))).toBeNull()
  })

  it('give every item and alias a title of its own, so a logged title marks one item', () => {
    const keys = CHECKPOINTS.flatMap((c) => c.items.flatMap((i) => [i.text, ...(i.aliases ?? [])])).map(titleKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of KEEPSAKES) expect(keys).not.toContain(titleKey(k.text))
  })
})

describe('which list', () => {
  it('nothing is due before 2 months; the latest reached list leads after', () => {
    expect(checklistsFor(1.6)).toMatchObject({ due: null, next: { months: 2 }, earlier: [] })
    expect(checklistsFor(2)).toMatchObject({ due: { months: 2 }, next: { months: 4 } })
    const seven = checklistsFor(7.5)
    expect([seven.due?.months, seven.next?.months, seven.earlier.map((c) => c.months)]).toEqual([6, 9, [4, 2]])
    expect(checklistsFor(70)).toMatchObject({ due: { months: 60 }, next: null })
  })

  it('counts a list’s day from the due date for a baby born early', () => {
    const now = new Date(2026, 10, 10)
    expect(checkpointDay(cp(2), '2026-09-22', now)).toBe('Nov 22')
    // 30 weeks: due 70 days after the birth (Dec 1), so 2 months corrected is Feb 1
    expect(checkpointDay(cp(2), ageBasis({ birth_date: '2026-09-22' }, { bornAtDays: 210 }), now)).toBe('Feb 1, 2027')
  })
})

describe('seen', () => {
  it('matches a title whatever its quotes and case, and the names the sheet used to offer', () => {
    const by = loggedByTitle([entry(1, 'waves bye-bye'), entry(2, 'First smile', '2026-11-03'), entry(3, 'First smile', '2026-11-01')])
    expect(seenEntry(cp(12).items.find((i) => i.text.startsWith('Waves'))!, by)?.id).toBe(1)
    // the earliest entry of a title logged twice
    expect(seenEntry(cp(2).items.find((i) => i.text === 'Smiles when you talk or smile')!, by)?.id).toBe(3)
    expect(checkpointProgress(cp(2), by)).toMatchObject({ seen: 1, total: 11 })
  })

  it('says what to do about the list that is due, and nothing while ages are not judged', () => {
    const none = checkpointProgress(cp(2), loggedByTitle([]))
    expect(checklistLine(cp(2), none, 'Ada', false)).toMatchObject({ tone: 'ask', text: expect.stringContaining('11 on the 2-month list are not marked') })
    const all = checkpointProgress(cp(2), loggedByTitle(cp(2).items.map((i, n) => entry(n, i.text))))
    expect(checklistLine(cp(2), all, 'Ada', false)).toEqual({ tone: 'ok', text: 'Everything on the 2-month list is marked.' })
    const one = checkpointProgress(cp(2), loggedByTitle(cp(2).items.slice(1).map((i, n) => entry(n, i.text))))
    expect(checklistLine(cp(2), one, 'Ada', false)?.text).toContain('1 on the 2-month list is not marked')
    expect(checklistLine(cp(2), none, 'Ada', true)).toBeNull()
    expect(checklistLine(null, null, 'Ada', false)).toBeNull()
  })

  it('offers the sheet what is not marked yet on CDC’s lists, and nothing else under that heading', () => {
    const s = milestoneSuggestions(2.5, [entry(1, 'Looks at your face')])
    expect(s.label).toBe('On the 2-month list')
    expect(s.items.map((i) => i.text)).not.toContain('Looks at your face')
    expect(s.items[0]).toEqual({ text: 'Calms down when spoken to or picked up', category: 'social' })
    expect(s.items.every((i) => itemForTitle(i.text))).toBe(true)
    expect(milestoneSuggestions(1, []).label).toBe('Coming up by 2 months')
  })

  it('keeps a first off the sheet until the age it starts to happen', () => {
    const firsts = (months: number, logged: Milestone[] = []) => milestoneSuggestions(months, logged).firsts.map((i) => i.text)
    // The owner's screenshot (2026-11-11): a baby under 2 months was offered a tooth, solids, crawling and the potty.
    expect(firsts(1.8)).toEqual([])
    expect(firsts(3.9)).toEqual([])
    expect(firsts(4)).toEqual(['First tooth', 'First solids'])
    expect(firsts(6)).toEqual(['First tooth', 'First solids', 'Crawls'])
    expect(firsts(17.9)).not.toContain('Potty trained')
    expect(firsts(18)).toContain('Potty trained')
    expect(firsts(8, [entry(2, 'First tooth')])).toEqual(['First solids', 'Crawls'])
    expect(KEEPSAKES.every((k) => !itemForTitle(k.text))).toBe(true)
  })
})

describe('hearing follow-up after the NICU', () => {
  const now = new Date(2026, 10, 10)
  const child = { birth_date: '2026-09-22' }
  it('a stay of five days or more calls for it; a shorter one, or none, does not', () => {
    expect(hearingFollowUp(ageBasis(child, { nicu: { since: '2026-09-22', home: '2026-10-05' } }), 1.6, now)).toEqual({ days: 13, ongoing: false })
    expect(hearingFollowUp(ageBasis(child, { nicu: { since: '2026-09-22', home: '2026-09-25' } }), 1.6, now)).toBeNull()
    expect(hearingFollowUp(ageBasis(child, {}), 1.6, now)).toBeNull()
    expect(hearingFollowUp(ageBasis(child, { nicu: { since: '2026-09-22', home: null } }), 1.6, now)).toEqual({ days: 49, ongoing: true })
    expect(hearingFollowUp(ageBasis(child, { nicu: { since: '2026-09-22', home: '2026-10-05' } }), 40, now)).toBeNull()
  })
})
