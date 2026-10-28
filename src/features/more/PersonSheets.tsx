import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { PillChoice, TextField } from '../../components/ui/Field'
import { Sheet } from '../../components/ui/Sheet'
import type { usePeople } from '../../hooks/usePeople'
import { SIMPLE_ACTIONS, type Person, type Role, type Screen, type SimpleAction } from '../../lib/api/companion'
import { Toggle } from '../../components/ui/Toggle'
import { isUnavailableError, PASSWORD_MIN, peopleErrorText, ROLE_LABEL, ROLES, validateNewPerson, type NewPersonDraft } from '../../lib/people'

type People = ReturnType<typeof usePeople>
const ROLE_OPTIONS = ROLES.map((value) => ({ value, label: ROLE_LABEL[value] }))

function RoleField({ value, onChange }: { value: Role | null; onChange: (r: Role) => void }) {
  return (
    <div className="stack people-field" role="group" aria-label="Role">
      <span className="text-field-label">Role on the timeline</span>
      <PillChoice tone="teal" value={value} onChange={onChange} options={ROLE_OPTIONS} />
    </div>
  )
}

function PasswordField({ label, value, onChange, error, autoComplete, autofocus }: { label: string; value: string; onChange: (v: string) => void; error?: string; autoComplete: string; autofocus?: boolean }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="people-password">
      <TextField label={label} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={error ? true : undefined} hint={error ?? `At least ${PASSWORD_MIN} characters.`} data-autofocus={autofocus ? '' : undefined} />
      <button type="button" className="link-btn people-show" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

/** Admin: a new person. Bramble creates the Baby Buddy login on the server and the person signs in on their own phone. */
export function AddPersonSheet({ open, onClose, people, existing }: { open: boolean; onClose: () => void; people: People; existing: Person[] }) {
  // The Sheet only mounts its children while open, so the form starts blank every time it opens.
  const close = () => {
    people.add.reset()
    onClose()
  }
  return (
    <Sheet open={open} title="Add a person" onClose={close}>
      <AddPersonForm people={people} existing={existing} onDone={close} />
    </Sheet>
  )
}

function AddPersonForm({ people, existing, onDone }: { people: People; existing: Person[]; onDone: () => void }) {
  const [draft, setDraft] = useState<NewPersonDraft>({ role: 'mom', name: '', username: '', password: '' })
  const [touched, setTouched] = useState(false)
  const errors = validateNewPerson(draft, existing)
  const shown = touched ? errors : {}
  const set = <K extends keyof NewPersonDraft>(k: K, v: NewPersonDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (Object.keys(errors).length) return
    people.add.mutate({ role: draft.role, name: draft.name.trim(), username: draft.username.trim(), password: draft.password }, { onSuccess: onDone })
  }

  return (
      <form className="stack people-form" onSubmit={submit} noValidate>
        <RoleField value={draft.role} onChange={(role) => set('role', role)} />
        <TextField label={draft.role === 'other' ? 'What the timeline shows' : 'Their name'} value={draft.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" placeholder={draft.role === 'other' ? 'Auntie Jo' : 'Optional'} aria-invalid={shown.name ? true : undefined} hint={shown.name} />
        <TextField label="Username" value={draft.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="mom" aria-invalid={shown.username ? true : undefined} hint={shown.username ?? 'What they type to sign in.'} data-autofocus="" />
        <PasswordField label="Password" value={draft.password} onChange={(v) => set('password', v)} error={shown.password} autoComplete="new-password" />
        {people.add.isError ? (
          <p className="small people-error" role="alert">
            {peopleErrorText(people.add.error)}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" block loading={people.add.isPending}>
          Create login
        </Button>
        <p className="xs muted">The login is created in Baby Buddy on your own server. Tell them the username and password; they sign in once on their phone and the app remembers them.</p>
      </form>
  )
}

/** One person's row: role and name (Bramble's), password and removal (Baby Buddy's, through the server). */
export function EditPersonSheet({ person, onClose, people, canManage, available }: { person: Person | null; onClose: () => void; people: People; canManage: boolean; available: boolean }) {
  const close = () => {
    people.update.reset()
    people.remove.reset()
    onClose()
  }
  return (
    <Sheet open={person !== null} title={person ? (person.you ? 'You' : person.label) : 'Person'} onClose={close}>
      {person ? <EditPersonForm key={person.username} person={person} people={people} canManage={canManage} available={available} /> : null}
    </Sheet>
  )
}

function EditPersonForm({ person, people, canManage, available }: { person: Person; people: People; canManage: boolean; available: boolean }) {
  const [role, setRole] = useState<Role | null>(person.role)
  const [name, setName] = useState(person.name)
  const [password, setPassword] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState<'role' | 'password' | null>(null)

  const dirty = role !== person.role || name.trim() !== person.name.trim()
  const roleError = role === 'other' && !name.trim() ? 'A name is needed when the role is Other.' : role === null ? 'Pick a role.' : null
  const passwordError = password && password.length < PASSWORD_MIN ? `At least ${PASSWORD_MIN} characters.` : password && /^\d+$/.test(password) ? 'Not only numbers.' : undefined
  const busy = people.update.isPending || people.remove.isPending
  const error = people.update.error ?? people.remove.error
  const unavailableNow = error ? isUnavailableError(error) : !available

  function saveRole(e: FormEvent) {
    e.preventDefault()
    if (!role || roleError) return
    setSaved(null)
    people.update.mutate({ username: person.username, body: { role, name: name.trim() } }, { onSuccess: () => setSaved('role') })
  }
  function savePassword(e: FormEvent) {
    e.preventDefault()
    if (!password || passwordError) return
    setSaved(null)
    people.update.mutate({ username: person.username, body: { password } }, { onSuccess: () => { setPassword(''); setSaved('password') } })
  }

  return (
    <>
      <div className="stack people-sheet">
        <p className="small muted">
          Signs in as <span className="strong">{person.username}</span>
          {person.staff ? ' · can manage people' : ''}
          {!person.active ? ' · removed' : ''}
        </p>

        {person.active ? (
          <form className="stack people-form" onSubmit={saveRole} noValidate>
            <RoleField value={role} onChange={(r) => { setRole(r); setSaved(null) }} />
            <TextField label={role === 'other' ? 'What the timeline shows' : 'Name'} value={name} onChange={(e) => { setName(e.target.value); setSaved(null) }} autoComplete="off" placeholder={role === 'other' ? 'Auntie Jo' : 'Optional'} aria-invalid={dirty && roleError ? true : undefined} hint={dirty ? roleError ?? undefined : undefined} />
            <Button type="submit" variant="primary" block disabled={!dirty || Boolean(roleError) || busy} loading={people.update.isPending && !password}>
              Save
            </Button>
            {saved === 'role' ? (
              <p className="small people-saved" role="status">
                Saved. The timeline now shows {person.label}.
              </p>
            ) : null}
          </form>
        ) : null}

        {canManage && !person.you && person.active ? <ScreenField person={person} people={people} /> : null}

        {person.active ? (
          <form className="stack people-form people-section" onSubmit={savePassword} noValidate>
            <h3 className="field-group-title">Password</h3>
            {unavailableNow ? (
              <p className="small muted">Passwords are changed in Baby Buddy, which this server cannot reach yet (see the note on the People screen).</p>
            ) : (
              <>
                <PasswordField label={person.you ? 'New password' : `New password for ${person.label}`} value={password} onChange={(v) => { setPassword(v); setSaved(null) }} error={passwordError} autoComplete="new-password" />
                <Button type="submit" variant="secondary" block disabled={!password || Boolean(passwordError) || busy} loading={people.update.isPending && Boolean(password)}>
                  Change password
                </Button>
                {saved === 'password' ? (
                  <p className="small people-saved" role="status">
                    Password changed. {person.you ? 'Use it next time you sign in.' : `${person.label} signs in with it from now on.`}
                  </p>
                ) : null}
              </>
            )}
          </form>
        ) : null}

        {error ? (
          <p className="small people-error" role="alert">
            {peopleErrorText(error)}
          </p>
        ) : null}

        {canManage && !person.you ? (
          <div className={person.active ? 'people-section people-remove' : 'people-remove'}>
            {!person.active ? (
              <>
                <p className="small">Removed: this login cannot sign in. Everything they logged is still on the timeline as {person.label}.</p>
                <Button variant="secondary" block onClick={() => people.update.mutate({ username: person.username, body: { active: true } })} loading={people.update.isPending} disabled={busy || !available}>
                  Bring back
                </Button>
              </>
            ) : confirming ? (
              <div className="people-confirm" role="group" aria-label={`Remove ${person.label}`}>
                <p className="small">Remove {person.label}? Their login stops working on every phone. What they logged stays on the timeline, and you can bring them back later.</p>
                <div className="row">
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    Keep
                  </Button>
                  <Button variant="danger" onClick={() => people.remove.mutate(person.username, { onSettled: () => setConfirming(false) })} loading={people.remove.isPending}>
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="people-remove-btn" onClick={() => setConfirming(true)} disabled={!available}>
                Remove {person.label}
              </Button>
            )}
            {!available && person.active ? <p className="xs muted">Removing needs Baby Buddy, which this server cannot reach yet.</p> : null}
          </div>
        ) : null}
        {person.you ? <p className="xs muted">You cannot remove yourself; another admin can, or use the Baby Buddy admin pages.</p> : null}
      </div>
    </>
  )
}

const SCREEN_OPTIONS: { value: Screen; label: string }[] = [
  { value: 'simple', label: 'Simple screen' },
  { value: 'full', label: 'The full app' },
]
const ACTION_LABEL: Record<SimpleAction, string> = { bottle: 'Bottle (premade bottles only)', diaper: 'Diaper (pee, poop or both)' }

/**
 * What this person's phone shows (admins only, never for yourself): the full app, or the simple screen with big
 * buttons for the actions picked here. Grandparents start on the simple screen with both.
 */
function ScreenField({ person, people }: { person: Person; people: People }) {
  const [screen, setScreen] = useState<Screen>(person.screen)
  const [actions, setActions] = useState<SimpleAction[]>(person.simpleActions)
  const [saved, setSaved] = useState(false)
  const dirty = screen !== person.screen || (screen === 'simple' && actions.join() !== person.simpleActions.join())
  const none = screen === 'simple' && actions.length === 0
  const toggle = (a: SimpleAction, on: boolean) => {
    setActions((was) => SIMPLE_ACTIONS.filter((x) => (x === a ? on : was.includes(x))))
    setSaved(false)
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!dirty || none) return
    setSaved(false)
    people.update.mutate({ username: person.username, body: screen === 'simple' ? { screen, simpleActions: actions } : { screen } }, { onSuccess: () => setSaved(true) })
  }
  return (
    <form className="stack people-form people-section" onSubmit={save} noValidate data-testid="screen-field">
      <h3 className="field-group-title">Their phone shows</h3>
      <PillChoice tone="teal" value={screen} onChange={(v) => { setScreen(v); setSaved(false) }} options={SCREEN_OPTIONS} />
      {screen === 'simple' ? (
        <div className="stack screen-actions" role="group" aria-label="Buttons on the simple screen">
          {SIMPLE_ACTIONS.map((a) => (
            <label key={a} className="row-between screen-action">
              <span>{ACTION_LABEL[a]}</span>
              <Toggle checked={actions.includes(a)} onChange={(on) => toggle(a, on)} label={ACTION_LABEL[a]} />
            </label>
          ))}
          <p className="xs muted">Big buttons only, the time is always now, and each save can be taken back. No Settings, so only you can change this.</p>
          {none ? <p className="small people-error">Leave at least one button on.</p> : null}
        </div>
      ) : null}
      <Button type="submit" variant="secondary" block disabled={!dirty || none || people.update.isPending} loading={people.update.isPending}>
        Save
      </Button>
      {saved ? (
        <p className="small people-saved" role="status">
          Saved. {person.label}&apos;s phone shows {screen === 'simple' ? 'the simple screen' : 'the full app'} the next time it opens Bramble.
        </p>
      ) : null}
    </form>
  )
}
