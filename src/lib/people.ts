/**
 * People: who is in the household and what the timeline calls them. The companion's people table is the
 * source of truth (usePeople); these helpers shape it for the Settings sheet and for attribution.
 */
import type { Person, Role } from './api/companion'
import { ApiError, describeApiError } from './api/client'

export const ROLES: Role[] = ['mom', 'dad', 'grandma', 'grandpa', 'nanny', 'other']
export const ROLE_LABEL: Record<Role, string> = { mom: 'Mom', dad: 'Dad', grandma: 'Grandma', grandpa: 'Grandpa', nanny: 'Nanny', other: 'Other' }
export const NAME_MAX = 60
export const PASSWORD_MIN = 8
/** Django's own username rule: letters, digits and . @ + - _ only. */
const USERNAME_RE = /^[\w.@+-]+$/

/** "admin" -> "Admin": the fallback when nobody has given a login a role yet. */
export function capitalise(username: string): string {
  return username.charAt(0).toUpperCase() + username.slice(1)
}

/** What the timeline shows for a person: the role, the name for Other, else the username. Mirrors the server. */
export function personLabel(person: Pick<Person, 'username' | 'role' | 'name'>): string {
  if (person.role && person.role !== 'other') return ROLE_LABEL[person.role]
  const name = person.name.trim()
  return name || capitalise(person.username)
}

/** Username → timeline label, for every person the household knows about (case-insensitive usernames). */
export function labelsFor(people: Person[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of people) out[p.username.toLowerCase()] = p.label || personLabel(p)
  return out
}

/**
 * The listing plus logins Bramble has only seen in `caregiver:` tags. When the server cannot ask Baby Buddy
 * for its users, this is how an admin still gets to give an existing login a role.
 */
export function withTaggedLogins(people: Person[], taggedUsernames: Iterable<string>): Person[] {
  const seen = new Set(people.map((p) => p.username.toLowerCase()))
  const extra: Person[] = []
  for (const raw of taggedUsernames) {
    const username = raw.trim()
    const key = username.toLowerCase()
    if (!username || seen.has(key)) continue
    seen.add(key)
    extra.push({ username, role: null, name: '', user_id: null, active: true, staff: false, label: capitalise(username), you: false, screen: 'full', simpleActions: ['bottle', 'diaper'] })
  }
  return extra.length ? [...people, ...extra.sort((a, b) => a.username.localeCompare(b.username))] : people
}

/** What the Settings row says under "People". */
export function peopleSummary(people: Person[] | undefined): string {
  if (!people) return 'Who logs what'
  const active = people.filter((p) => p.active)
  const named = active.filter((p) => p.role !== null)
  if (named.length === 0) return active.length > 1 ? `${active.length} logins · set who’s who` : 'Set who you are'
  const labels = named.map((p) => p.label)
  const shown = labels.slice(0, 3).join(', ')
  return labels.length > 3 ? `${shown} +${labels.length - 3}` : shown
}

export interface NewPersonDraft {
  role: Role
  name: string
  username: string
  password: string
}

/** Field-level problems before anything is sent; the server checks the same things again. */
export function validateNewPerson(draft: NewPersonDraft, existing: Person[]): Partial<Record<keyof NewPersonDraft, string>> {
  const errors: Partial<Record<keyof NewPersonDraft, string>> = {}
  const username = draft.username.trim()
  if (!username) errors.username = 'Choose a username they will sign in with.'
  else if (!USERNAME_RE.test(username)) errors.username = 'Letters, numbers and . @ + - _ only, no spaces.'
  else if (existing.some((p) => p.username.toLowerCase() === username.toLowerCase())) errors.username = `${username} is already in the household.`
  if (draft.role === 'other' && !draft.name.trim()) errors.name = 'A name is needed when the role is Other.'
  if (draft.name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`
  if (!draft.password) errors.password = 'Choose a password for them.'
  else if (draft.password.length < PASSWORD_MIN) errors.password = `At least ${PASSWORD_MIN} characters.`
  else if (/^\d+$/.test(draft.password)) errors.password = 'Not only numbers.'
  else if (username && draft.password.toLowerCase().includes(username.toLowerCase())) errors.password = 'Too close to the username.'
  return errors
}

/** The server's plain-language reason when it has one; otherwise the generic description. */
export function peopleErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body && typeof err.body === 'object' ? (err.body as { detail?: unknown }) : null
    if (err.status === 404 || err.status === 502) return 'The Bramble server needs updating before it can manage people. Deploy the latest version, then try again.'
    if (body && typeof body.detail === 'string' && body.detail) return body.detail
  }
  return describeApiError(err)
}

/** True when the server said the Django channel is the problem (503 with `unavailable`), not the input. */
export function isUnavailableError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503 && Boolean(err.body && typeof err.body === 'object' && (err.body as { unavailable?: boolean }).unavailable)
}

/** Sort for the sheet: you first, then active people by role order, removed people last. */
export function sortPeople(people: Person[]): Person[] {
  const order = (p: Person) => (p.role ? ROLES.indexOf(p.role) : ROLES.length)
  return [...people].sort((a, b) => Number(b.you) - Number(a.you) || Number(b.active) - Number(a.active) || order(a) - order(b) || a.label.localeCompare(b.label))
}
