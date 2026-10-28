import type { ServerConfig } from './api/companion'

/** This phone's IANA zone ("America/New_York"), or null when the browser will not say. */
export function phoneZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && zone.includes('/') ? zone : zone === 'UTC' ? 'UTC' : null
  } catch {
    return null
  }
}

/**
 * The zone an admin's phone records for the household, or null to leave it. The server writes every clock in a
 * notification in this zone; until a phone sets it, the server's own zone is used, which on a fresh container is
 * often UTC (2026-10-25: "Last session 6:30 PM" for a 2:30 PM pump in New York). Only a household that never set
 * one is seeded, so a zone chosen in Settings is never overwritten by a phone that is travelling.
 */
export function zoneToSeed(config: Pick<ServerConfig, 'admin' | 'timeZone'> | undefined, phone: string | null): string | null {
  if (!config?.admin || !config.timeZone || !phone) return null
  return config.timeZone.source === 'settings' ? null : phone
}

/** "New York (EDT)" for "America/New_York": the city and the abbreviation in force now. */
export function zoneLabel(zone: string, at: Date = new Date()): string {
  const city = (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
  try {
    const short = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value
    return short && short !== city ? `${city} (${short})` : city
  } catch {
    return city
  }
}
