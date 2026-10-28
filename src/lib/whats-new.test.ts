import { describe, expect, it } from 'vitest'
import pkg from '../../package.json'
import { compareVersions, itemText, readSeen, RELEASES, startWhatsNewAt, unseenReleases, type Release } from './whats-new'

const r = (version: string): Release => ({ version, date: 'Oct 1', items: [version] })
const list = [r('1.41.1'), r('1.41.0'), r('1.40.0'), r('1.39.4')]

describe("what's new", () => {
  it('compares versions part by part', () => {
    expect(compareVersions('1.41.1', '1.41.0')).toBe(1)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('1.40', '1.40.0')).toBe(0)
  })
  it('shows what came after the last one this phone saw, up to this build', () => {
    expect(unseenReleases('1.40.0', '1.41.1', list).map((x) => x.version)).toEqual(['1.41.1', '1.41.0'])
    expect(unseenReleases('1.41.1', '1.41.1', list)).toEqual([])
    expect(unseenReleases('1.39.4', '1.41.0', list).map((x) => x.version)).toEqual(['1.41.0', '1.40.0'])
  })
  it('a phone signed in before the card existed gets the last four; one signing in now starts here', () => {
    localStorage.clear()
    expect(unseenReleases(readSeen(), '1.41.1', [r('1.42.0'), ...list, r('1.38.0')]).map((x) => x.version)).toEqual(['1.41.1', '1.41.0', '1.40.0', '1.39.4'])
    startWhatsNewAt('1.41.1')
    expect(unseenReleases(readSeen(), '1.41.1', list)).toEqual([])
    startWhatsNewAt('1.42.0')
    expect(readSeen()).toBe('1.41.1')
    localStorage.clear()
  })
  it('the newest entry is this build, so every release says what changed', () => {
    expect(RELEASES[0].version).toBe(pkg.version)
    expect(RELEASES.every((x, i) => i === 0 || compareVersions(RELEASES[i - 1].version, x.version) > 0)).toBe(true)
  })
  it('fills in the child and never names a real one', () => {
    expect(itemText('Did {name} finish it?', 'Oscar')).toBe('Did Oscar finish it?')
    expect(itemText('Did {name} finish it?', undefined)).toBe('Did the baby finish it?')
    expect(RELEASES.flatMap((x) => x.items).some((t) => /Ada/.test(t))).toBe(false)
  })
})
