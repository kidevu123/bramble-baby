import { describe, expect, it } from 'vitest'
import type { MilkBag } from './api/companion'
import { freeSpots, nightBottleSources, planNightBottles, stashItemName, bagAmountIn, bagStamp, sectionPreview, stashSections, bagLeft, bagState, bagVolume, describeUse, expectedExpiry, formatMl, formatTimeLeft, giveBackCopy, intakeProblem, isPartlyUsed, placeNote, newClientKey, nextIntakeDraft, parseQrPayload, planTakes, planUse, pumpedWhen, qrPayload, stashHint, stashOrder, summarizeStash, takesCopy, toMl, takeCopy, windowLabel, type IntakeDraft } from './milk'

const now = new Date('2026-09-30T12:00:00Z')
const bag = (over: Partial<MilkBag>): MilkBag => ({
  id: 1, child: 6, code: 'ABCDEF', pumped_at: '2026-09-29T12:00:00+00:00', volume_ml: 118.29, location: 'fridge', thawed: false,
  expires_at: '2026-10-03T12:00:00+00:00', status: 'stored', pumping_id: null, feeding_id: null, notes: '', created: '', created_by: null, used_at: null, used_by: null, uses: [],
  ...over, remaining_ml: over.remaining_ml ?? over.volume_ml ?? 118.29,
})

describe('milk QR payload', () => {
  it('round-trips a code and accepts a bare code typed by hand', () => {
    expect(qrPayload('abc234')).toBe('bramble:milk:ABC234')
    expect(parseQrPayload('bramble:milk:ABC234')).toBe('ABC234')
    expect(parseQrPayload(' abc234 ')).toBe('ABC234')
  })
  it('rejects anything that is not one of ours', () => {
    expect(parseQrPayload('https://example.com')).toBeNull()
    expect(parseQrPayload('bramble:milk:ABC10O')).toBeNull() // 1, 0 and O are not in the alphabet
    expect(parseQrPayload('')).toBeNull()
  })
})

describe('bag state', () => {
  it('matches the server reminder thresholds per location', () => {
    expect(bagState(bag({ expires_at: '2026-10-03T12:00:00+00:00' }), now)).toBe('fresh')
    expect(bagState(bag({ expires_at: '2026-09-30T20:00:00+00:00' }), now)).toBe('soon') // 8 h left in the fridge
    expect(bagState(bag({ location: 'freezer', expires_at: '2026-10-05T12:00:00+00:00' }), now)).toBe('soon') // 5 days left frozen
    expect(bagState(bag({ location: 'room', expires_at: '2026-09-30T13:30:00+00:00' }), now)).toBe('fresh') // 90 min at room temp
    expect(bagState(bag({ expires_at: '2026-09-30T11:59:00+00:00' }), now)).toBe('expired')
    expect(bagState(bag({ expires_at: '2026-09-30T12:00:30+00:00' }), now)).toBe('soon') // 30 s left is not expired yet
    expect(bagState(bag({ expires_at: '2026-10-01T00:00:30+00:00' }), now)).toBe('fresh') // 12 h 30 s left is not "soon" yet
  })
})

describe('volumes', () => {
  it('formats and prefills in the phone unit', () => {
    expect(bagVolume(bag({}), 'oz')).toBe('4 oz')
    expect(bagVolume(bag({}), 'ml')).toBe('118 mL')
    expect(bagAmountIn(bag({}), 'oz')).toBe(4)
    expect(bagAmountIn(bag({}), 'ml')).toBe(118)
    expect(toMl(4, 'oz')).toBe(118.29)
    expect(toMl(120, 'ml')).toBe(120)
    expect(formatMl(80, 'ml')).toBe('80 mL')
    expect(formatMl(80, 'oz')).toBe('2.7 oz')
    expect(formatMl(0.4, 'ml')).toBe('0 mL')
  })
})

