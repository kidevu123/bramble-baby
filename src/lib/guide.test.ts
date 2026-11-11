import { describe, expect, it } from 'vitest'
import { entrySources, GUIDE, GUIDE_SOURCES, guideIndexFor, guidePushPlan, NOT_YET, notYetFor, periodMonths, periodText, WEEKS } from './guide'
import { ageBasis } from './preterm'

const all = (e: (typeof GUIDE)[number]) => [...e.notice, ...(e.normal ?? []), ...notYetFor(e), ...(e.care ?? []), ...e.helps, ...(e.visit ?? []), ...(e.you ?? []), ...(e.call ?? [])]

describe('the guide by age', () => {
  it('covers every age without a gap: thirteen weeks, then months to five years', () => {
    const weeks = GUIDE.filter((e) => e.unit === 'week')
    expect(weeks).toHaveLength(WEEKS)
    weeks.forEach((e, i) => expect([e.from, e.to]).toEqual([i * 7, i * 7 + 7]))
    const months = GUIDE.filter((e) => e.unit === 'month')
    expect(months[0].from).toBe(3)
    months.slice(1).forEach((e, i) => expect(e.from).toBe(months[i].to))
    expect(months[months.length - 1].to).toBeGreaterThan(60)
    expect(new Set(GUIDE.map((e) => e.id)).size).toBe(GUIDE.length)
  })

  it('rests every line on a named source page, and says nothing twice in one period', () => {
    for (const e of GUIDE) {
      expect(e.notice.length).toBeGreaterThanOrEqual(2)
      expect(e.helps.length).toBeGreaterThanOrEqual(2)
      for (const line of all(e)) {
        expect(line.src.length, `${e.id}: ${line.text}`).toBeGreaterThan(0)
        for (const id of line.src) expect(GUIDE_SOURCES[id], id).toBeTruthy()
        expect(line.text.length, line.text).toBeLessThan(215)
        if (line.how !== undefined) expect(line.how.length, line.how).toBeGreaterThan(20)
      }
      const texts = all(e).map((x) => x.text)
      expect(new Set(texts).size, e.id).toBe(texts.length)
      expect(entrySources(e).length).toBeGreaterThan(0)
    }
    for (const s of Object.values(GUIDE_SOURCES)) expect(s.url).toMatch(/^https:\/\/www\.(cdc\.gov|healthychildren\.org|nhs\.uk)\//)
  })

  it('says what to look for and how to see it at every age', () => {
    for (const e of GUIDE) {
      const shown = e.notice.filter((x) => x.how)
      expect(shown.length, e.id).toBeGreaterThanOrEqual(2)
      // A "how" is only ever attached to something to look for, and never repeats a line of the same period.
      for (const group of [e.normal, notYetFor(e), e.care, e.helps, e.visit, e.you, e.call]) for (const line of group ?? []) expect(line.how, line.text).toBeUndefined()
      const said = all(e).flatMap((x) => [x.text, ...(x.how ? [x.how] : [])])
      expect(new Set(said).size, e.id).toBe(said.length)
      for (const line of shown) expect(line.how!.length, line.how).toBeLessThan(215)
    }
    // Two months is CDC's first list: each thing on it is there to look for, with something to try.
    const w8 = GUIDE.find((e) => e.id === 'w8')!
    const looked = w8.notice.filter((x) => x.how).map((x) => x.text).join(' ')
    for (const item of ['Calms down when spoken to or picked up', 'Looks at your face', 'Makes sounds other than crying', 'Reacts to loud sounds', 'Watches you as you move', 'Holds the head up on the tummy']) expect(looked).toContain(item)
    expect(w8.notice.find((x) => x.text.startsWith('Reacts to loud sounds'))!.how).toContain('rattle off to one side')
    // A newborn's weeks say which reflex to look for and how to bring it out.
    expect(GUIDE[0].notice.find((x) => x.text.includes('rooting'))!.how).toContain('Stroke the cheek')
  })

  it('says what is too early to expect, and stops saying it once it is due', () => {
    const notYet = (id: string) => notYetFor(GUIDE.find((e) => e.id === id)!).map((x) => x.text).join(' | ')
    // The owner's screenshot (2026-11-11): at under two months the app pointed parents at a tooth, solids and crawling.
    for (const id of ['w0', 'w7', 'w8']) {
      expect(notYet(id)).toContain('A first tooth: teething typically starts between 4 and 7 months')
      expect(notYet(id)).toContain('Solid food: at about 6 months, and not before 4')
      expect(notYet(id)).toContain('Rolling over')
    }
    expect(notYet('w8')).not.toContain('Crawling') // too far off to mention at two months; it comes into view from 3
    expect(notYet('w2')).toContain('A real smile')
    expect(notYet('w6')).not.toContain('A real smile') // due: it is under "what to look for" by then
    expect(notYet('m4')).not.toContain('tooth')
    expect(notYet('m4')).toContain('Sitting without support: most babies do by 9 months')
    expect(notYet('m6')).not.toContain('Solid food')
    expect(notYet('m12')).toContain('Toilet training')
    expect(notYet('m60')).toBe('')
    for (const e of GUIDE) expect(notYetFor(e).length, e.id).toBeLessThanOrEqual(6)
    for (const n of NOT_YET) expect(n.until).toBeGreaterThan(n.from)
    // Every newborn week reassures about something that looks alarming and is not.
    for (const id of ['w0', 'w1', 'w2', 'w3', 'w4']) expect(GUIDE.find((e) => e.id === id)!.normal!.length, id).toBeGreaterThanOrEqual(2)
  })

  it('keeps the facts where their sources put them', () => {
    const text = (id: string) => all(GUIDE.find((e) => e.id === id)!).map((x) => x.text).join(' ')
    expect(text('w0')).toContain('100.4')
    expect(text('w1')).toContain('between 1 and 3 weeks')
    expect(text('w5')).toContain('peak at about 6 weeks')
    expect(text('w6')).toContain('about 3 hours a day')
    expect(text('w5')).toContain('around the sixth week')
    expect(text('w8')).toContain('2-month check-up')
    // the under-3-months fever rule stops at 12 weeks
    expect(text('w11')).toContain('100.4')
    expect(text('w12')).not.toContain('100.4')
    expect(text('m6')).toContain('about 6 months')
    expect(text('m9')).toContain('developmental screening')
    expect(text('m18')).toContain('autism')
  })
})

describe('the weekly note', () => {
  it('gives the companion this period and the ones after it, each on its first day', () => {
    // Born Sep 16: Nov 11 is day 56, the first day of week 8.
    const plan = guidePushPlan('2026-09-16', new Date(2026, 10, 11, 10), 'Ada')
    expect(plan).toHaveLength(8)
    expect(plan.map((p) => p.id).slice(0, 6)).toEqual(['w8', 'w9', 'w10', 'w11', 'w12', 'm3'])
    expect(plan[0]).toMatchObject({ day: '2026-11-11', title: 'Ada is 8 weeks old' })
    expect(plan[1].day).toBe('2026-11-18')
    expect(plan[5]).toMatchObject({ day: '2026-12-16', title: 'Ada is 3 months old' })
    const lines = plan[0].body.split('\n')
    expect(lines[0]).toBe('Two months: the first checklist, and the 2-month visit.')
    expect(lines[1]).toBe('Look for: Calms down when spoken to or picked up; Looks at your face, and smiles when you talk or smile.')
    expect(lines[2]).toMatch(/^Tap for what to try/)
    for (const p of plan) {
      expect(p.title.length).toBeLessThan(120)
      expect(p.body.length).toBeLessThan(600)
    }
    expect(guidePushPlan('2026-11-10', new Date(2026, 10, 11, 10), 'Ada')[0].title).toBe('Ada’s first week')
    // Every period of the guide makes a note the companion accepts (id, lengths), not only the first weeks.
    for (let i = 0; i < GUIDE.length; i++) {
      const e = GUIDE[i]
      expect(e.id.length).toBeLessThanOrEqual(12)
      expect(`${e.headline}. Look for: ${e.notice.filter((x) => x.how).slice(0, 2).map((x) => x.text).join('; ')}`.length, e.id).toBeLessThan(520)
    }
  })
})

describe('which period', () => {
  const at = (birth: string, now: Date) => GUIDE[guideIndexFor(birth, now)].id
  it('weeks until three months, then the month and checklist ages', () => {
    expect(at('2026-11-10', new Date(2026, 10, 10))).toBe('w0')
    expect(at('2026-11-10', new Date(2026, 10, 16))).toBe('w0')
    expect(at('2026-11-10', new Date(2026, 10, 17))).toBe('w1')
    expect(at('2026-09-22', new Date(2026, 10, 10))).toBe('w7')
    expect(at('2026-09-22', new Date(2026, 11, 21))).toBe('w12')
    expect(at('2026-09-22', new Date(2026, 11, 22))).toBe('m3')
    expect(at('2026-01-10', new Date(2026, 10, 10))).toBe('m10')
    expect(at('2025-09-10', new Date(2026, 10, 10))).toBe('m12')
    expect(at('2025-03-10', new Date(2026, 10, 10))).toBe('m18')
    expect(at('2019-03-10', new Date(2026, 10, 10))).toBe('m60')
  })

  it('counts from the due date for a baby born early, and starts at the first week before it', () => {
    // 30 weeks: due 70 days after the birth (Dec 1)
    const early = ageBasis({ birth_date: '2026-09-22' }, { bornAtDays: 210 })
    expect(GUIDE[guideIndexFor(early, new Date(2026, 10, 10))].id).toBe('w0')
    expect(GUIDE[guideIndexFor(early, new Date(2026, 11, 16))].id).toBe('w2')
    expect(periodText(GUIDE[0], early, new Date(2026, 11, 16))).toBe('Dec 1 – Dec 7')
  })

  it('dates each period for the child and gives its age for the checklists', () => {
    const now = new Date(2026, 10, 10)
    expect(periodText(GUIDE[7], '2026-09-22', now)).toBe('Nov 10 – Nov 16')
    expect(periodText(GUIDE.find((e) => e.id === 'm4')!, '2026-09-22', now)).toBe('Jan 22, 2027 – Feb 21, 2027')
    expect(periodText(GUIDE[GUIDE.length - 1], '2026-09-22', now)).toBe('from Sep 22, 2031')
    expect(periodMonths(GUIDE[8])).toBeCloseTo(1.84, 1)
    expect(periodMonths(GUIDE.find((e) => e.id === 'm9')!)).toBe(9)
  })
})
