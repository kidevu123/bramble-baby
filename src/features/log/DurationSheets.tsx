import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FieldGroup, PillChoice } from '../../components/ui/Field'
import { NoteField, TimePair, ValueField } from './LogFields'
import { Button } from '../../components/ui/Button'
import { QrIcon, TagIcon } from '../../components/icons'
import { QrScanner } from '../../components/ui/QrScanner'
import { Sheet } from '../../components/ui/Sheet'
import { usePrefs } from '../../hooks/usePrefs'
import { volumeLabel } from '../../lib/units'
import { pumping as pumpingApi } from '../../lib/api/endpoints'
import type { Child, Pumping } from '../../lib/api/types'
import { DEFAULT_PUMPING_SECONDS, sessionEndingAt } from '../../lib/quick-log'
import { formatDurationShort, formatWhen, parseDate, toIso } from '../../lib/time'
import { MilkLabelSheet } from './MilkLabelSheet'
import { companion, type MilkBag, type MilkLocation } from '../../lib/api/companion'
import { SheetFooter } from './SheetFooter'
import { TimerLaunch } from './TimerLaunch'
import { useSaver } from './useSaver'
import { useUnitBoundary } from '../../hooks/useStorageUnits'
import { useInvalidateMilk, useMilkStash, useMilkWindows } from '../../hooks/useMilk'
import { formatMl, parseQrPayload, PLACE_OPTIONS, placeNote, toMl } from '../../lib/milk'
import { describeApiError } from '../../lib/api/client'
import { useLastPumping } from '../../hooks/useEvents'
import type { QuickPrefill } from '../../lib/quick-text'
import { useChildSettings } from '../../hooks/useChildSettings'
import { DEFAULT_PUMPS, pumpOf, withPumpTag } from '../../lib/pumps'
import { useAutoPrint } from '../../hooks/useAutoPrint'
import { pumpingCheck } from './plausible'
import './milk-label.css'