describe('partly used bags', () => {
  const part = bag({ volume_ml: 120, remaining_ml: 80, code: '6SZTHB' })
  it('shows the balance against the label volume, and a full bag as just its volume', () => {
    expect(isPartlyUsed(bag({ volume_ml: 120 }))).toBe(false)
    expect(isPartlyUsed(part)).toBe(true)
    expect(isPartlyUsed(bag({ volume_ml: 120, remaining_ml: 0, status: 'used' }))).toBe(false)
    expect(isPartlyUsed(bag({ volume_ml: 120, remaining_ml: 119.8 }))).toBe(false) // display rounding is not a use
    expect(bagLeft(bag({ volume_ml: 120 }), 'ml')).toBe('120 mL')
    expect(bagLeft(part, 'ml')).toBe('80 of 120 mL')
    expect(bagLeft(part, 'oz')).toBe('2.7 of 4.1 oz')
    // a used-up bag reads as what it held; a discarded one with milk still in it keeps its balance
    expect(bagLeft(bag({ volume_ml: 120, remaining_ml: 0, status: 'used' }), 'ml')).toBe('120 mL')
    expect(bagLeft(bag({ volume_ml: 120, remaining_ml: 80, status: 'discarded' }), 'ml')).toBe('80 of 120 mL')
  })
  it('prefills a bottle with what is left, not with the label volume', () => {
    expect(bagAmountIn(part, 'ml')).toBe(80)
    expect(bagAmountIn(part, 'oz')).toBe(2.71)
  })
  it('counts the stash by what is left in the bags', () => {
    const s = summarizeStash([part, bag({ id: 2, volume_ml: 100 })], now)
    expect(s.totalMl).toBe(180)
    expect(s.byLocation.fridge).toEqual({ count: 2, ml: 180 })
  })
  it('plans a bottle from a bag: what it takes, what stays, when the bag empties, when it is too much', () => {
    expect(planUse(part, 40, 'ml')).toEqual({ takeMl: 40, leftMl: 40, empties: false, over: false })
    expect(planUse(part, 80, 'ml')).toEqual({ takeMl: 80, leftMl: 0, empties: true, over: false })
    expect(planUse(part, 79.5, 'ml')).toEqual({ takeMl: 79.5, leftMl: 0, empties: true, over: false }) // under a millilitre is empty
    expect(planUse(part, 2.8, 'oz')).toMatchObject({ takeMl: 80, leftMl: 0, empties: true, over: false }) // 82.8 mL typed as oz: a hair over takes the balance
    expect(planUse(part, 90, 'ml')).toEqual({ takeMl: 80, leftMl: 0, empties: true, over: true })
    expect(planUse(part, 0, 'ml')).toEqual({ takeMl: 0, leftMl: 80, empties: false, over: false })
  })
  it('says what saving the bottle will do, in the phone unit', () => {
    expect(takeCopy(bag({ volume_ml: 120, code: '6SZTHB' }), 40, 'ml')).toBe('40 mL from bag 6SZTHB · 80 mL stays in the stash')
    expect(takeCopy(part, 40, 'ml')).toBe('40 mL from bag 6SZTHB · 40 mL stays in the stash')
    expect(takeCopy(part, 80, 'ml')).toBe('All 80 mL from bag 6SZTHB · the bag leaves the stash')
    expect(takeCopy(part, 90, 'ml')).toBe('Only 80 mL is left in bag 6SZTHB. Make the bottle smaller, or set what is left in the bag from the Stash tab.')
    expect(takeCopy(part, 0, 'ml')).toBe('Set the amount to take from bag 6SZTHB')
    expect(takeCopy(part, 1, 'oz')).toBe('1 oz from bag 6SZTHB · 1.7 oz stays in the stash')
  })
  it('describes each use for the bag history', () => {
    const at = '2026-09-30T08:50:00+00:00'
    expect(describeUse({ id: 1, bag: 1, feeding_id: 21, amount_ml: 40, kind: 'bottle', at, by_user: 7 }, 'ml')).toBe('40 mL bottle')
    expect(describeUse({ id: 2, bag: 1, feeding_id: null, amount_ml: 80, kind: 'elsewhere', at, by_user: 7 }, 'ml')).toBe('80 mL used without a bottle')
    expect(describeUse({ id: 3, bag: 1, feeding_id: null, amount_ml: 30, kind: 'adjust', at, by_user: 7 }, 'ml')).toBe('30 mL less, set by hand')
    expect(describeUse({ id: 4, bag: 1, feeding_id: null, amount_ml: -30, kind: 'adjust', at, by_user: 7 }, 'ml')).toBe('30 mL more, set by hand')
  })
})

