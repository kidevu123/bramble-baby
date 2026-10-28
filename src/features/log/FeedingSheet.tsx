import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { BottleIcon, ChevronRightIcon, PlayIcon, QrIcon, SnowflakeIcon, TagIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { useBagForFeeding, useInvalidateMilk, useMilkStash } from '../../hooks/useMilk'
import { useNow } from '../../hooks/useNow'
import { companion, type MilkBag } from '../../lib/api/companion'
import { formatMl, giveBackCopy, isNightBottle, LOCATION_LABEL, planTakes, roundMl, stashHint, summarizeStash, takesCopy } from '../../lib/milk'
import { StashPicker } from '../milk/StashPicker'
import { Segmented } from '../../components/ui/Segmented'
import { FieldGroup, PillChoice, TimeField } from '../../components/ui/Field'
import { LaunchRow, NoteField, TimePair, ValueField } from './LogFields'
import { usePrefs } from '../../hooks/usePrefs'
import { volumeLabel } from '../../lib/units'
import { describeApiError } from '../../lib/api/client'
import { feedings as feedingsApi } from '../../lib/api/endpoints'
import type { Child, Feeding, FeedingMethod, FeedingType } from '../../lib/api/types'
import { encodeNursing, freshNursing, parseSideNote } from '../../lib/nursing'
import type { QuickPrefill } from '../../lib/quick-text'
import { parseDate, parseDuration, toIso } from '../../lib/time'
import { useTimers } from '../../hooks/useEvents'
import { convertVolume, formatVolume, type VolumeUnit } from '../../lib/units'
import { bottleCheck } from './plausible'
import { SheetFooter } from './SheetFooter'
import { useSaver } from './useSaver'
import { useUnitBoundary } from '../../hooks/useStorageUnits'
import { timerKind, useTimerActions } from '../timer/useTimerActions'
import { useChildSettings } from '../../hooks/useChildSettings'
import { calorieTracking, feedKcal, kcalOf, kcalTag, strengthToSave, withKcalTag } from '../../lib/calories'
import { RecipeFold } from '../milk/Recipe'
import { recipeFor, recipeText, strengthText, type FortifySettings } from '../../lib/fortify'

type Mode = 'nursing' | 'bottle'

function initialMode(f: Feeding | null): Mode {
  if (!f) return 'nursing'
  return f.method === 'bottle' ? 'bottle' : 'nursing'
}

const SLIDER_MAX = { oz: 12, ml: 360 } as const
const SLIDER_STEP = { oz: 0.25, ml: 5 } as const

/** A breast-milk bottle saved with no bag while the stash has milk: said once, above Save, never a dialog. */
const NO_BAG_NOTE = 'Nothing comes off the stash. If this bottle was poured from a bag, pick it above.'

/**
 * What the picked bags hold, as the amount field shows it: whole mL or 0.1 oz, rounded up so the last bag
 * really empties (the take itself is capped at what the bags hold, and the server allows 3 mL of rounding).
 */
export function fillAmount(ml: number, unit: VolumeUnit): number {
  const v = convertVolume(ml, 'ml', unit)
  return unit === 'oz' ? Math.ceil(Math.round(v * 1000) / 100) / 10 : Math.ceil(Math.round(v * 100) / 100)
}

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

export function FeedingSheet({ child, editing, initial, bag: initialBag = null, prefill, onClose }: { child: Child; editing: Feeding | null; initial?: Mode; bag?: MilkBag | null; prefill?: Extract<QuickPrefill, { kind: 'bottle' | 'nursing' }>; onClose: () => void }) {
  const { prefs } = usePrefs()
  const tracking = calorieTracking(useChildSettings(child.id).settings)
  // The bags this bottle draws on, in the order they empty. `undefined` is "not touched": an edited bottle keeps
  // the bags it was poured from (`linkedTakes`, below); [] is "no bag", after Remove.
  const [choice, setChoice] = useState<MilkBag[] | undefined>(initialBag ? [initialBag] : undefined)
  // The amount was filled from the picked bags (not typed): adding or removing a bag keeps it in step.
  const [amountAuto, setAmountAuto] = useState(Boolean(initialBag))
  const [picking, setPicking] = useState(false)
  const invalidateMilk = useInvalidateMilk()
  const [mode, setMode] = useState<Mode>(() => (initialBag ? 'bottle' : initial ?? initialMode(editing)))
  const [start, setStart] = useState<Date>(() => {
    if (editing) return parseDate(editing.start)
    // "nursed left 12 min": a feed that just finished, so it starts 12 minutes back and never ends in the future.
    if (prefill?.kind === 'nursing' && prefill.minutes) {
      const latest = Date.now() - prefill.minutes * 60_000
      return new Date(Math.min(prefill.at?.getTime() ?? latest, latest))
    }
    return prefill?.at ?? new Date()
  })
  // A nursing entry keeps its per-side minutes in the first notes line ("Left 5m · Right 7m"). Read
  // them back so a both-breasts entry opens filled in, and strip that line so it is not written twice.
  const [initialSides] = useState(() => (editing && editing.method !== 'bottle' && editing.type !== 'solid food' ? parseSideNote(editing.notes) : null))
  const totalMin = editing ? Math.round(parseDuration(editing.duration) / 60) : 0
  // Quick text ("nursed left 12 min"): the minutes land on the named side, or are split when none was named.
  const quickSide = prefill?.kind === 'nursing' && prefill.minutes !== undefined ? { side: prefill.side ?? 'both', minutes: prefill.minutes } : null
  // "left 10 min right 5 min": each side as typed, not the total split in half.
  const quickLeft = prefill?.kind === 'nursing' && (prefill.left !== undefined || prefill.right !== undefined) ? prefill.left ?? 0 : null
  const quickRight = prefill?.kind === 'nursing' && (prefill.left !== undefined || prefill.right !== undefined) ? prefill.right ?? 0 : null
  const [leftMin, setLeftMin] = useState<string>(() => {
    if (quickLeft !== null) return quickLeft ? String(quickLeft) : ''
    if (quickSide) return quickSide.side === 'left' ? String(quickSide.minutes) : quickSide.side === 'both' ? String(Math.ceil(quickSide.minutes / 2)) : ''
    if (!editing) return ''
    if (initialSides?.found) return initialSides.left ? String(initialSides.left) : ''
    if (editing.method === 'left breast') return String(totalMin)
    if (editing.method === 'both breasts') return String(Math.ceil(totalMin / 2))
    return ''
  })
  const [rightMin, setRightMin] = useState<string>(() => {
    if (quickRight !== null) return quickRight ? String(quickRight) : ''
    if (quickSide) return quickSide.side === 'right' ? String(quickSide.minutes) : quickSide.side === 'both' ? String(Math.floor(quickSide.minutes / 2)) : ''
    if (!editing) return ''
    if (initialSides?.found) return initialSides.right ? String(initialSides.right) : ''
    if (editing.method === 'right breast') return String(totalMin)
    if (editing.method === 'both breasts') return String(Math.floor(totalMin / 2))
    return ''
  })
  const [milk, setMilk] = useState<FeedingType>(() => (editing && editing.type !== 'solid food' ? editing.type : (prefill?.kind === 'bottle' && prefill.milk) || 'breast milk'))
  const [initialAmount] = useState<string>(() => (editing?.amount ? String(editing.amount) : ''))
  const [amount, setAmount] = useState<string>(() => (initialBag ? String(fillAmount(initialBag.remaining_ml, prefs.units.volume)) : prefill?.kind === 'bottle' && prefill.amount !== undefined ? String(prefill.amount) : initialAmount))
  const [notes, setNotes] = useState(() => (editing && editing.type !== 'solid food' ? (initialSides?.found ? initialSides.rest : editing.notes ?? '') : ''))
  const { run, busy, error } = useSaver(child.id, onClose)
  const units = useUnitBoundary(child.id)
  const { start: startTimer, isStarting, error: timerError } = useTimerActions()
  const navigate = useNavigate()
  // A nursing timer already running (maybe on the other parent's phone): the side buttons open it rather
  // than starting a second one beside it.
  const timers = useTimers()
  const runningNursing = timers.data?.find((t) => t.child === child.id && timerKind(t.name) === 'nursing') ?? null
  const unit = prefs.units.volume
  // Editing a bottle that was poured from the stash: its bags and what it took from each, so a new amount
  // adjusts those takes, and other bags (or none) move it.
  const linked = useBagForFeeding(editing && editing.method === 'bottle' ? editing.id : null)
  const linkedTakes = useMemo(() => linked.data?.takes ?? [], [linked.data])
  const linkedBags = useMemo(() => linkedTakes.map((t) => t.bag), [linkedTakes])
  const linkedTakeMl = (bagId: number) => linkedTakes.find((t) => t.bag.id === bagId)?.use.amount_ml ?? 0
  // What is in the stash, so the "Use milk from the stash" card can say so (and stay quiet when there is nothing).
  const now = useNow(60_000)
  const stash = useMilkStash(mode === 'bottle' ? child.id : null)
  const summary = useMemo(() => summarizeStash(stash.data ?? [], now), [stash.data, now])
  const hint = stashHint(summary, unit, now)

  const bags: MilkBag[] = choice === undefined ? (editing ? linkedBags : []) : choice
  /** What a bag can give this bottle: what is in it, plus what this same bottle already took from it. */
  const available = (b: MilkBag) => b.remaining_ml + linkedTakeMl(b.id)
  const sameBagsAsLinked = bags.length === linkedBags.length && bags.every((b, i) => b.id === linkedBags[i].id)
  /** Bags the edited bottle was poured from and no longer draws on: they get their milk back on save. */
  const leaving = linkedTakes.filter((t) => !bags.some((b) => b.id === t.bag.id))
  /** The amount the picked bags suggest when nothing was typed: everything they hold. */
  const suggested = (list: MilkBag[]) => roundMl(list.reduce((sum, b) => sum + available(b), 0))
  /** Add a bag to the bottle (or take it out again); an untyped amount follows what the picked bags hold. */
  const toggleBag = (b: MilkBag) => {
    const next = bags.some((x) => x.id === b.id) ? bags.filter((x) => x.id !== b.id) : [...bags, b]
    setChoice(next)
    setMode('bottle')
    // A premade bottle mixed to a strength is fortified milk, whatever the sheet said before.
    if (!bags.some((x) => x.id === b.id) && b.kcal_per_oz) setMilk('fortified breast milk')
    else if (milk === 'formula') setMilk('breast milk')
    if (next.length && (amountAuto || !(Number(amount) > 0))) {
      setAmount(String(fillAmount(suggested(next), unit)))
      setAmountAuto(true)
    }
  }
  const typeAmount = (v: string) => {
    setAmount(v)
    setAmountAuto(false)
  }
  // Nursing and formula are not from the stash: the picked bags go (an edited stash bottle gives its milk back on save).
  const changeMode = (m: Mode) => {
    setMode(m)
    if (m === 'nursing') setChoice([])
  }
  const changeMilk = (t: FeedingType) => {
    setMilk(t)
    if (t === 'formula') setChoice([])
  }
  // Retries after a half-done save or delete: the feeding step already happened, so only the stash step runs again.
  const saved = useRef<Feeding | null>(null)
  const deleted = useRef(false)
  // Scan out: after the feeding is saved, the feeding's whole allocation is set at once (each picked bag's share,
  // oldest first; bags it no longer draws on get their milk back; [] when it is no longer from the stash). The
  // server checks the set as a whole, so a retry does not take the milk twice and a refusal changes nothing.
  // A stash failure must not undo the feeding, so it is reported but the sheet still closes.
  const saveBottle = async (body: Record<string, unknown>) => {
    const target = editing ?? saved.current
    const entry = target ? await feedingsApi.update(target.id, units.toStorage('feeding', body)) : await feedingsApi.create(units.toStorage('feeding', body))
    saved.current = entry
    const takes = plan ? plan.takes.filter((t) => t.takeMl > 0).map((t) => ({ bag: t.bag.id, amount_ml: t.takeMl })) : []
    // An edited stash bottle that became nursing or formula gives everything back, even if its bags had not loaded.
    const leftStash = !fromStash && editing !== null && editing.method === 'bottle' && editing.type !== 'formula' && (linkedTakes.length > 0 || !linked.isSuccess)
    if ((plan && takeChanged) || (!bags.length && leaving.length) || leftStash) {
      try {
        await companion.milk.setTakes(entry.id, leftStash ? [] : takes)
      } catch (err) {
        throw new Error(`The feeding is saved, but the stash did not change: ${describeApiError(err)}. Tap Save to try again.`)
      }
      invalidateMilk(child.id)
    }
    return entry
  }
  /** Deleting a bottle gives its milk back to the bags it came from, whether or not they had loaded here. */
  const deleteBottle = async () => {
    const entry = editing!
    if (!deleted.current) {
      await feedingsApi.remove(entry.id)
      deleted.current = true
    }
    if (entry.method === 'bottle' && (entry.type !== 'formula' || linkedTakes.length)) {
      try {
        await companion.milk.setTakes(entry.id, [])
      } catch (err) {
        throw new Error(`The bottle is deleted, but its milk did not go back to the stash: ${describeApiError(err)}. Tap delete again to retry.`)
      }
      invalidateMilk(child.id)
    }
  }

  function bodyFor(): Record<string, unknown> | null {
    if (mode === 'nursing') {
      const l = Number(leftMin) || 0
      const r = Number(rightMin) || 0
      if (l + r <= 0) return null
      const method: FeedingMethod = l && r ? 'both breasts' : r ? 'right breast' : 'left breast'
      const end = new Date(start.getTime() + (l + r) * 60_000)
      const sideNote = [l ? `Left ${l}m` : null, r ? `Right ${r}m` : null].filter(Boolean).join(' · ')
      return { child: child.id, start: toIso(start), end: toIso(end), type: 'breast milk', method, amount: null, notes: [sideNote, notes].filter(Boolean).join('\n') }
    }
    const amt = Number(amount)
    const body: Record<string, unknown> = { child: child.id, start: toIso(start), end: toIso(start), type: milk, method: 'bottle', amount: amt > 0 ? amt : null, notes }
    // A fortified bottle keeps the strength it was mixed at (`kcal:<n>`), so a later recipe never rewrites it; an edit
    // sends the whole tag list (the caregiver tag stays), and only when the strength changed.
    if (editing) {
      if (kcalOf(editing.tags) !== strength) body.tags = withKcalTag(editing.tags, strength)
    } else if (strength) body.tags = [kcalTag(strength)]
    // Untouched amount on an edit: leave it out so display rounding never rewrites the stored number.
    if (editing && editing.method === 'bottle' && amount === initialAmount) delete body.amount
    return body
  }

  /** What this bottle was mixed to: its premade bottle's strength, else what it was saved at, else the household's. */
  const pickedKcal = bags.find((b) => b.kcal_per_oz)?.kcal_per_oz ?? null
  const strength = mode === 'bottle' && milk !== 'solid food' ? strengthToSave(milk, { tracking, picked: pickedKcal, edited: editing && editing.method === 'bottle' ? editing : null }) : null
  const body = bodyFor()
  /** Breast milk (or fortified) by bottle: the only feeding that draws on the stash. */
  const fromStash = mode === 'bottle' && milk !== 'formula'
  const bottleFromStash = fromStash
  const nursingMinutes = (Number(leftMin) || 0) + (Number(rightMin) || 0)
  const nursingEnd = new Date(start.getTime() + nursingMinutes * 60_000)
  /** A feed that would end in the future (a start set by hand close to now): refused here, not by Baby Buddy later. */
  const endsInFuture = mode === 'nursing' && nursingEnd.getTime() > Date.now() + 60_000
  /** "Finished 15 min ago": the whole feed moves and keeps its length. */
  const finishedAt = (at: Date) => setStart(new Date(at.getTime() - nursingMinutes * 60_000))
  const implausible = mode === 'bottle' ? bottleCheck(Number(amount) || 0, unit) : null
  const sliderMax = SLIDER_MAX[unit]
  const sliderStep = SLIDER_STEP[unit]
  const sliderValue = Math.min(sliderMax, Number(amount) || 0)
  // The picked bags, filled in order: each gives all it can (what is in it plus what this bottle already took
  // from it) before the next is touched, so the same amount on the same bags is no change.
  const plan = fromStash && bags.length ? planTakes(bags, Number(amount) || 0, unit, available) : null
  const amountChanged = !editing || amount !== initialAmount
  /** Saving changes what the stash holds: a new bottle, a new amount, or other bags. */
  const takeChanged = plan !== null && (!sameBagsAsLinked || amountChanged)
  const totalTake = plan ? plan.takes.reduce((sum, t) => sum + t.takeMl, 0) : 0
  const giveBacks = leaving.map((t) => giveBackCopy(t.bag, t.use, unit))
  const saveNote =
    plan && (takeChanged || totalTake <= 0) ? (
      <p className={`use-plan ${plan.shortMl > 0 ? 'is-over' : ''}`} role={plan.shortMl > 0 ? 'alert' : 'status'}>
        {capitalise(takesCopy(plan, unit))}
        {giveBacks.length && plan.shortMl === 0 ? <span className="use-plan-more">{giveBacks.join(' · ')}</span> : null}
      </p>
    ) : !bags.length && leaving.length ? (
      <p className="use-plan" role="status">
        {giveBacks.join(' · ')} · this {mode === 'nursing' ? 'feeding' : 'bottle'} is no longer from the stash
      </p>
    ) : !bags.length && !linkedBags.length && bottleFromStash && hint && Number(amount) > 0 ? ( // only once there is a bottle to save: before that it took half a 320 screen
      <p className="use-plan is-hint" role="status">
        {NO_BAG_NOTE}
      </p>
    ) : null

  const leftField = <ValueField label="Left" unit="min" name="Left (min)" type="number" inputMode="numeric" min={0} value={leftMin} onChange={(e) => setLeftMin(e.target.value)} placeholder="0" />
  const rightField = <ValueField label="Right" unit="min" name="Right (min)" type="number" inputMode="numeric" min={0} value={rightMin} onChange={(e) => setRightMin(e.target.value)} placeholder="0" />

  return (
    <>
      <Segmented
        label="Feeding type"
        options={[{ value: 'nursing', label: 'Nursing' }, { value: 'bottle', label: 'Bottle' }]}
        value={mode}
        onChange={changeMode}
      />
      {mode === 'nursing' ? (
        <>
          {!editing && runningNursing ? (
            <LaunchRow tone="feeding" className="timer-launch" onClick={() => navigate(`/timer/${runningNursing.id}`)} title="Nursing timer already running" sub="Tap to open it and switch sides there" />
          ) : null}
          {!editing && !runningNursing ? (
            /* Each side is one column: its big live-timer button over the minutes typed for it after the fact. */
            <div className="side-columns">
              {(['left', 'right'] as const).map((side) => (
                <div key={side} className="side-col">
                  <button type="button" className="side-btn" disabled={isStarting} onClick={() => startTimer(child.id, encodeNursing(freshNursing(side)))} aria-label={`Start ${side}`}>
                    <PlayIcon />
                    <span>{side.toUpperCase()}</span>
                  </button>
                  {side === 'left' ? leftField : rightField}
                </div>
              ))}
            </div>
          ) : (
            <div className="value-pair">
              {leftField}
              {rightField}
            </div>
          )}
          {timerError ? (
            <p className="log-error" role="alert">
              Could not start the timer: {describeApiError(timerError)}
            </p>
          ) : null}
          {/* A feed has a length: the chips under the pair move the whole feed and keep it. */}
          <TimePair startLabel="Started:" endLabel="Finished:" start={start} end={nursingEnd} onStart={setStart} onEnd={finishedAt} quick={editing ? undefined : finishedAt} showLength={false}>
            {endsInFuture ? <p className="small text-health">That feed would end in the future. Move the start back, or tap when it finished.</p> : null}
          </TimePair>
        </>
      ) : null}

      {mode === 'bottle' ? (
        <>
          <FieldGroup title="Milk">
            <PillChoice
              tone="orange"
              value={milk}
              onChange={changeMilk}
              options={[
                { value: 'breast milk', label: 'Breast milk' },
                { value: 'formula', label: 'Formula' },
                { value: 'fortified breast milk', label: 'Fortified' },
              ]}
            />
          </FieldGroup>
          {linked.isLoading ? null : bags.length ? (
            <div className="stash-pick" data-testid="stash-pick">
              <ul className="stash-bags" aria-label="Bags this bottle takes from">
                {bags.map((b) => {
                  const take = plan?.takes.find((t) => t.bag.id === b.id)
                  const was = linkedTakeMl(b.id)
                  if (isNightBottle(b)) {
                    return (
                      <li key={b.id} className="stash-bag">
                        <span className="icon-circle sm tone-feeding" aria-hidden>
                          <BottleIcon />
                        </span>
                        <span className="grow stash-pick-main">
                          <span className="stash-pick-title">
                            <span className="strong stash-pick-vol">
                              Premade bottle {b.spot} · {formatMl(take?.availableMl ?? available(b), unit)}
                            </span>
                            <button type="button" className="link-btn" onClick={() => toggleBag(b)} aria-label={`Take premade bottle ${b.spot} out of this feed`}>
                              Remove
                            </button>
                          </span>
                          <span className="xs muted">The whole bottle leaves the stash · oldest milk pumped {format(parseDate(b.pumped_at), 'EEE MMM d, h:mm a')}</span>
                        </span>
                      </li>
                    )
                  }
                  return (
                    <li key={b.id} className="stash-bag">
                      <span className={`icon-circle sm ${b.location === 'freezer' ? 'tone-sleep' : 'tone-pumping'}`} aria-hidden>
                        {b.location === 'freezer' ? <SnowflakeIcon /> : <TagIcon />}
                      </span>
                      <span className="grow stash-pick-main">
                        <span className="stash-pick-title">
                          <span className="strong stash-pick-vol">
                            {take && take.takeMl > 0 ? `${formatMl(take.takeMl, unit)} from bag ${b.code}` : was ? `${formatMl(was, unit)} from bag ${b.code}` : `${formatMl(b.remaining_ml, unit)} in bag ${b.code}`}
                          </span>
                          <button type="button" className="link-btn" onClick={() => toggleBag(b)} aria-label={`Take bag ${b.code} out of this bottle`}>
                            Remove
                          </button>
                        </span>
                        <span className="xs muted">
                          {take && take.takeMl > 0 ? (take.empties ? 'all of it · the bag leaves the stash' : `${formatMl(take.leftMl, unit)} stays`) : was ? `${formatMl(b.remaining_ml, unit)} still in the stash` : ''}
                          {' · pumped '}
                          {format(parseDate(b.pumped_at), 'EEE MMM d, h:mm a')} · {LOCATION_LABEL[b.location]}
                          {b.thawed ? ', thawed' : ''}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
              <span className="xs muted">
                {bags.some(isNightBottle)
                  ? 'Set what she drank. What is left in the bottle is thrown away.'
                  : sameBagsAsLinked && editing
                  ? "Change the amount and the bags' balances follow. Deleting this bottle puts the milk back."
                  : bags.length > 1
                    ? 'The oldest bag empties first; the last one keeps the rest.'
                    : 'Pour what you need; the rest stays in the stash.'}
              </span>
              <span className="stash-pick-actions row">
                <button type="button" className="link-btn" onClick={() => setPicking(true)}>
                  Add another bag
                </button>
                <button type="button" className="link-btn" onClick={() => setChoice([])}>
                  Remove all
                </button>
              </span>
            </div>
          ) : bottleFromStash && summary.bottles.length ? (
            /* Premade bottles made ahead: one tap on the spot it sits in, then set what she drank and Save. */
            <section className="night-pick" aria-label="Premade bottles" data-testid="night-pick">
              <span className="night-pick-title">Premade bottles</span>
              <span className="night-pick-row">
                {summary.bottles.map((b) => (
                  <button key={b.id} type="button" className="night-pill" onClick={() => toggleBag(b)} aria-label={`Premade bottle ${b.spot}, ${formatMl(b.remaining_ml, unit)}`}>
                    <span className="night-pill-num">{b.spot}</span>
                    <span className="night-pill-vol">{formatMl(b.remaining_ml, unit)}</span>
                  </button>
                ))}
              </span>
              <button type="button" className="link-btn night-pick-other" onClick={() => setPicking(true)}>
                Or pick a bag from the stash
              </button>
            </section>
          ) : bottleFromStash && hint ? (
            <button type="button" className="stash-cta" data-testid="stash-cta" onClick={() => setPicking(true)}>
              <span className="icon-circle tone-pumping" aria-hidden>
                <QrIcon />
              </span>
              <span className="grow stash-cta-main">
                <span className="stash-cta-title">Use milk from the stash</span>
                <span className="stash-cta-sub">{hint}</span>
              </span>
              <ChevronRightIcon className="stash-cta-chevron" aria-hidden />
            </button>
          ) : (
            <Button variant="secondary" block onClick={() => setPicking(true)}>
              <QrIcon className="btn-icon" /> Use milk from the stash
            </Button>
          )}
          <section className="amount-group" aria-label={`Amount (${volumeLabel(unit)})`}>
            <ValueField label="Amount" unit={volumeLabel(unit)} name={`Amount in ${volumeLabel(unit)}`} type="number" inputMode="decimal" step={sliderStep} min={0} value={amount} onChange={(e) => typeAmount(e.target.value)} placeholder="optional" />
            <input
              className="amount-slider"
              type="range"
              min={0}
              max={sliderMax}
              step={sliderStep}
              value={sliderValue}
              onChange={(e) => typeAmount(e.target.value)}
              aria-label={`Amount slider in ${volumeLabel(unit)}`}
              style={{ '--fill': `${(sliderValue / sliderMax) * 100}%` } as CSSProperties}
            />
            <div className="amount-scale" aria-hidden>
              <span>0</span>
              <span>{sliderMax}</span>
            </div>
          </section>
          {tracking ? <CaloriesLine milk={milk} amount={Number(amount) || 0} unit={unit} strength={strength} mix={!editing && !pickedKcal ? tracking.fortify : null} /> : null}
          {/* A bottle is a moment: its chips set the time itself. */}
          <TimeField label="Time:" value={start} onChange={setStart} quick={editing ? undefined : setStart} />
        </>
      ) : null}

      <NoteField value={notes} onChange={setNotes} />
      {/* The recipe for any other amount, folded under everything else (a fortified bottle not poured from a premade one). */}
      {mode === 'bottle' && milk === 'fortified breast milk' && !pickedKcal && tracking?.fortify ? <RecipeFold fortify={tracking.fortify} unit={unit} /> : null}

      <SheetFooter
        busy={busy}
        error={error}
        // The picked bags must cover the bottle; a bottle on bags it did not come from needs an amount (one still on its own bags may go to zero: the milk goes back).
        disabled={!body || !units.ready || endsInFuture || (plan !== null && plan.shortMl > 0) || (plan !== null && totalTake <= 0 && !sameBagsAsLinked)}
        note={
          implausible ? (
            <>
              <p className="plausible-note" role="status">
                {implausible}
              </p>
              {saveNote}
            </>
          ) : (
            saveNote
          )
        }
        onSave={() => body && run(() => saveBottle(body))}
        onDelete={editing ? () => run(deleteBottle) : undefined}
      />
      <StashPicker open={picking} child={child.id} unit={unit} selected={bags.map((b) => b.id)} onPick={toggleBag} onClose={() => setPicking(false)} />
    </>
  )
}

/** Under the amount: what the bottle is worth in calories, at the strength it is counted at. */
function CaloriesLine({ milk, amount, unit, strength, mix }: { milk: FeedingType; amount: number; unit: VolumeUnit; strength: number | null; /** A new fortified bottle not from a premade one: say how to mix this amount. */ mix: FortifySettings | null }) {
  if (milk === 'fortified breast milk' && !strength) {
    return <p className="xs muted calories-line">Set the strength in Settings › Calories &amp; fortifying to count this bottle&apos;s calories.</p>
  }
  if (amount <= 0) return null
  const tags = strength ? [kcalTag(strength)] : []
  const kcal = feedKcal({ type: milk, method: 'bottle', amount, tags }, unit)
  if (kcal === null) return null
  const per = strength ?? 20
  const ml = convertVolume(amount, unit, 'ml')
  const recipe = milk === 'fortified breast milk' && mix ? recipeFor(ml, mix) : null
  return (
    <>
      <p className="xs muted calories-line" data-testid="bottle-kcal">
        About <span className="strong">{Math.round(kcal)} kcal</span> · {strengthText(per)}
      </p>
      {recipe ? (
        <p className="small calories-line" data-testid="bottle-mix">
          {recipe.tooSmall ? (
            `Too little milk to measure ${strengthText(mix!.kcalPerOz)} for; mix a bigger batch (the recipe chart is below).`
          ) : (
            <>
              To mix {formatVolume(amount, unit)}: add <span className="strong">{recipeText(recipe)}</span>
            </>
          )}
        </p>
      ) : null}
    </>
  )
}
