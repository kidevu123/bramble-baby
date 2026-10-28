import { useEffect, useMemo, useState } from 'react'
import { ChevronRightIcon, FaceIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { rangeDays, useChildEvents } from '../../hooks/useEvents'
import { usePeople } from '../../hooks/usePeople'
import { usePrefs } from '../../hooks/usePrefs'
import type { Person } from '../../lib/api/companion'
import { buildTimeline } from '../../lib/events'
import { peopleErrorText, sortPeople, withTaggedLogins } from '../../lib/people'
import { AddPersonSheet, EditPersonSheet } from './PersonSheets'
import './people.css'

type People = ReturnType<typeof usePeople>

/**
 * Settings › Household › People. One Baby Buddy login per person, each with a role the timeline shows
 * ("Mom", "Dad"). An admin adds people (Bramble creates the login on the server), changes roles, names and
 * passwords, and removes people; everyone else sees the household and can change their own row.
 * When the server cannot create logins it says so here, with the exact thing to set, and roles still work.
 */
export function PeopleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const people = usePeople()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const listing = people.listing
  const available = listing?.management.available ?? true
  // Opening the sheet asks the server to look at Baby Buddy's users again (a login made in Baby Buddy's own
  // pages, or a server that was just fixed, shows up without waiting for the cache).
  const refreshFresh = people.refreshFresh
  useEffect(() => {
    if (open) void refreshFresh()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Logins Bramble has only ever seen in caregiver tags: when the server cannot ask Baby Buddy for its users,
  // this is how an admin still gets to give an old login a role.
  const { child } = useChildren()
  const { prefs } = usePrefs()
  const tagRange = useMemo(() => rangeDays(60), [])
  const events = useChildEvents(open && child && !available ? child.id : null, tagRange)
  const tagged = useMemo(() => new Set(buildTimeline(events, prefs.units).map((i) => i.by).filter((by): by is string => Boolean(by))), [events, prefs.units])
  const rows = useMemo(() => (listing ? sortPeople(available ? listing.people : withTaggedLogins(listing.people, tagged)) : []), [listing, available, tagged])
  const selected = editing ? rows.find((p) => p.username.toLowerCase() === editing.toLowerCase()) ?? null : null

  return (
    <Sheet open={open} title="People" onClose={onClose}>
      <div className="stack people-sheet" data-people-state={people.isLoading ? 'loading' : people.error ? 'error' : rows.filter((p) => p.active).length > 1 ? 'list' : 'empty'}>
        {people.isLoading ? <p className="small muted">Loading people…</p> : null}
        {people.error ? <Trouble people={people} /> : null}
        {listing ? (
          <>
            <Band rows={rows} />
            {!available ? <Unavailable problem={listing.management.problem} canManage={listing.canManage} /> : null}
            <ul className="people-list card" aria-label="People in the household">
              {rows.map((p) => (
                <PersonRow key={p.username} person={p} editable={listing.canManage || p.you} onOpen={() => setEditing(p.username)} />
              ))}
            </ul>
            {listing.canManage ? (
              <>
                <Button variant="primary" size="lg" block onClick={() => setAdding(true)} disabled={!available} aria-describedby={available ? undefined : 'people-unavailable'}>
                  Add a person
                </Button>
                <p className="xs muted">Each person signs in on their own phone. What they log is marked with their role, and the app warns when someone else just logged the same thing.</p>
              </>
            ) : (
              <p className="xs muted">Only an admin can add or remove people. Tap your own row to change your role, name or password.</p>
            )}
            <AddPersonSheet open={adding} onClose={() => setAdding(false)} people={people} existing={rows} />
            <EditPersonSheet person={selected} onClose={() => setEditing(null)} people={people} canManage={listing.canManage} available={available} />
          </>
        ) : null}
      </div>
    </Sheet>
  )
}

function Band({ rows }: { rows: Person[] }) {
  const active = rows.filter((p) => p.active)
  const unset = active.filter((p) => p.role === null).length
  const title = active.length <= 1 ? 'Just you so far' : `${active.length} people`
  const line = active.length <= 1 ? 'Add the other caregivers so each has their own login.' : unset ? `${unset} ${unset === 1 ? 'login has' : 'logins have'} no role yet: tap to set who it is.` : 'Everyone has their own login; the timeline shows who did what.'
  return (
    <div className={`people-band ${active.length > 1 && !unset ? 'on' : 'idle'}`}>
      <span className="people-band-icon">
        <FaceIcon />
      </span>
      <span className="grow">
        <span className="people-band-title">{title}</span>
        <span className="small people-band-line">{line}</span>
      </span>
    </div>
  )
}

function Unavailable({ problem, canManage }: { problem: string | null; canManage: boolean }) {
  return (
    <div className="people-notice warn" role="status" id="people-unavailable">
      <span className="people-notice-title">This server can’t create logins yet</span>
      <span className="small">{problem ?? 'The Bramble server could not reach Baby Buddy’s Django.'}</span>
      <span className="small">{canManage ? 'Roles and names still work for logins that already exist. Passwords and new logins need the fix above, or Baby Buddy’s own admin pages.' : 'You can still set your own role and name.'}</span>
    </div>
  )
}

function Trouble({ people }: { people: People }) {
  return (
    <>
      <p className="small people-error" role="alert">
        {peopleErrorText(people.error)}
      </p>
      <Button variant="secondary" block onClick={() => void people.refetch()}>
        Try again
      </Button>
    </>
  )
}

const ROLE_TONE: Record<string, string> = { mom: 'tone-tummy', dad: 'tone-sleep', grandma: 'tone-pumping', grandpa: 'tone-growth', nanny: 'tone-solids', other: 'tone-feeding' }

export function PersonRow({ person, editable, onOpen }: { person: Person; editable: boolean; onOpen: () => void }) {
  // "Sara · mom" under "Mom"; nothing under "Admin" when the label is just the username made presentable.
  const name = person.name.trim()
  const bareLogin = !name && person.username.toLowerCase() === person.label.toLowerCase()
  const sub = bareLogin ? '' : [name && name !== person.label ? name : null, person.username].filter(Boolean).join(' · ')
  const body = (
    <>
      <span className={`icon-circle people-avatar ${person.active ? ROLE_TONE[person.role ?? ''] ?? 'tone-note' : 'tone-note'}`} aria-hidden>
        {person.label.charAt(0).toUpperCase()}
      </span>
      <span className="grow people-row-text">
        <span className="people-row-title">
          {person.label}
          {person.you ? <span className="people-pill you">you</span> : null}
          {person.staff ? <span className="people-pill">admin</span> : null}
          {!person.active ? <span className="people-pill off">removed</span> : null}
          {person.active && person.role === null ? <span className="people-pill ask">no role yet</span> : null}
        </span>
        {sub ? <span className="xs muted truncate">{sub}</span> : null}
      </span>
      {editable ? <ChevronRightIcon className="chev" aria-hidden /> : null}
    </>
  )
  return (
    <li className={person.active ? undefined : 'people-row-off'}>
      {editable ? (
        <button type="button" className="people-row" onClick={onOpen} aria-label={`${person.label}${person.you ? ' (you)' : ''}, ${person.username}`}>
          {body}
        </button>
      ) : (
        <div className="people-row static">{body}</div>
      )}
    </li>
  )
}