describe('stash summary and order', () => {
  const bags = [
    bag({ id: 1, expires_at: '2026-10-02T12:00:00+00:00' }),
    bag({ id: 2, expires_at: '2026-09-30T18:00:00+00:00' }), // soon
    bag({ id: 3, expires_at: '2026-09-30T09:00:00+00:00' }), // expired
    bag({ id: 4, location: 'freezer', volume_ml: 150, expires_at: '2027-03-01T00:00:00+00:00' }),
    bag({ id: 5, status: 'used', expires_at: '2026-10-02T12:00:00+00:00' }),
  ]
  it('counts only stored bags and picks the soonest usable one first', () => {
    const s = summarizeStash(bags, now)
    expect(s.count).toBe(4)
    expect(Math.round(s.totalMl)).toBe(505)
    expect(s.byLocation.freezer).toEqual({ count: 1, ml: 150 })
    expect(s.useFirst?.id).toBe(2)
    expect(s.expiringSoon).toBe(1)
    expect(s.expired).toBe(1)
  })
  it('orders soonest deadline first, expired last', () => {
    expect(stashOrder(bags, now).map((b) => b.id)).toEqual([2, 1, 4, 3])
  })
  it('puts a room-temperature bag due sooner above a fridge bag already "expiring soon", like Use first', () => {
    const at = new Date('2026-10-11T21:00:00Z')
    const fridge = bag({ id: 7, location: 'fridge', expires_at: '2026-10-12T02:25:00+00:00' }) // 5 h 25 left: soon (12 h lead)
    const room = bag({ id: 8, location: 'room', expires_at: '2026-10-12T00:37:00+00:00' }) // 3 h 37 left: fresh (1 h lead)
    expect(stashOrder([fridge, room], at).map((b) => b.id)).toEqual([8, 7])
    expect(summarizeStash([fridge, room], at).useFirst?.id).toBe(8)
  })
})

describe('the Stash list in places', () => {
  const at = new Date('2026-10-11T19:00:00Z')
  const list = [
    bag({ id: 1, location: 'freezer', expires_at: '2027-04-06T12:00:00+00:00', remaining_ml: 57 }),
    bag({ id: 2, location: 'fridge', expires_at: '2026-10-14T16:44:00+00:00', remaining_ml: 48 }),
    bag({ id: 3, location: 'room', expires_at: '2026-10-11T20:05:00+00:00', remaining_ml: 78 }),
    bag({ id: 4, location: 'fridge', expires_at: '2026-10-10T08:00:00+00:00' }), // expired
    bag({ id: 5, location: 'fridge', expires_at: '2026-10-13T05:09:00+00:00', remaining_ml: 70 }),
    bag({ id: 6, location: 'freezer', status: 'used' }),
  ]
  it('groups room, fridge, freezer, then expired, each soonest first, leaving used bags and empty places out', () => {
    const sections = stashSections(list, at)
    expect(sections.map((s) => s.key)).toEqual(['room', 'fridge', 'freezer', 'expired'])
    expect(sections.map((s) => s.bags.map((b) => b.id))).toEqual([[3], [5, 2], [1], [4]])
    expect(sections[1]).toMatchObject({ title: 'Fridge', ml: 118 })
    expect(stashSections(list.filter((b) => b.location !== 'room'), at).map((s) => s.key)).toEqual(['fridge', 'freezer', 'expired'])
  })
  it('shows a short section whole, a long one three rows at a time, and the freezer one', () => {
    expect([1, 3, 4, 5, 30].map((n) => sectionPreview(n))).toEqual([1, 3, 4, 3, 3])
    // The freezer: the next bag to thaw, the rest behind the button (two stay whole).
    expect([1, 2, 3, 9].map((n) => sectionPreview(n, 'freezer'))).toEqual([1, 2, 1, 1])
  })
  it('writes a moment short: today, a weekday within the week either way, else the date', () => {
    const now = new Date(2026, 9, 11, 15, 0) // Sunday 11 Oct 2026
    expect(bagStamp(new Date(2026, 9, 11, 12, 5), now)).toBe('today 12:05 PM')
    expect(bagStamp(new Date(2026, 9, 11, 16, 5), now, { today: '' })).toBe('4:05 PM')
    expect(bagStamp(new Date(2026, 9, 10, 0, 36), now)).toBe('Sat 12:36 AM')
    expect(bagStamp(new Date(2026, 9, 14, 12, 44), now)).toBe('Wed 12:44 PM')
    expect(bagStamp(new Date(2026, 9, 4, 16, 45), now)).toBe('Oct 4, 4:45 PM')
    expect(bagStamp(new Date(2027, 3, 6, 7, 45), now, { time: false })).toBe('Apr 6')
  })
})

