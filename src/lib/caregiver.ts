/**
 * Who logged what. Baby Buddy does not store the author of an entry, so Bramble tags every entry it
 * creates with `caregiver:<username>` (the same tag mechanism used for potty). Each person signs in with
 * their own login (Settings › People), so the tag names a person; the timeline shows their role ("Mom")
 * and the log sheets warn before a likely duplicate.
 */
import { capitalise } from './people'

const PREFIX = 'caregiver:'

let current: string | null = null

/** Set once the profile is known; every create() adds the tag. */
export function setCurrentCaregiver(username: string | null) {
  current = username ? username.trim() : null
}

export function currentCaregiver(): string | null {
  return current
}

/** Called when the server refused a tag: entries keep saving, just without attribution. */
export function disableCaregiverTags() {
  current = null
}

export function caregiverTag(username: string): string {
  return `${PREFIX}${username.trim()}`
}

/** Username from an entry's tags, or null when it predates tagging or came from Baby Buddy's own UI. */
export function caregiverOf(tags: string[] | null | undefined): string | null {
  const tag = (tags ?? []).find((t) => t.startsWith(PREFIX))
  return tag ? tag.slice(PREFIX.length) || null : null
}

/** Adds the current caregiver's tag to a create body, keeping any tags the sheet set. */
export function withCaregiverTag(body: Record<string, unknown>): Record<string, unknown> {
  if (!current) return body
  const existing = Array.isArray(body.tags) ? (body.tags as string[]) : []
  if (existing.some((t) => t.startsWith(PREFIX))) return body
  return { ...body, tags: [...existing, caregiverTag(current)] }
}

/**
 * "Mom" / "Dad" when the household gave this login a role in People (`names` is username → label from
 * usePeople), else the username made presentable ("admin" → "Admin"). Older entries tagged `caregiver:admin`
 * from the days both phones shared one login simply show whatever the admin account is called now.
 */
export function caregiverName(username: string | null, names: Record<string, string> | undefined): string | null {
  if (!username) return null
  const key = username.trim()
  if (!key) return null
  return names?.[key]?.trim() || names?.[key.toLowerCase()]?.trim() || capitalise(key)
}
