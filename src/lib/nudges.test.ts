import { afterEach, describe, expect, it } from 'vitest'
import { captureLogHandoff, clearLogHandoff, clockLabel, describePlan, nudgeSummary, peekLogHandoff, pumpCadenceValue, DEFAULT_NUDGE_SETTINGS } from './nudges'

describe('nudge settings helpers', () => {
  it('maps pump cadence minutes to the segmented value and back', () => {
    expect(pumpCadenceValue(null)).toBe('auto')
    expect(pumpCadenceValue(150)).toBe('150')
    expect(pumpCadenceValue(999)).toBe('auto')
  })

  it('formats clocks and the Settings row summary', () => {
    expect(clockLabel('20:00')).toMatch(/8:00/)
    expect(clockLabel('garbage')).toBe('garbage')
    expect(nudgeSummary(DEFAULT_NUDGE_SETTINGS)).toMatch(/^Feeding, pumping, diaper, summary, weight, supply · quiet 10:00 PM–7:00 AM$/)
    expect(nudgeSummary({ ...DEFAULT_NUDGE_SETTINGS, activity: true })).toMatch(/weight, supply, pings · quiet/)
    expect(nudgeSummary({ ...DEFAULT_NUDGE_SETTINGS, feed: false, pump: false, diaper: false, summary: false, weight: false, supply: false, activity: false })).toMatch(/^All off/)
  })

  it('describes the plan in one line', () => {
    const now = new Date('2026-10-07T15:00:00')
    expect(describePlan(undefined, false)).toBe('Off')
    expect(describePlan(undefined, true)).toBe('Waiting for the server')
    expect(describePlan({ at: null, note: 'Waiting for two feeds within a day' }, true)).toBe('Waiting for two feeds within a day')
    expect(describePlan({ at: '2026-10-07T17:40:00', note: 'Every 2 h 50 min lately, from 7 feeds' }, true, now)).toBe('Next: 5:40 PM · Every 2 h 50 min lately, from 7 feeds')
    expect(describePlan({ at: '2026-10-08T07:00:00', note: '' }, true, now)).toBe('Next: tomorrow 7:00 AM')
    // a moment just past, seen after midnight, is due, not "tomorrow"
    expect(describePlan({ at: '2026-10-08T23:50:00', note: '' }, true, new Date('2026-10-09T00:10:00'))).toBe('Due since yesterday 11:50 PM')
    // two calendar days ahead inside 36 h is a weekday, not "tomorrow"
    expect(describePlan({ at: '2026-10-11T07:00:00', note: '' }, true, new Date('2026-10-09T22:00:00'))).toBe('Next: Sun 7:00 AM')
  })
})

describe('push click hand-off', () => {
  afterEach(() => clearLogHandoff())

  function fakeLocation(search: string): { loc: Location; replaced: string[] } {
    const replaced: string[] = []
    const loc = { search, pathname: '/', hash: '' } as unknown as Location
    const hist = { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) } as unknown as History
    return { loc: Object.assign(loc, { __hist: hist }), replaced }
  }

  it('takes ?log=<kind> off the address and stashes it for Home', () => {
    const { loc, replaced } = fakeLocation('?log=bottle')
    expect(captureLogHandoff(loc, (loc as unknown as { __hist: History }).__hist)).toBe('bottle')
    expect(replaced).toEqual(['/'])
    expect(peekLogHandoff()).toBe('bottle')
    clearLogHandoff()
    expect(peekLogHandoff()).toBeNull()
  })

  it('ignores unknown kinds but still cleans the address', () => {
    const { loc, replaced } = fakeLocation('?log=settings')
    expect(captureLogHandoff(loc, (loc as unknown as { __hist: History }).__hist)).toBeNull()
    expect(replaced).toEqual(['/'])
    expect(peekLogHandoff()).toBeNull()
  })

  it('does nothing without the parameter', () => {
    const { loc, replaced } = fakeLocation('')
    expect(captureLogHandoff(loc, (loc as unknown as { __hist: History }).__hist)).toBeNull()
    expect(replaced).toEqual([])
  })

  it('forgets a hand-off older than a few minutes', () => {
    const { loc } = fakeLocation('?log=diaper')
    captureLogHandoff(loc, (loc as unknown as { __hist: History }).__hist)
    expect(peekLogHandoff(Date.now() + 10 * 60_000)).toBeNull()
  })
})