describe('the bottle sheet and the stash', () => {
  // Local dates: "today" and weekday names follow the phone's calendar, like the sheet does.
  const noon = new Date(2026, 9, 7, 12, 0) // Wednesday 7 Oct 2026
  const at = (daysAgo: number, h = 9) => new Date(2026, 9, 7 - daysAgo, h, 0)
  it('says when a bag was pumped the way people do', () => {
    expect(pumpedWhen(at(0, 8), noon)).toBe('today')
    expect(pumpedWhen(new Date(2026, 9, 7, 23, 30), noon)).toBe('today') // later today is still today, never "in the future"
    expect(pumpedWhen(at(1), noon)).toBe('yesterday')
    expect(pumpedWhen(at(2), noon)).toBe('Mon')
    expect(pumpedWhen(at(6), noon)).toBe('Thu')
    expect(pumpedWhen(at(7), noon)).toBe('Sep 30')
    expect(pumpedWhen(at(40), noon)).toBe('Aug 28')
  })
  it('tells the sheet what is in the stash and which bag to use first, or nothing when no bag is usable', () => {
    const first = bag({ id: 2, volume_ml: 120, remaining_ml: 80, pumped_at: at(1).toISOString(), expires_at: '2026-10-09T12:00:00+00:00' })
    const later = bag({ id: 3, volume_ml: 100, pumped_at: at(0).toISOString(), expires_at: '2026-10-11T12:00:00+00:00' })
    const summary = summarizeStash([first, later, bag({ id: 4, status: 'used' })], noon)
    expect(stashHint(summary, 'ml', noon)).toBe('2 bags · use first: 80 mL from yesterday')
    expect(stashHint(summary, 'oz', noon)).toBe('2 bags · use first: 2.7 oz from yesterday')
    expect(stashHint(summarizeStash([later], noon), 'ml', noon)).toBe('1 bag · use first: 100 mL from today')
    expect(stashHint(summarizeStash([], noon), 'ml', noon)).toBeNull()
    expect(stashHint(summarizeStash([bag({ expires_at: '2026-10-01T00:00:00+00:00' })], noon), 'ml', noon)).toBeNull() // only expired milk
  })
  it('says what a bag gets back when a bottle leaves it', () => {
    expect(giveBackCopy({ code: '6SZTHB' }, { amount_ml: 40 }, 'ml')).toBe('Bag 6SZTHB gets 40 mL back')
    expect(giveBackCopy({ code: '6SZTHB' }, { amount_ml: 40 }, 'oz')).toBe('Bag 6SZTHB gets 1.4 oz back')
  })
})

