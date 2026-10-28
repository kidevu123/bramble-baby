import { describe, expect, it } from 'vitest'
import { zoneLabel, zoneToSeed } from './time-zone'

const cfg = (admin: boolean, source: 'settings' | 'server') => ({ admin, timeZone: { value: 'UTC', source, server: 'UTC' } })

describe('zoneToSeed', () => {
  it('an admin phone records its zone while the household has none set', () => {
    expect(zoneToSeed(cfg(true, 'server'), 'America/New_York')).toBe('America/New_York')
  })
  it('never overwrites a zone set in Settings, and only admins write it', () => {
    expect(zoneToSeed(cfg(true, 'settings'), 'Europe/London')).toBeNull()
    expect(zoneToSeed(cfg(false, 'server'), 'America/New_York')).toBeNull()
    expect(zoneToSeed(cfg(true, 'server'), null)).toBeNull()
    expect(zoneToSeed(undefined, 'America/New_York')).toBeNull()
    // An older companion without the field: nothing to write.
    expect(zoneToSeed({ admin: true } as never, 'America/New_York')).toBeNull()
  })
})

describe('zoneLabel', () => {
  it('names the city and the abbreviation in force', () => {
    expect(zoneLabel('America/New_York', new Date('2026-10-25T12:00:00Z'))).toBe('New York (EDT)')
    expect(zoneLabel('America/New_York', new Date('2026-12-25T12:00:00Z'))).toBe('New York (EST)')
    expect(zoneLabel('UTC')).toBe('UTC')
  })
})
