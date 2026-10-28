import { describe, expect, it } from 'vitest'
import { QUESTIONNAIRE, generatePlan, sleepStats, type Answers } from './sleepplan'
import type { EventSets } from './events'
import type { Sleep } from './api/types'

const empty: EventSets = { sleep: [], feedings: [], changes: [], pumping: [], tummy: [], temperature: [], medication: [], notes: [], activities: [], milestones: [], contractions: [] }
const now = new Date('2026-09-01T12:00:00')

const sleep = (id: number, start: string, end: string, nap: boolean): Sleep => {
  const secs = (new Date(end).getTime() - new Date(start).getTime()) / 1000
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return { id, child: 1, start, end, duration: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`, nap, notes: null, tags: [] }
}

function week(): Sleep[] {
  const out: Sleep[] = []
  let id = 1
  for (let d = 25; d <= 31; d++) {
    const next = d + 1 > 31 ? '09-01' : `08-${d + 1}`
    out.push(sleep(id++, `2026-08-${d}T19:30:00`, `2026-08-${d}T23:30:00`, false))
    out.push(sleep(id++, `2026-08-${d}T23:45:00`, `2026-${next}T06:30:00`, false))
    out.push(sleep(id++, `2026-08-${d}T09:00:00`, `2026-08-${d}T09:35:00`, true))
    out.push(sleep(id++, `2026-08-${d}T13:00:00`, `2026-08-${d}T13:40:00`, true))
  }
  return out
}

const base: Answers = {
  location: 'crib-own-room',
  'fall-asleep': 'rocked',
  wakings: '3-4',
  'waking-response': ['feed', 'rock'],
  'nap-trouble': 'short',
  routine: 'no',
  bedtime: '19:30',
  'wake-time': '06:30',
  goal: 'sleep-through',
  method: 'check-console',
  medical: ['none'],
}

describe('QUESTIONNAIRE', () => {
  it('has around ten questions with ids', () => {
    expect(QUESTIONNAIRE.length).toBeGreaterThanOrEqual(10)
    expect(new Set(QUESTIONNAIRE.map((q) => q.id)).size).toBe(QUESTIONNAIRE.length)
  })
  it('gives options to choice questions', () => {
    for (const q of QUESTIONNAIRE) if (q.type === 'single' || q.type === 'multi') expect(q.options?.length).toBeGreaterThan(1)
  })
})

describe('sleepStats', () => {
  it('computes bedtime, wake, wakings and nap average from the last week', () => {
    const s = sleepStats({ ...empty, sleep: week() }, now)
    expect(s.avgBedtime).toBe('19:30')
    expect(s.avgWake).toBe('06:30')
    expect(s.nightWakings).toBe(1)
    expect(s.avgNapMinutes).toBeGreaterThanOrEqual(37)
    expect(s.avgNapMinutes).toBeLessThanOrEqual(38)
  })
  it('returns nulls with no data', () => {
    const s = sleepStats(empty, now)
    expect(s.avgBedtime).toBeNull()
    expect(s.avgNapMinutes).toBeNull()
  })
})

describe('generatePlan', () => {
  it('never sleep-trains under 4 months', () => {
    const plan = generatePlan({ ageMonths: 2, answers: { ...base, method: 'check-console' }, events: empty, now, childName: 'Oscar' })
    expect(plan.method.name).toBe('Soothing rhythms')
    expect(plan.title).toMatch(/rhythm/)
    expect(plan.steps.some((s) => /day–night/i.test(s.title))).toBe(true)
  })
  it('uses gentle fading between 4 and 6 months even if check-ins requested', () => {
    const plan = generatePlan({ ageMonths: 5, answers: { ...base, method: 'check-console' }, events: empty, now, childName: 'Oscar' })
    expect(plan.method.name).toBe('Gentle fading')
  })
  it('honors the chosen method at 6+ months with the graduated intervals', () => {
    const plan = generatePlan({ ageMonths: 7, answers: base, events: empty, now, childName: 'Oscar' })
    expect(plan.method.name).toBe('Graduated check-ins')
    expect(plan.method.nightWakingProtocol.join(' ')).toMatch(/3, 5/)
  })
  it('maps chair preference', () => {
    expect(generatePlan({ ageMonths: 9, answers: { ...base, method: 'chair' }, events: empty, now, childName: 'O' }).method.name).toBe('Chair method')
  })
  it('mentions real numbers in the summary when data exists', () => {
    const plan = generatePlan({ ageMonths: 7, answers: base, events: { ...empty, sleep: week() }, now, childName: 'Oscar' })
    expect(plan.summary).toMatch(/7:30 PM/)
    expect(plan.summary).toMatch(/6:30 AM/)
  })
  it('adds the crib hour for short naps at 6+ months', () => {
    const plan = generatePlan({ ageMonths: 8, answers: base, events: empty, now, childName: 'Oscar' })
    expect(plan.naps.join(' ')).toMatch(/crib hour/i)
  })
  it('caps naps for toddlers', () => {
    const plan = generatePlan({ ageMonths: 14, answers: { ...base, 'nap-trouble': 'fine' }, events: empty, now, childName: 'Oscar' })
    expect(plan.naps.join(' ')).toMatch(/Cap total daytime sleep/)
  })
  it('builds the schedule from the answered wake time', () => {
    const plan = generatePlan({ ageMonths: 7, answers: base, events: empty, now, childName: 'Oscar' })
    expect(plan.schedule[0]).toMatchObject({ kind: 'wake', start: '06:30' })
  })
  it('always includes safety guidance', () => {
    const plan = generatePlan({ ageMonths: 1, answers: {}, events: empty, now, childName: 'Oscar' })
    expect(plan.safety.length).toBeGreaterThanOrEqual(4)
    expect(plan.safety.join(' ')).toMatch(/back/i)
  })
  it('adjusts feeding guidance by age', () => {
    expect(generatePlan({ ageMonths: 10, answers: base, events: empty, now, childName: 'O' }).method.nightWakingProtocol.join(' ')).toMatch(/do not need night feeds/)
    expect(generatePlan({ ageMonths: 5, answers: base, events: empty, now, childName: 'O' }).method.nightWakingProtocol.join(' ')).toMatch(/still normal/)
  })
  it('acknowledges medical notes in expectations', () => {
    const plan = generatePlan({ ageMonths: 7, answers: { ...base, medical: ['teething'] }, events: empty, now, childName: 'Oscar' })
    expect(plan.expectations).toMatch(/teething/)
  })
})

describe('eveningOf (bedtimes after midnight)', () => {
  it('counts a 00:30 bedtime for the previous evening, 24 h past its midnight', async () => {
    const { eveningOf } = await import('./sleepplan')
    const late = new Date(2026, 8, 30, 0, 30)
    const e = eveningOf(late)
    expect(e?.key).toBe(new Date(2026, 8, 29).toDateString())
    expect(e?.mins).toBe(1440 + 30)
    expect(eveningOf(new Date(2026, 8, 29, 19, 15))).toEqual({ key: new Date(2026, 8, 29).toDateString(), mins: 19 * 60 + 15 })
    expect(eveningOf(new Date(2026, 8, 29, 13, 0))).toBeNull()
  })
})