describe('milk that already exists (added from the Stash tab)', () => {
  const windows = { roomHours: 4, fridgeDays: 4, freezerMonths: 6 }
  const HOUR = 3_600_000
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR)
  const draft = (over: Partial<IntakeDraft>): IntakeDraft => ({ key: 'k'.repeat(32), amountText: '60', pumpedAt: ago(72), location: 'fridge', thawed: false, thawedAt: null, ...over })

  it('counts expiry from the real pumped time, not from the moment of entry', () => {
    // pumped three days ago, four-day fridge window: one day left, not four
    const expires = expectedExpiry({ pumpedAt: ago(72), location: 'fridge' }, windows)
    expect(expires.getTime() - now.getTime()).toBe(24 * HOUR)
    expect(formatTimeLeft(expires.getTime() - now.getTime())).toBe('1 day left')
    expect(bagState({ expires_at: expires.toISOString(), location: 'fridge' }, now)).toBe('fresh')
    // five days ago: a day past the window
    const old = expectedExpiry({ pumpedAt: ago(120), location: 'fridge' }, windows)
    expect(bagState({ expires_at: old.toISOString(), location: 'fridge' }, now)).toBe('expired')
  })
  it('uses the household windows from label settings and the same month length as the server', () => {
    expect(expectedExpiry({ pumpedAt: ago(72), location: 'fridge' }, { ...windows, fridgeDays: 5 }).getTime() - now.getTime()).toBe(48 * HOUR)
    expect(expectedExpiry({ pumpedAt: ago(1), location: 'room' }, { ...windows, roomHours: 6 }).getTime() - now.getTime()).toBe(5 * HOUR)
    expect(expectedExpiry({ pumpedAt: now, location: 'freezer' }, windows).getTime() - now.getTime()).toBe(6 * 30.4375 * 24 * HOUR)
  })
  it('counts thawed milk from the thaw: 24 h in the fridge, 2 h at room temperature', () => {
    expect(expectedExpiry({ pumpedAt: ago(700), location: 'fridge', thawedAt: ago(6) }, windows).getTime() - now.getTime()).toBe(18 * HOUR)
    expect(expectedExpiry({ pumpedAt: ago(700), location: 'room', thawedAt: ago(1) }, windows).getTime() - now.getTime()).toBe(1 * HOUR)
  })
  it('names the window that applies', () => {
    expect(windowLabel('fridge', false, windows)).toBe('4-day fridge window')
    expect(windowLabel('room', false, windows)).toBe('4-hour room temperature window')
    expect(windowLabel('freezer', false, windows)).toBe('6-month freezer window')
    expect(windowLabel('fridge', true, windows)).toBe('24 hours in the fridge after thawing')
    expect(windowLabel('room', true, windows)).toBe('2 hours at room temperature after thawing')
  })
  it('says how long is left in words', () => {
    expect(formatTimeLeft(20 * 60_000)).toBe('20m left')
    expect(formatTimeLeft(5 * HOUR + 20 * 60_000)).toBe('5h 20m left')
    expect(formatTimeLeft(24 * HOUR - 20_000)).toBe('1 day left') // saved a few seconds after the minute
    expect(formatTimeLeft(29 * HOUR)).toBe('1 day 5h left')
    expect(formatTimeLeft(12 * 24 * HOUR + HOUR)).toBe('12 days left')
    expect(formatTimeLeft(122 * 24 * HOUR)).toBe('about 4 months left')
  })
  it('gives every container its own key and carries date and place to the next one, never the volume', () => {
    expect(newClientKey()).toMatch(/^[0-9a-f]{32}$/)
    expect(newClientKey()).not.toBe(newClientKey())
    const first = nextIntakeDraft(new Date('2026-09-30T12:00:42.500Z'))
    expect(first).toMatchObject({ amountText: '', location: 'fridge', thawed: false, thawedAt: null })
    expect(first.pumpedAt.toISOString()).toBe('2026-09-30T12:00:00.000Z') // defaults to now, on the minute
    const saved = draft({ location: 'freezer', pumpedAt: ago(72) })
    const next = nextIntakeDraft(now, saved)
    expect(next).toMatchObject({ amountText: '', location: 'freezer', pumpedAt: saved.pumpedAt })
    expect(next.key).not.toBe(saved.key)
  })
  it('explains what is missing before a container can be saved', () => {
    expect(intakeProblem(draft({}), now)).toBeNull()
    expect(intakeProblem(draft({ amountText: '' }), now)).toMatch(/how much/)
    expect(intakeProblem(draft({ amountText: '0' }), now)).toMatch(/how much/)
    expect(intakeProblem(draft({ pumpedAt: new Date(now.getTime() + HOUR) }), now)).toMatch(/future/)
    expect(intakeProblem(draft({ pumpedAt: new Date(now.getTime() + 30_000) }), now)).toBeNull() // "now" a moment ago
    // an expired container is not a problem here: the owner is warned and decides
    expect(intakeProblem(draft({ pumpedAt: ago(240) }), now)).toBeNull()
    expect(intakeProblem(draft({ thawed: true }), now)).toMatch(/when it was thawed/)
    expect(intakeProblem(draft({ thawed: true, thawedAt: ago(100) }), now)).toMatch(/before the milk was pumped/)
    expect(intakeProblem(draft({ thawed: true, thawedAt: new Date(now.getTime() + HOUR) }), now)).toMatch(/future/)
    expect(intakeProblem(draft({ thawed: true, thawedAt: ago(6), location: 'freezer' }), now)).toMatch(/freezer/)
    expect(intakeProblem(draft({ thawed: true, thawedAt: ago(6) }), now)).toBeNull()
  })
})