export function PumpingSheet({ child, editing, prefill, onClose }: { child: Child; editing: Pumping | null; prefill?: Extract<QuickPrefill, { kind: 'pumping' }>; onClose: () => void }) {
  const { prefs } = usePrefs()
  // A new session is prefilled as "like the last one, finished just now": the usual case is logging a
  // pump that ended a little while ago, so the times are one chip away and the volume is all to type.
  const last = useLastPumping(editing ? null : child.id)
  const lastSeconds = last.seconds
  const [end, setEnd] = useState<Date>(() => (editing ? parseDate(editing.end) : prefill?.end ?? new Date()))
  const [start, setStart] = useState<Date>(() => (editing ? parseDate(editing.start) : new Date(end.getTime() - (prefill?.minutes !== undefined ? prefill.minutes * 60 : lastSeconds ?? DEFAULT_PUMPING_SECONDS) * 1000)))
  // Once a time was touched (or quick text named the length), a late answer about the last session no longer moves the start.
  const touched = useRef(prefill?.minutes !== undefined)
  // The hint describes the fields only once the last session really shaped them (a chip tapped before the
  // 14-day query answered keeps the default length, and the hint must not claim otherwise).
  // A Type it line that named the length shaped the fields itself, so the hint never credits the last session.
  const [prefilled, setPrefilled] = useState<number | null>(() => (editing || prefill?.minutes !== undefined ? null : lastSeconds))
  /** "finished just now", or the time a Type it line gave ("pump 90 at 3pm"). */
  const finishedWords = prefill?.end ? `finished ${formatWhen(prefill.end)}` : 'finished just now'
  useEffect(() => {
    if (editing || touched.current || lastSeconds === null) return
    setStart(new Date(end.getTime() - lastSeconds * 1000))
    setPrefilled(lastSeconds)
  }, [lastSeconds]) // eslint-disable-line react-hooks/exhaustive-deps
  // Which pump: the entry's own when editing, else the last session's (until one is tapped). Picking a pump on a
  // new sheet whose times are untouched sets the length to that pump's usual session.
  const { settings } = useChildSettings(child.id)
  const pumps = settings.pumps ?? DEFAULT_PUMPS
  const [pump, setPump] = useState<string | null>(() => (editing ? pumpOf(editing.tags) : null))
  const pumpTouched = useRef(false)
  useEffect(() => {
    if (editing || pumpTouched.current || !last.pump) return
    setPump(last.pump)
  }, [last.pump]) // eslint-disable-line react-hooks/exhaustive-deps
  const pumpOptions = useMemo(() => {
    const names = pumps.map((p) => p.name)
    if (pump && !names.includes(pump)) names.push(pump) // a pump since removed from Settings still shows on its entries
    return names.map((n) => ({ value: n, label: n }))
  }, [pumps, pump])
  const [pumpHint, setPumpHint] = useState<string | null>(null)
  const pickPump = (name: string) => {
    pumpTouched.current = true
    const next = name === pump ? null : name
    setPump(next)
    const spec = next ? pumps.find((p) => p.name === next) : undefined
    if (!editing && !touched.current && spec) {
      setStart(new Date(end.getTime() - spec.minutes * 60_000))
      setPrefilled(null)
      setPumpHint(`Set to the ${spec.name}'s usual ${spec.minutes} min, ${finishedWords}.`)
    }
  }
  const changeStart = (d: Date) => {
    touched.current = true
    setStart(d)
  }
  const changeEnd = (d: Date) => {
    touched.current = true
    setEnd(d)
  }
  /** "Finished 30 min ago": the whole session moves, its length stays. */
  const finishedAt = (at: Date) => {
    const moved = sessionEndingAt(start, end, at)
    touched.current = true
    setStart(moved.start)
    setEnd(moved.end)
  }
  const [initialAmount] = useState(() => (editing && editing.amount !== null ? String(editing.amount) : ''))
  const [amount, setAmount] = useState(() => (!editing && prefill?.amount !== undefined ? String(prefill.amount) : initialAmount))
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [label, setLabel] = useState(false)
  // Where the milk goes: the fridge unless someone keeps it out for a bottle due soon (or freezes it).
  const [place, setPlace] = useState<MilkLocation>('fridge')
  // A bag registered from the label sheet before this entry was saved: link it once the entry exists.
  const [bagFromLabel, setBagFromLabel] = useState<MilkBag | null>(null)
  const invalidateMilk = useInvalidateMilk()
  const windows = useMilkWindows()
  // The stash bag this entry's milk went into (made by its label or by auto-print), so correcting the entry
  // corrects the bag and its label, and deleting the entry does not leave a bag behind with no session.
  const stash = useMilkStash(editing ? child.id : null)
  const entryBag = editing ? (stash.data?.find((b) => b.pumping_id === editing.id) ?? null) : null
  const autoPrint = useAutoPrint()
  // Away from home (the printer stays there): the milk went on a travel sticker printed ahead, scanned here.
  // On Save the session's bag takes the sticker's code and nothing prints.
  const [travel, setTravel] = useState<string | null>(null)
  const [scanningTravel, setScanningTravel] = useState(false)
  const [travelError, setTravelError] = useState<string | null>(null)
  const [travelAttempt, setTravelAttempt] = useState(0)
  const acceptCode = useCallback((text: string) => parseQrPayload(text), [])
  const onTravelCode = useCallback(
    (code: string) => {
      companion.milk
        .travelByCode(code)
        .then((sticker) => {
          if (sticker.child !== child.id) throw new Error(`Travel sticker ${sticker.code} belongs to another child.`)
          if (sticker.bag_id && sticker.bag_id !== entryBag?.id) throw new Error(`Travel sticker ${sticker.code} is already on other milk. Use a fresh one.`)
          setTravel(sticker.code)
          setTravelError(null)
          setScanningTravel(false)
        })
        .catch((err) => {
          const msg = describeApiError(err)
          setTravelError(/not a travel sticker/i.test(msg) || /404/.test(msg) ? `${code} is not a travel sticker. A bag's own label is reprinted from the Stash.` : msg)
          setTravelAttempt((n) => n + 1)
        })
    },
    [child.id, entryBag?.id],
  )
  // The entry is saved once: a retry after the sticker step failed only repeats that step.
  const savedEntry = useRef<Pumping | null>(null)
  const { run, busy, error } = useSaver(child.id, onClose)
  const units = useUnitBoundary(child.id)
  const invalid = end.getTime() <= start.getTime()
  const volume = Number(amount) > 0 ? Number(amount) : null
  /** Save prints the sticker by itself (printer on the server, switched on in Settings, a new entry with a volume). */
  const printsOnSave = autoPrint.enabled && !editing && volume !== null && bagFromLabel === null && travel === null
  const placeLine = placeNote(place, start, windows)
  // Without auto-print the bag is made by the label sheet, which takes this choice with it.
  const placeHint = travel ? undefined : autoPrint.enabled ? undefined : 'Goes into the stash when you print its label.'
  // Stable while nothing changed: Home re-renders every 30 s and the label sheet redraws on a new input.
  const labelInput = useMemo(
    () => (label ? { childName: child.first_name, pumpedAt: start, amount: volume, unit: prefs.units.volume, notes, birthDate: child.birth_date } : null),
    [label, child.first_name, start, volume, prefs.units.volume, notes],
  )
  const volumeTouched = !editing || amount !== initialAmount
  /** What saving changes on the bag: the label volume and the pumped time follow the entry. Null when nothing does. */
  const bagChanges = (bag: MilkBag | null) => {
    if (!bag || bag.status === 'discarded') return null
    const out: { volume_ml?: number; pumped_at?: string } = {}
    const ml = volume !== null ? Math.round(toMl(volume, prefs.units.volume) * 100) / 100 : null
    if (ml !== null && volumeTouched && Math.abs(ml - bag.volume_ml) >= 0.5) out.volume_ml = ml
    if (Math.abs(parseDate(bag.pumped_at).getTime() - start.getTime()) >= 60_000) out.pumped_at = toIso(start)
    return out.volume_ml !== undefined || out.pumped_at !== undefined ? out : null
  }
  const shownBag = bagFromLabel ?? entryBag
  const pendingBag = bagChanges(shownBag)
  // Deleting: an untouched bag leaves the stash with the entry; one a bottle already drew on stays (the milk is real).
  const deleteNote =
    editing && entryBag && entryBag.status === 'stored' ? (
      <p className="xs muted" style={{ margin: 0 }}>
        {entryBag.uses.length
          ? `Bag ${entryBag.code} already went into a bottle, so it stays in the stash if you delete this entry.`
          : `Deleting this entry also takes bag ${entryBag.code} (${formatMl(entryBag.remaining_ml, prefs.units.volume)}) out of the stash.`}
      </p>
    ) : null
  const implausible = volume !== null ? pumpingCheck(volume, prefs.units.volume) : null
  const bagNote = pendingBag && shownBag ? (
    <p className="xs muted" style={{ margin: 0 }} role="status">
      Saving also corrects bag {shownBag.code}
      {pendingBag.volume_ml !== undefined ? ` to ${formatMl(pendingBag.volume_ml, prefs.units.volume)}` : ''}
      {pendingBag.pumped_at !== undefined ? `${pendingBag.volume_ml !== undefined ? ',' : ''} pumped ${formatWhen(start)}` : ''}; print its label again afterwards.
    </p>
  ) : (
    deleteNote
  )
  const saveNote = implausible ? (
    <>
      <p className="plausible-note" role="status">
        {implausible}
      </p>
      {bagNote}
    </>
  ) : (
    bagNote
  )
  // A delete whose entry is already gone (the bag step failed): a second tap retries only the bag.
  const deleted = useRef(false)
  async function remove(id: number) {
    if (!deleted.current) {
      await pumpingApi.remove(id)
      deleted.current = true
    }
    const bags = stash.data ?? (await companion.milk.list(child.id))
    const bag = bags.find((b) => b.pumping_id === id && b.status === 'stored')
    if (bag && !bag.uses.length) {
      try {
        await companion.milk.update(bag.id, { status: 'discarded', notes: [bag.notes, 'Pumping entry deleted'].filter(Boolean).join(' · ') })
      } catch (err) {
        throw new Error(`The entry is deleted, but bag ${bag.code} is still in the stash: ${describeApiError(err)}. Tap delete again, or discard it on the Stash tab.`)
      }
      invalidateMilk(child.id)
    }
  }
  async function save() {
    // The bag first: if it cannot follow the entry, nothing is saved and Save can simply be tapped again.
    const bag = bagFromLabel ?? (editing ? ((stash.data ?? (await companion.milk.list(child.id).catch(() => []))).find((b) => b.pumping_id === editing.id) ?? null) : null)
    const changes = bagChanges(bag)
    if (bag && changes) {
      try {
        await companion.milk.update(bag.id, { ...changes, windows })
      } catch (err) {
        throw new Error(`Bag ${bag.code} could not follow this change, so nothing was saved: ${describeApiError(err)}`)
      }
      invalidateMilk(child.id)
    }
    const saved = savedEntry.current ?? (editing ? await pumpingApi.update(editing.id, body()) : await pumpingApi.create(body()))
    savedEntry.current = saved
    if (travel) {
      // The milk is on a travel sticker: its bag takes the sticker's code (a bag this session already has is
      // re-coded, else one is made), and nothing prints.
      try {
        const existing = bagFromLabel ?? bag
        if (existing) await companion.milk.update(existing.id, { travel_code: travel, ...(bagFromLabel && !bagFromLabel.pumping_id ? { pumping_id: saved.id } : {}) })
        else
          await companion.milk.create({ child: child.id, pumped_at: toIso(start), volume_ml: toMl(volume ?? 0, prefs.units.volume), location: place, pumping_id: saved.id, notes, windows, travel_code: travel })
      } catch (err) {
        throw new Error(`The session is saved, but travel sticker ${travel} is not on it yet: ${describeApiError(err)}. Tap Save to try again.`)
      }
      invalidateMilk(child.id)
      return saved
    }
    if (bagFromLabel && !bagFromLabel.pumping_id) {
      await companion.milk.update(bagFromLabel.id, { pumping_id: saved.id }).catch(() => undefined)
      invalidateMilk(child.id)
    }
    // Not awaited: the sheet closes now and the PrintNotice bar follows the print.
    void autoPrint.run(child, saved, volume, { editing: Boolean(editing), bag: bagFromLabel, location: place })
    return saved
  }
  // Baby Buddy requires a pumping amount (the field is not nullable); saving without one is a 400.
  const body = () =>
    editing && amount === initialAmount
      ? { child: child.id, start: toIso(start), end: toIso(end), notes, tags: withPumpTag(editing.tags, pump) } // untouched: no rounding drift
      : units.toStorage('pumping', { child: child.id, start: toIso(start), end: toIso(end), amount: volume ?? 0, notes, tags: withPumpTag(editing?.tags, pump) })
  const unitLabel = volumeLabel(prefs.units.volume)
  const timeHint = prefilled !== null ? `Like the last session: ${formatDurationShort(prefilled)}, ${finishedWords}.` : pumpHint
  return (
    <>
      {!editing ? <TimerLaunch child={child} name="pumping" tone="pumping" label="Start pumping timer" /> : null}
      {/* The volume is the one thing typed: first, focused, and with the pump and the place it fits above the keyboard. */}
      <ValueField label="Volume" unit={unitLabel} name={`Volume in ${unitLabel}`} type="number" inputMode="decimal" step="0.25" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" data-autofocus={editing ? undefined : ''} />
      {pumpOptions.length ? (
        <FieldGroup title="Pump">
          <PillChoice options={pumpOptions} value={pump} onChange={pickPump} tone="purple" />
        </FieldGroup>
      ) : (
        <p className="log-hint">Add your pumps in Settings › Pumps to compare them in Reports.</p>
      )}
      {!editing && !bagFromLabel ? (
        <FieldGroup title="Milk goes in" hint={placeHint}>
          <PillChoice options={PLACE_OPTIONS} value={place} onChange={setPlace} tone="teal" />
          {placeLine ? (
            <p className={`small ${placeLine.late ? 'text-health' : 'text-pumping'}`} role="status" data-testid="place-note">
              {placeLine.text}
            </p>
          ) : null}
        </FieldGroup>
      ) : null}
      {travel ? (
        <div className="travel-pick" data-testid="travel-pick">
          <QrIcon className="travel-pick-icon" aria-hidden />
          <span className="grow travel-pick-main">
            <span className="strong">Travel sticker {travel}</span>
            <span className="xs muted">{entryBag ? `Bag ${entryBag.code} takes this code.` : 'Its milk goes into the stash with this code; nothing prints.'}</span>
          </span>
          <button type="button" className="link-btn" onClick={() => setTravel(null)} aria-label="Remove the travel sticker">
            Remove
          </button>
        </div>
      ) : !editing || volume !== null ? (
        <button type="button" className="link-btn travel-link" onClick={() => { setTravelError(null); setScanningTravel(true) }}>
          On a travel sticker? Scan it
        </button>
      ) : null}
      <TimePair startLabel="Started:" endLabel="Finished:" start={start} end={end} onStart={changeStart} onEnd={changeEnd} quick={editing ? undefined : finishedAt} hint={timeHint}>
        {invalid ? <p className="small text-health">Finish time must be after start time.</p> : null}
      </TimePair>
      <NoteField value={notes} onChange={setNotes} />
      {/* The milk label is the sheet's second action: beside Save, never under the fold. */}
      <SheetFooter
        busy={busy}
        error={error}
        disabled={invalid || amount.trim() === '' || !units.ready}
        note={
          <>
            {saveNote}
            {printsOnSave ? (
              <p className="label-auto-note text-pumping" role="status">
                <TagIcon aria-hidden /> Prints by itself when you save
              </p>
            ) : null}
          </>
        }
        extra={
          <Button variant="secondary" size="lg" className="label-btn soft-pumping text-pumping" onClick={() => setLabel(true)} disabled={invalid} aria-label="Print milk label">
            <TagIcon className="btn-icon" aria-hidden /> Label
          </Button>
        }
        onSave={() => run(save)}
        onDelete={editing ? () => run(() => remove(editing.id)) : undefined}
      />
      <Sheet open={scanningTravel} title="Scan the travel sticker" onClose={() => setScanningTravel(false)}>
        {scanningTravel ? (
          <div className="stack">
            <QrScanner key={travelAttempt} onDecode={onTravelCode} accept={acceptCode} onCancel={() => setScanningTravel(false)} />
            {travelError ? (
              <p className="log-error" role="alert">
                {travelError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      <MilkLabelSheet
        open={label}
        child={child.id}
        pumpingId={editing?.id ?? null}
        location={place}
        bag={bagFromLabel}
        input={labelInput}
        onAmount={(a) => setAmount(String(a))}
        onRegistered={setBagFromLabel}
        onClose={() => setLabel(false)}
      />
    </>
  )
}
