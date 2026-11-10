import { describe, expect, it } from 'vitest'
import { entrySources, GUIDE, GUIDE_SOURCES, guideIndexFor, periodMonths, periodText, WEEKS } from './guide'
import { ageBasis } from './preterm'

const all = (e: (typeof GUIDE)[number]) => [...e.notice, ...(e.care ?? []), ...e.helps, ...(e.visit ?? []), ...(e.you ?? []), ...(e.call ?? [])]

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
        expect(line.text.length, line.text).toBeLessThan(200)
      }
      const texts = all(e).map((x) => x.text)
      expect(new Set(texts).size, e.id).toBe(texts.length)
      expect(entrySources(e).length).toBeGreaterThan(0)
    }
    for (const s of Object.values(GUIDE_SOURCES)) expect(s.url).toMatch(/^https:\/\/www\.(cdc\.gov|healthychildren\.org|nhs\.uk)\//)
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