describe('planTakes / takesCopy', () => {
  const bag = (id: number, code: string, remaining: number): MilkBag => ({ id, child: 1, code, volume_ml: 120, remaining_ml: remaining, location: 'fridge', thawed: false, thawed_at: null, pumped_at: '2026-10-08T10:00:00Z', expires_at: '2026-10-12T10:00:00Z', status: 'stored', pumping_id: null, feeding_id: null, notes: '', created: '', used_at: null, used_by: null, uses: [], client_key: null } as unknown as MilkBag)
  it('fills the picked bags in order, oldest first, and the last one keeps the rest', () => {
    const plan = planTakes([bag(1, 'AAA111', 30), bag(2, 'BBB222', 80)], 60, 'ml')
    expect(plan.takes.map((t) => [t.takeMl, t.leftMl, t.empties])).toEqual([[30, 0, true], [30, 50, false]])
    expect(plan.shortMl).toBe(0)
    expect(takesCopy(plan, 'ml')).toBe('all 30 mL from bag AAA111 · 30 mL from bag BBB222 (50 mL stays) · that bag leaves the stash')
  })
  it('says what is short when the bags cannot cover the bottle, and the server would refuse it', () => {
    const plan = planTakes([bag(1, 'AAA111', 30), bag(2, 'BBB222', 20)], 60, 'ml')
    expect(plan.shortMl).toBe(10)
    expect(takesCopy(plan, 'ml')).toBe('The picked bags hold 50 mL, 10 mL short. Add another bag, make the bottle smaller, or set what is left in a bag from the Stash tab.')
  })
  it('counts what an edited bottle already took from a bag as available to it', () => {
    const plan = planTakes([bag(1, 'AAA111', 0)], 40, 'ml', () => 40)
    expect(plan.takes[0]).toMatchObject({ availableMl: 40, takeMl: 40, empties: true })
    expect(planTakes([], 40, 'ml').shortMl).toBe(40)
    expect(takesCopy(planTakes([bag(1, 'AAA111', 30)], 0, 'ml'), 'ml')).toBe('Set the amount to take from the stash')
  })
})

describe('placeNote', () => {
  const windows = { roomHours: 4, fridgeDays: 4, freezerMonths: 6 }
  const pumped = new Date(2026, 9, 11, 11, 40)
  it('kept out: the fridge deadline and the reminder an hour before', () => {
    expect(placeNote('room', pumped, windows, new Date(2026, 9, 11, 12, 0))).toEqual({ text: 'Fridge it or feed it by 3:40 PM. Bramble reminds you at 2:40 PM.', late: false })
    expect(placeNote('room', pumped, windows, new Date(2026, 9, 11, 15, 0))?.text).toBe('Fridge it or feed it by 3:40 PM. Less than an hour left.')
    expect(placeNote('room', pumped, windows, new Date(2026, 9, 11, 16, 0))).toEqual({ text: 'Pumped more than 4 hours ago: too long out for room temperature. Choose Fridge.', late: true })
  })
  it('says nothing for the fridge and the freezer window for the freezer', () => {
    expect(placeNote('fridge', pumped, windows)).toBeNull()
    expect(placeNote('freezer', pumped, windows)?.text).toBe('Good for 6 months frozen, counted from the pump.')
  })
})

