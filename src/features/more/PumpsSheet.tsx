import { useState } from 'react'
import { PlusIcon, TrashIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { cleanPumps, DEFAULT_PUMPS, PUMPS_DECIDED, type PumpSpec } from '../../lib/pumps'
import './pumps.css'

/**
 * Settings › Pumps: the household's breast pumps, each with the length of a usual session. The pumping
 * sheet and the timer offer these as one-tap choices; Reports › Summary › Pumping compares them. Shared per
 * child, like the home tiles.
 */
export function PumpsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { child } = useChildren()
  const { settings, update } = useChildSettings(child?.id ?? null)
  const saved = settings.pumps ?? DEFAULT_PUMPS
  // The editor lives inside the sheet, which unmounts it when closed: every open starts from the saved list.
  return (
    <Sheet open={open} title="Pumps" onClose={onClose}>
      <PumpsEditor
        saved={saved}
        savedGoal={settings.stashGoalDays ?? null}
        onSave={(pumps, stashGoalDays) => {
          update({ pumps, stashGoalDays, pumpsDecided: PUMPS_DECIDED })
          onClose()
        }}
      />
    </Sheet>
  )
}

function PumpsEditor({ saved, savedGoal, onSave }: { saved: PumpSpec[]; savedGoal: number | null; onSave: (pumps: PumpSpec[], stashGoalDays: number | null) => void }) {
  const [draft, setDraft] = useState<PumpSpec[]>(saved)
  const [goal, setGoal] = useState<string>(savedGoal === null ? '' : String(savedGoal))
  const [touched, setTouched] = useState(false)
  const goalDays = goal.trim() === '' ? null : Math.min(365, Math.max(1, Math.round(Number(goal)) || 0)) || null
  const edit = (i: number, patch: Partial<PumpSpec>) => {
    setTouched(true)
    setDraft((d) => d.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }
  const remove = (i: number) => {
    setTouched(true)
    setDraft((d) => d.filter((_, j) => j !== i))
  }
  const add = () => {
    setTouched(true)
    setDraft((d) => [...d, { name: '', minutes: 20 }])
  }
  const cleaned = cleanPumps(draft)
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Each pump with its usual session length. The pumping sheet and the timer offer them in one tap and set the length; Reports compares them.
      </p>
      <ul className="pump-list" aria-label="Pumps">
        {draft.map((p, i) => (
          <li key={i} className="pump-row">
            <input className="text-input pump-name" value={p.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="Pump name" aria-label={`Pump ${i + 1} name`} maxLength={30} />
            <label className="pump-minutes">
              <input className="text-input" type="number" inputMode="numeric" min={1} max={180} value={p.minutes} onChange={(e) => edit(i, { minutes: Number(e.target.value) })} aria-label={`Pump ${i + 1} usual minutes`} />
              <span className="xs muted">min</span>
            </label>
            <button type="button" className="pump-remove" onClick={() => remove(i)} aria-label={`Remove ${p.name || 'this pump'}`}>
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={add}>
        <PlusIcon style={{ width: 18, height: 18 }} /> Add a pump
      </Button>
      {draft.length && !cleaned.length ? <p className="small text-health">Give each pump a name.</p> : null}
      <label className="stack pump-goal" data-testid="stash-goal">
        <span className="strong">Stash goal</span>
        <span className="small muted">Days of bottles to bank in the freezer; the Stash tab shows how close you are and when you get there. Empty for no goal.</span>
        <span className="row pump-goal-row">
          <input className="text-input pump-goal-input" type="number" inputMode="numeric" min={1} max={365} placeholder="e.g. 30" value={goal} aria-label="Stash goal in days of bottles" onChange={(e) => { setTouched(true); setGoal(e.target.value) }} />
          <span className="small">days of bottles</span>
        </span>
      </label>
      <Button size="lg" block onClick={() => onSave(cleaned, goalDays)} disabled={!touched}>
        Save pumps
      </Button>
    </div>
  )
}
