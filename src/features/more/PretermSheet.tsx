import { addDays, format } from 'date-fns'
import { useState } from 'react'
import { About } from '../../components/ui/About'
import { Button } from '../../components/ui/Button'
import { FieldGroup, TextField } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import type { Child } from '../../lib/api/types'
import { ageBasis, correctedAgeText, EARLIEST_DAYS, PRETERM_BEFORE_DAYS, TERM_DAYS, type NicuStay } from '../../lib/preterm'
import { parseDate } from '../../lib/time'
import './preterm.css'

type Stay = 'none' | 'there' | 'home'

const WEEKS = Array.from({ length: PRETERM_BEFORE_DAYS / 7 - EARLIEST_DAYS / 7 }, (_, i) => EARLIEST_DAYS / 7 + i)

/**
 * Settings › Born early: the weeks of pregnancy at birth and the NICU stay, shared per child. Two facts the
 * whole app works from (`src/lib/preterm.ts`): what was logged before they were set reads right at once.
 */
export function PretermSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { child } = useChildren()
  const { settings, update } = useChildSettings(child?.id ?? null)
  if (!child) return null
  return (
    <Sheet open={open} title="Born early" onClose={onClose}>
      <PretermEditor
        child={child}
        bornAtDays={settings.bornAtDays ?? null}
        nicu={settings.nicu ?? null}
        onSave={(bornAtDays, nicu) => {
          update({ bornAtDays, nicu })
          onClose()
        }}
      />
    </Sheet>
  )
}

function PretermEditor({ child, bornAtDays, nicu, onSave }: { child: Child; bornAtDays: number | null; nicu: NicuStay | null; onSave: (bornAtDays: number | null, nicu: NicuStay | null) => void }) {
  const name = child.first_name
  const [weeks, setWeeks] = useState<string>(bornAtDays === null ? '' : String(Math.floor(bornAtDays / 7)))
  const [days, setDays] = useState<string>(bornAtDays === null ? '0' : String(bornAtDays % 7))
  const [stay, setStay] = useState<Stay>(!nicu ? 'none' : nicu.home ? 'home' : 'there')
  const [since, setSince] = useState(nicu?.since ?? child.birth_date)
  const [home, setHome] = useState(nicu?.home ?? format(new Date(), 'yyyy-MM-dd'))
  const [touched, setTouched] = useState(false)
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setTouched(true)
    set(v)
  }

  const draftDays = weeks === '' ? null : Number(weeks) * 7 + Number(days)
  const draftNicu: NicuStay | null = stay === 'none' ? null : { since, home: stay === 'home' ? home : null }
  const today = format(new Date(), 'yyyy-MM-dd')
  const problem =
    stay !== 'none' && (!since || since < child.birth_date)
      ? `The stay cannot start before ${name} was born.`
      : stay !== 'none' && since > today
        ? 'The stay cannot start in the future.'
        : stay === 'home' && (!home || home < since)
          ? 'Came home must be on or after the day the stay began.'
          : stay === 'home' && home > today
            ? 'Came home cannot be in the future.'
            : null
  const basis = ageBasis(child, { bornAtDays: draftDays, nicu: draftNicu })
  const due = draftDays !== null ? addDays(parseDate(child.birth_date), TERM_DAYS - draftDays) : null
  const age = correctedAgeText(basis)

  return (
    <div className="stack preterm">
      <FieldGroup title="Born at" hint={`Weeks of pregnancy when ${name} was born. Leave it empty for a baby born at 37 weeks or later.`}>
        <div className="row preterm-weeks">
          <select className="text-input" value={weeks} onChange={(e) => touch(setWeeks)(e.target.value)} aria-label="Weeks at birth">
            <option value="">Not born early</option>
            {WEEKS.map((w) => (
              <option key={w} value={w}>
                {w} weeks
              </option>
            ))}
          </select>
          <select className="text-input" value={days} onChange={(e) => touch(setDays)(e.target.value)} aria-label="Days" disabled={weeks === ''}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'day' : 'days'}
              </option>
            ))}
          </select>
        </div>
        {due ? (
          <p className="small preterm-due" data-testid="preterm-due">
            Due date <span className="strong">{format(due, 'MMM d, yyyy')}</span>
            {age ? ` · today ${age}` : null}
          </p>
        ) : null}
      </FieldGroup>
      <FieldGroup title="NICU">
        <Segmented
          label="NICU stay"
          options={[
            { value: 'none', label: 'Not in the NICU' },
            { value: 'there', label: 'In the NICU' },
            { value: 'home', label: 'Came home' },
          ]}
          value={stay}
          onChange={touch(setStay)}
        />
        {stay !== 'none' ? <TextField label="In the NICU from" type="date" value={since} min={child.birth_date} max={today} onChange={(e) => touch(setSince)(e.target.value)} /> : null}
        {stay === 'home' ? <TextField label="Came home on" type="date" value={home} min={since} max={today} onChange={(e) => touch(setHome)(e.target.value)} /> : null}
        {problem ? <p className="small text-health">{problem}</p> : null}
      </FieldGroup>
      <About label="What this changes">
        <p>
          <strong>While {name} is in the NICU:</strong> Bramble shows what you log but does not compare feeds, sleep or diapers with age norms, and the feed-due, wet-diaper and nap
          reminders stay quiet; the nurses&apos; chart is the record. Pump reminders keep working, and Reports › Pumping shows sessions and volume against what NICU lactation teams
          aim for, counted from the birth.
        </p>
        <p>
          <strong>Home before the due date:</strong> still no comparisons with age norms and no nap prediction (the tables start at a term birth); feed and wet-diaper reminders
          follow {name}&apos;s own pattern.
        </p>
        <p>
          <strong>After the due date:</strong> every age-typical figure (feeds, sleep, diapers, wake windows, weight gain and the WHO percentiles) counts from the due date, the
          corrected age pediatricians use, until two years from the birth. Vaccines always go by the real age; follow the pediatrician.
        </p>
        <p>Everything already logged is read again with these dates; nothing is changed or moved.</p>
      </About>
      <Button size="lg" block disabled={!touched || problem !== null} onClick={() => onSave(draftDays, draftNicu)}>
        Save
      </Button>
    </div>
  )
}