describe('premade bottles', () => {
  const b = (id: number, ml: number, over: Partial<MilkBag> = {}) => bag({ id, code: `BAG00${id}`, volume_ml: ml, ...over })
  const bottle = (id: number, spot: number, ml: number, over: Partial<MilkBag> = {}) => bag({ id, code: `BOT00${id}`, kind: 'bottle', spot, volume_ml: ml, ...over })

  it('pours the milk that has to go first into the first spots, and the last bottle gets what is left', () => {
    // a bag good until tomorrow, one until Friday, one frozen, one expired, one bottle already in spot 2
    const soon = b(1, 10, { expires_at: '2026-10-01T12:00:00+00:00' })
    const later = b(2, 75, { remaining_ml: 25, expires_at: '2026-10-03T12:00:00+00:00' })
    const frozen = b(3, 100, { location: 'freezer', expires_at: '2027-03-01T12:00:00+00:00' })
    const old = b(4, 50, { expires_at: '2026-09-30T11:00:00+00:00' })
    const room = b(5, 60, { location: 'room', expires_at: '2026-09-30T15:00:00+00:00' })
    const held = bottle(6, 2, 60)
    const all = [later, frozen, old, soon, room, held]
    expect(freeSpots(all)).toEqual([1, 3, 4, 5])
    const sources = nightBottleSources(all, now)
    expect(sources.map((x) => x.id)).toEqual([5, 1, 2]) // room milk (3 PM today) first, then by deadline; never frozen, expired or a bottle
    const plan = planNightBottles(sources, 40, 3, freeSpots(all))
    expect(plan.map((p) => [p.spot, p.ml, p.short])).toEqual([[1, 40, false], [3, 40, false], [4, 15, true]])
    expect(plan[0].takes.map((t) => [t.bag.id, t.ml])).toEqual([[5, 40]])
    expect(plan[1].takes.map((t) => [t.bag.id, t.ml])).toEqual([[5, 20], [1, 10], [2, 10]])
    expect(plan[2].takes.map((t) => [t.bag.id, t.ml])).toEqual([[2, 15]])
    // nothing left: no empty bottle
    expect(planNightBottles(sources, 40, 5, [1, 3, 4, 5]).length).toBe(3)
    expect(planNightBottles([], 40, 2, [1, 2])).toEqual([])
  })

  it('a feed takes the whole bottle (what she does not finish is thrown away) and says so', () => {
    const ready = bottle(7, 3, 90)
    const plan = planTakes([ready], 70, 'ml')
    expect(plan.takes[0].takeMl).toBe(90)
    expect(plan.shortMl).toBe(0)
    expect(takesCopy(plan, 'ml')).toBe('premade bottle 3 (90 mL) · what she does not finish is thrown away')
    // more than the bottle holds is short, as with bags
    expect(planTakes([ready], 120, 'ml').shortMl).toBe(30)
    expect(stashItemName(ready)).toBe('Premade bottle 3')
    expect(stashItemName(b(1, 10))).toBe('Bag BAG001')
  })

  it('has its own block on the Stash tab, and the bottle sheet hint counts bags only', () => {
    const ready = bottle(7, 1, 60)
    const gone = bottle(8, 2, 60, { expires_at: '2026-09-30T11:00:00+00:00' })
    const sections = stashSections([ready, gone, b(1, 10)], now)
    expect(sections.map((x) => [x.key, x.bags.map((y) => y.id)])).toEqual([['fridge', [1]], ['expired', [8]]])
    const summary = summarizeStash([ready, b(1, 10)], now)
    expect(summary.bottles.map((x) => x.id)).toEqual([7])
    expect(summary.useFirst?.id).toBe(1)
    expect(stashHint(summary, 'ml', now)).toBe('1 bag · use first: 10 mL from yesterday')
    expect(describeUse({ id: 1, bag: 1, feeding_id: null, amount_ml: 30, kind: 'combined', at: '', by_user: null, into_bag: 7 }, 'ml')).toBe('30 mL into a premade bottle')
  })
})

describe('planTakes and premade bottles (sweep 2026-10-21)', () => {
  it('leaves a premade bottle alone when the bags picked before it already cover the feed', () => {
    const b1 = bag({ id: 1, code: 'B1', remaining_ml: 120, volume_ml: 120 })
    const b2 = bag({ id: 2, code: 'BOT002', kind: 'bottle', spot: 2, remaining_ml: 90, volume_ml: 90 })
    const plan = planTakes([b1, b2], 60, 'ml')
    expect(plan.takes.map((t) => t.takeMl)).toEqual([60, 0])
    // needed: taken whole
    expect(planTakes([b2], 60, 'ml').takes[0].takeMl).toBe(90)
  })
})
