import { describe, expect, it } from 'vitest'
import { areaTally, dayKey, doneOn, ideaById, ideaOf, ideaTag, nextStage, PLAY_AREAS, PLAY_SOURCES, PLAY_STAGES, stageFor, todaysIdeas, tummyGuide } from './play'

describe('play ideas by age', () => {
  it('every stage has ideas in at least three areas, each with a title, a source and an id of its own', () => {
    const ids = new Set<string>()
    for (const stage of PLAY_STAGES) {
      expect(stage.ideas.length, stage.id).toBeGreaterThanOrEqual(9)
      expect(new Set(stage.ideas.map((i) => i.area)).size, stage.id).toBeGreaterThanOrEqual(3)
      for (const idea of stage.ideas) {
        expect(idea.id.startsWith(`${stage.id}-`), idea.id).toBe(true)
        expect(ids.has(idea.id), idea.id).toBe(false)
        ids.add(idea.id)
        expect(idea.title.length, idea.id).toBeGreaterThan(2)
        expect(idea.title.endsWith('.'), idea.id).toBe(false)
        expect(idea.text.length, idea.id).toBeGreaterThan(20)
        expect(idea.src.length, idea.id).toBeGreaterThan(0)
        for (const s of idea.src) expect(PLAY_SOURCES[s], `${idea.id} ${s}`).toBeDefined()
        expect(PLAY_AREAS.some((a) => a.id === idea.area), idea.id).toBe(true)
      }
    }
  })

  it("CDC's words are kept but for the child's pronouns: no he or she is left, and no list is used before its age", () => {
    for (const stage of PLAY_STAGES.slice(1)) {
      expect(stage.ideas.every((i) => i.src.length === 1 && i.src[0].startsWith('cdc-')), stage.id).toBe(true)
      // What a parent is quoted as saying may be about someone else ("He looks sad. Let's bring him a teddy.").
      for (const idea of stage.ideas) expect(/\b(he|she|him|his|himself|herself|he\/she)\b/i.test(`${idea.text} ${idea.why}`.replace(/"[^"]*"/g, '')), idea.id).toBe(false)
    }
    // The first weeks are not CDC's (its lists start at 2 months), and nothing in them is CDC's.
    expect(PLAY_STAGES[0].ideas.some((i) => i.src.some((s) => s.startsWith('cdc-')))).toBe(false)
    expect(stageFor(1.9).id).toBe('m0')
    expect(stageFor(2).id).toBe('m2')
  })

  it('the stage follows the age, with no gap or overlap from birth to five years', () => {
    expect(stageFor(-0.5).id).toBe('m0')
    expect(stageFor(3.2).label).toBe('2 to 4 months')
    expect(stageFor(11.9).id).toBe('m9')
    expect(stageFor(12).id).toBe('m12')
    expect(stageFor(29).id).toBe('m24')
    expect(stageFor(70).id).toBe('m60')
    for (let i = 1; i < PLAY_STAGES.length; i++) expect(PLAY_STAGES[i].from).toBe(PLAY_STAGES[i - 1].to)
    expect(nextStage(stageFor(3))?.id).toBe('m4')
    expect(nextStage(stageFor(70))).toBeNull()
  })

  it("today's three are from three different areas, the same on every phone, and change with the day", () => {
    const stage = stageFor(3)
    const today = todaysIdeas(stage, '2026-11-18', 1)
    expect(today).toHaveLength(3)
    expect(new Set(today.map((i) => i.area)).size).toBe(3)
    expect(todaysIdeas(stage, '2026-11-18', 1).map((i) => i.id)).toEqual(today.map((i) => i.id))
    expect(todaysIdeas(stage, '2026-11-19', 1).map((i) => i.id)).not.toEqual(today.map((i) => i.id))
    expect(todaysIdeas(stage, '2026-11-18', 1, 3, 1).map((i) => i.id)).not.toEqual(today.map((i) => i.id))
  })

  it('over a few weeks every idea of the stage has had a day', () => {
    for (const stage of [stageFor(1), stageFor(3), stageFor(13)]) {
      const seen = new Set<string>()
      for (let d = 1; d <= 60; d++) for (const i of todaysIdeas(stage, `2026-${d <= 30 ? '11' : '12'}-${String(d <= 30 ? d : d - 30).padStart(2, '0')}`, 4)) seen.add(i.id)
      expect(seen.size, stage.id).toBe(stage.ideas.length)
    }
  })

  it('a done idea is a tagged entry: found for its day, counted by area over the week', () => {
    const stage = stageFor(3)
    const [a, b] = stage.ideas
    const now = new Date(2026, 10, 18, 15, 0)
    const at = (daysAgo: number, hour: number) => new Date(2026, 10, 18 - daysAgo, hour, 0).toISOString()
    const entries = [
      { id: 1, start: at(0, 9), tags: ['caregiver:mom', ideaTag(a.id)] },
      { id: 2, start: at(0, 14), tags: [ideaTag(a.id)] },
      { id: 3, start: at(2, 10), tags: [ideaTag(b.id)] },
      { id: 4, start: at(8, 10), tags: [ideaTag(b.id)] }, // older than the week
      { id: 5, start: at(0, 11), tags: ['caregiver:dad'] }, // a Play entry logged by hand: no idea
      { id: 6, start: at(1, 11), tags: ['idea:gone-from-the-list'] },
    ]
    expect(ideaOf(entries[0].tags)).toBe(a.id)
    expect(ideaById(a.id)?.title).toBe(a.title)
    const today = doneOn(entries, dayKey(now))
    expect([...today.keys()]).toEqual([a.id])
    expect(today.get(a.id)?.id).toBe(2) // the latest of the day
    const tally = areaTally(entries, now)
    expect(tally.total).toBe(3)
    expect(tally[a.area]).toBeGreaterThanOrEqual(2)
  })

  it("tummy time is the AAP's figure for the age", () => {
    expect(tummyGuide(10)).toMatch(/2 or 3 short spells a day of 3 to 5 minutes/)
    expect(tummyGuide(49)).toMatch(/15 to 30 minutes over the day/)
  })
})
