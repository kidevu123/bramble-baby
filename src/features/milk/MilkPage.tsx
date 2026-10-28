import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '../../components/nav/TopBar'
import { Button } from '../../components/ui/Button'
import { QrScanner } from '../../components/ui/QrScanner'
import { Sheet } from '../../components/ui/Sheet'
import { ChevronDownIcon, PlusIcon, QrIcon, TrashIcon } from '../../components/icons'
import { TextField, TimeField } from '../../components/ui/Field'
import { volumeLabel } from '../../lib/units'
import { BagRow, StashKey } from './BagRow'
import { NicuTripSheet } from './NicuTripSheet'
import { NightBottlesSheet } from './NightBottlesSheet'
import { FortifyCard } from './FortifyCard'
import { stashCounts } from './stash-counts'
import { useAutoPrint } from '../../hooks/useAutoPrint'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { rangeDays, useChildEvents } from '../../hooks/useEvents'
import { useInvalidateMilk, useMilkStash, useMilkWindows } from '../../hooks/useMilk'
import { usePeople } from '../../hooks/usePeople'
import { useNow } from '../../hooks/useNow'
import { usePrefs } from '../../hooks/usePrefs'
import { stashKeyItems } from '../../lib/stash-key'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag, type MilkLocation } from '../../lib/api/companion'
import { bagAmountIn, bagLeft, bagState, bagVolume, describeUse, formatMl, freeSpots, isNightBottle, isPartlyUsed, LOCATION_LABEL, NIGHT_SPOTS, nightBottleSources, parseQrPayload, sectionPreview, stashItemName, stashSections, summarizeStash, toMl, type StashSectionKey } from '../../lib/milk'
import { goalLine, runwayHeadline, runwayLine, stashRunway } from '../../lib/stash-runway'
import { ageBasis, inNicuOn } from '../../lib/preterm'
import { isColostrum, nicuCandidates, nicuTrips } from '../../lib/nicu-stash'
import { formatAgo, parseDate } from '../../lib/time'
import { convertVolume } from '../../lib/units'

const stashVolume = (ml: number, unit: 'oz' | 'ml') => (ml ? formatMl(ml, unit) : '—')
const toggled = <T,>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
import { LogSheet, type LogRequest } from '../log/LogSheet'
import { MilkLabelSheet } from '../log/MilkLabelSheet'
import './milk.css'

/** Everything in the fridge and freezer, oldest first, with scan-out, moves, discards and reprints. */
export function MilkPage() {
  const { child } = useChildren()
  const { prefs } = usePrefs()
  const now = useNow(60_000)
  const stash = useMilkStash(child?.id ?? null)
  const invalidate = useInvalidateMilk()
  const windows = useMilkWindows()
  const { names } = usePeople()
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MilkBag | null>(null)
  const [request, setRequest] = useState<LogRequest | null>(null)
  const [reprint, setReprint] = useState<MilkBag | null>(null)
  // Milk that already exists (no pumping entry): the label sheet asks for its details and registers it.
  const [adding, setAdding] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [making, setMaking] = useState(false)
  // Rearrange the premade bottles: tap a bottle, then the spot it now sits in (a bottle there swaps places).
  const [rearranging, setRearranging] = useState(false)
  const [moving, setMoving] = useState<MilkBag | null>(null)
  const [trip, setTrip] = useState(false)
  // A bag whose milk went on a travel sticker printed ahead: scan the sticker and the bag takes its code.
  const [recoding, setRecoding] = useState<MilkBag | null>(null)
  const [recodeAttempt, setRecodeAttempt] = useState(0)
  // A failed lookup leaves the camera stopped on its last frame; a new key starts it again.
  const [scanAttempt, setScanAttempt] = useState(0)

  const bags = useMemo(() => stash.data ?? [], [stash.data])
  const summary = useMemo(() => summarizeStash(bags, now), [bags, now])
  // How long the stash lasts: the same two-week window Home keeps warm, so no extra fetch on a normal day.
  const dayKey = now.toDateString()
  const range = useMemo(() => rangeDays(14, now), [dayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useChildEvents(child?.id ?? null, range)
  const { settings } = useChildSettings(child?.id ?? null)
  const runway = useMemo(() => stashRunway(bags, events.feedings, events.pumping, prefs.units.volume, settings.stashGoalDays, now), [bags, events.feedings, events.pumping, prefs.units.volume, settings.stashGoalDays, now])
  const sections = useMemo(() => stashSections(bags, now), [bags, now])
  // In the NICU (Settings › Born early): the milk is taken in, not fed at home. The card says what went in and
  // what is waiting; colostrum is tagged (it goes first); premade bottles step aside.
  const birth = child?.birth_date ?? null
  const nicu = child ? inNicuOn(ageBasis(child, settings), now) : false
  const trips = useMemo(() => nicuTrips(bags, now), [bags, now])
  const toTake = useMemo(() => nicuCandidates(bags, birth, now), [bags, birth, now])
  const keyItems = useMemo(() => stashKeyItems(sections.flatMap((section) => section.bags), prefs.labels), [sections, prefs.labels])
  // Long places show their first bags (soonest deadline) and "Show N more"; opened ones stay open while the tab is.
  const [expanded, setExpanded] = useState<Set<StashSectionKey>>(() => new Set())
  const counts = useMemo(() => stashCounts(bags, now), [bags, now])
  const history = useMemo(() => bags.filter((b) => b.status !== 'stored').sort((a, b) => (b.used_at ?? '').localeCompare(a.used_at ?? '')).slice(0, 20), [bags])
  const unit = prefs.units.volume
  // Premade bottles: the spots (1–5) and whether there is fridge milk to pour more from.
  const spotBottles = useMemo(() => new Map(bags.filter((b) => isNightBottle(b) && b.status === 'stored').map((b) => [b.spot ?? 0, b])), [bags])
  const canPour = useMemo(() => nightBottleSources(bags, now).length > 0, [bags, now])
  const canMake = canPour && freeSpots(bags).length > 0
  // A usual bottle for the size field: the middle of the last ten breast-milk bottles (phone unit).
  const typical = useMemo(() => {
    const amounts = events.feedings
      .filter((f) => f.method === 'bottle' && f.type !== 'formula' && f.type !== 'solid food' && typeof f.amount === 'number' && f.amount > 0)
      .sort((a, b) => b.start.localeCompare(a.start))
      .slice(0, 10)
      .map((f) => f.amount as number)
      .sort((a, b) => a - b)
    return amounts.length ? amounts[Math.floor(amounts.length / 2)] : null
  }, [events.feedings])

  const { reprintMoved } = useAutoPrint()
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof companion.milk.update>[1] }) => companion.milk.update(id, { ...body, windows }),
    onSuccess: () => {
      if (child) invalidate(child.id)
      setSelected(null)
    },
  })
  // Undo a premade bottle: the milk goes back on its bags and the spot is free.
  const unmake = useMutation({
    mutationFn: (id: number) => companion.milk.unmakeBottle(id),
    onSuccess: () => {
      if (child) invalidate(child.id)
      setSelected(null)
    },
  })
  const move = useMutation({
    mutationFn: ({ id, spot }: { id: number; spot: number }) => companion.milk.moveBottle(id, spot),
    onSuccess: () => {
      if (child) invalidate(child.id)
      setMoving(null)
    },
  })
  const tapSpot = (spot: number, bottle: MilkBag | undefined) => {
    if (!rearranging) {
      if (bottle) setSelected(bottle)
      return
    }
    move.reset()
    if (!moving) {
      if (bottle) setMoving(bottle)
      return
    }
    if (moving.spot === spot) setMoving(null)
    else move.mutate({ id: moving.id, spot })
  }
  // An error belongs to the bag it happened on: opening another bag (or closing this one) starts clean.
  const { reset: resetPatch } = patch
  const { reset: resetUnmake } = unmake
  useEffect(() => {
    resetPatch()
    resetUnmake()
  }, [selected?.id, resetPatch, resetUnmake])

  const lookup = useMutation({
    mutationFn: (code: string) => companion.milk.byCode(code),
    onSuccess: (bag) => {
      setScanning(false)
      setScanError(null)
      setSelected(bag)
    },
    onError: (err) => {
      setScanError(describeApiError(err))
      setScanAttempt((n) => n + 1)
    },
  })

  // `mutate` is stable; the mutation result object is new every render (the page ticks every minute) and
  // would make the scanner stop and restart the camera on each one.
  const { mutate: lookupCode } = lookup
  const onDecode = useCallback((code: string) => lookupCode(code), [lookupCode])
  const accept = useCallback((text: string) => parseQrPayload(text), [])

  if (!child) return null

  const startBottle = (bag: MilkBag) => {
    setSelected(null)
    setRequest({ kind: 'bottle', bag })
  }

  return (
    <>
      <TopBar title="Stash" />
      <main className="page stack milk-page">
        <section className="stash-summary">
          <div className="stash-stat">
            <span className="stash-num">{counts.cold.count}</span>
            <span className="xs muted stash-sub">{counts.room.count ? (
                <>
                  in fridge <span className="stash-out">· {counts.room.count} out</span>
                </>
              ) : (
                'in fridge'
              )}</span>
            <span className="xs strong stash-sub">{stashVolume(counts.cold.ml, unit)}</span>
          </div>
          <div className="stash-stat">
            <span className="stash-num">{counts.frozen.count}</span>
            <span className="xs muted stash-sub">frozen</span>
            <span className="xs strong stash-sub">{stashVolume(counts.frozen.ml, unit)}</span>
          </div>
          <div className="stash-stat">
            <span className={`stash-num ${counts.expired.count ? 'text-health' : counts.soon.count ? 'text-pumping' : ''}`}>{counts.expired.count || counts.soon.count}</span>
            <span className="xs muted stash-sub">{counts.expired.count ? 'expired' : 'expiring soon'}</span>
            <span className="xs strong stash-sub">{stashVolume(counts.expired.count ? counts.expired.ml : counts.soon.ml, unit)}</span>
          </div>
        </section>

        {!stash.isLoading && nicu ? (
          <section className="card card-pad runway" data-testid="nicu-stash" aria-label="Taken to the NICU">
            <span className="runway-head">{trips.weekBags ? `${trips.weekBags} ${trips.weekBags === 1 ? 'bag' : 'bags'} · ${formatMl(trips.weekMl, unit)}` : 'Nothing taken in yet'}</span>
            <span className="small runway-line">
              {trips.weekBags ? 'taken to the NICU in the last 7 days' : `Bags go to the NICU from here; ${child.first_name}'s nurses keep track of them after that.`}
              {trips.last ? ` · last trip ${formatAgo(trips.last.toISOString(), now)}` : ''}
            </span>
            <span className="xs muted runway-goal">
              {toTake.length ? `At home: ${toTake.length} ${toTake.length === 1 ? 'bag' : 'bags'} · ${formatMl(toTake.reduce((s, b) => s + b.remaining_ml, 0), unit)}` : 'Nothing at home waiting to go in.'}
            </span>
            {toTake.length ? (
              <Button variant="secondary" block onClick={() => setTrip(true)}>
                Take to the NICU
              </Button>
            ) : null}
          </section>
        ) : null}
        {!stash.isLoading && !nicu ? (
          <section className="card card-pad runway" data-testid="stash-runway" aria-label="How long the stash lasts">
            <span className="runway-head">{runwayHeadline(runway)}</span>
            <span className="small runway-line">{runwayLine(runway, unit, child.first_name)}</span>
            {runway.goalDays !== null ? (
              <>
                {runway.goalProgress !== null ? (
                  <span className="runway-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(runway.goalProgress * 100)} aria-label="Stash goal">
                    <span className="runway-fill" style={{ width: `${Math.max(2, Math.round(runway.goalProgress * 100))}%` }} />
                  </span>
                ) : null}
                <span className="xs muted runway-goal">{goalLine(runway, unit, child.first_name, now)}</span>
              </>
            ) : null}
          </section>
        ) : null}
        {/* The two ways in, side by side: the bag list right under them is what the page is for. */}
        <div className="row stash-actions">
          <Button size="lg" block onClick={() => { setScanError(null); setScanning(true) }}>
            <QrIcon className="btn-icon" /> Scan a bag
          </Button>
          <Button size="lg" variant="secondary" block onClick={() => setAdding(true)} aria-label="Add milk you already have">
            <PlusIcon className="btn-icon" /> Add milk
          </Button>
        </div>
        {stash.isError ? (
          <p className="log-error" role="alert">
            {describeApiError(stash.error)}
          </p>
        ) : null}

        {!stash.isLoading && (spotBottles.size || (canPour && !nicu)) ? (
          <section className="night-bottles" aria-label="Premade bottles" data-testid="night-bottles">
            <header className="stash-section-head">
              <h3>Premade bottles</h3>
              <span className="small muted spot-head-right">
                {spotBottles.size ? `${spotBottles.size} ready · ${formatMl([...spotBottles.values()].reduce((sum, b) => sum + b.remaining_ml, 0), unit)}` : 'Made ahead, one per spot'}
                {spotBottles.size ? (
                  <button
                    type="button"
                    className="link-btn xs spot-rearrange"
                    aria-pressed={rearranging}
                    onClick={() => {
                      setRearranging((v) => !v)
                      setMoving(null)
                      move.reset()
                    }}
                  >
                    {rearranging ? 'Done' : 'Rearrange'}
                  </button>
                ) : null}
              </span>
            </header>
            {rearranging ? (
              <p className="xs muted spot-hint" role="status">
                {moving ? `Now tap the spot for bottle ${moving.spot}, or the same bottle to cancel.` : 'Tap a bottle, then the spot to move it to. A bottle already there swaps places.'}
              </p>
            ) : null}
            <ul className="spot-grid">
              {Array.from({ length: NIGHT_SPOTS }, (_, i) => i + 1).map((spot) => {
                const b = spotBottles.get(spot)
                if (!b) {
                  // Empty spots take a bottle while rearranging; otherwise they are only a picture of the fridge.
                  return rearranging && moving ? (
                    <li key={spot}>
                      <button type="button" className="spot is-empty is-target" onClick={() => tapSpot(spot, undefined)} aria-label={`Move bottle ${moving.spot} to spot ${spot}`}>
                        <span className="spot-num">{spot}</span>
                        <span className="spot-vol">empty</span>
                      </button>
                    </li>
                  ) : (
                    <li key={spot} className="spot is-empty" aria-label={`Spot ${spot}, empty`}>
                      <span className="spot-num">{spot}</span>
                      <span className="spot-vol">empty</span>
                    </li>
                  )
                }
                const state = bagState(b, now)
                return (
                  <li key={spot}>
                    <button
                      type="button"
                      className={`spot is-filled state-${state}${rearranging ? ' is-rearranging' : ''}${moving?.id === b.id ? ' is-moving' : ''}`}
                      onClick={() => tapSpot(spot, b)}
                      aria-pressed={rearranging ? moving?.id === b.id : undefined}
                      aria-label={rearranging && moving && moving.id !== b.id ? `Swap bottle ${moving.spot} with bottle ${spot}` : `Premade bottle ${spot}, ${formatMl(b.remaining_ml, unit)}${b.kcal_per_oz ? `, fortified to ${b.kcal_per_oz} kcal/oz` : ''}${state === 'expired' ? ', expired' : ''}`}
                    >
                      <span className="spot-num">{spot}</span>
                      <span className="spot-vol">{state === 'expired' ? 'expired' : formatMl(b.remaining_ml, unit)}</span>
                      {b.kcal_per_oz && state !== 'expired' ? <span className="spot-kcal">{b.kcal_per_oz} kcal</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
            {move.isError ? (
              <p className="log-error" role="alert">
                {describeApiError(move.error)}
              </p>
            ) : null}
            {canMake && !rearranging ? (
              <Button variant="secondary" block onClick={() => setMaking(true)}>
                Make premade bottles
              </Button>
            ) : null}
          </section>
        ) : null}

        {/* Fortifying (Settings › Calories & fortifying): the recipe beside the bottles it goes into. */}
        {settings.fortify ? <FortifyCard fortify={settings.fortify} unit={unit} /> : null}

        {stash.isLoading ? <p className="small muted">Loading…</p> : null}
        {!stash.isLoading && sections.length === 0 ? (
          <p className="small muted">Nothing in the stash. Print a milk label from a pumping session, or add milk you already have, and each bag shows up here with a QR code.</p>
        ) : null}
        <StashKey items={keyItems} />
        {sections.map((section) => {
          const open = expanded.has(section.key)
          const shown = open ? section.bags.length : sectionPreview(section.bags.length, section.key)
          const rest = section.bags.slice(shown)
          return (
            <section key={section.key} className={`stash-section is-${section.key}`} aria-label={section.title} data-testid={`stash-${section.key}`}>
              <header className="stash-section-head">
                <h3>{section.title}</h3>
                <span className="small muted">
                  {section.bags.length} {section.bags.length === 1 ? 'bag' : 'bags'} · {formatMl(section.ml, unit)}
                </span>
              </header>
              {section.key === 'expired' ? <p className="xs muted stash-section-note">Past their window: tap one to discard it.</p> : null}
              <ul className="bag-list">
                {section.bags.slice(0, shown).map((bag) => (
                  <BagRow key={bag.id} bag={bag} unit={unit} now={now} place={false} useFirst={bag.id === summary.useFirst?.id} colostrum={nicu && isColostrum(bag.pumped_at, birth)} onOpen={() => setSelected(bag)} />
                ))}
              </ul>
              {rest.length || open ? (
                <button type="button" className="stash-more" aria-expanded={open} onClick={() => setExpanded((prev) => toggled(prev, section.key))}>
                  {open && !rest.length ? 'Show fewer' : `Show ${rest.length} more · ${formatMl(rest.reduce((sum, b) => sum + b.remaining_ml, 0), unit)}`}
                  <ChevronDownIcon className={`stash-more-chev${open ? ' is-open' : ''}`} />
                </button>
              ) : null}
            </section>
          )
        })}

        {history.length ? (
          <section className="stack">
            <button type="button" className="customize-link" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? 'Hide' : 'Show'} used and discarded ({history.length})
            </button>
            {patch.isError && selected === null ? (
              <p className="log-error" role="alert">
                Could not undo: {describeApiError(patch.error)}
              </p>
            ) : null}
            {showHistory ? (
              <ul className="bag-list muted-list">
                {history.map((bag) => (
                  <li key={bag.id} className="bag-row static">
                    <span className="bag-vol">{bagLeft(bag, unit)}</span>
                    <span className="grow small muted">
                      {historyLine(bag, unit)} {bag.used_at ? formatAgo(bag.used_at, now) : ''} · pumped {format(parseDate(bag.pumped_at), 'MMM d h:mm a')} · {isNightBottle(bag) ? `premade bottle ${bag.spot}` : bag.code}
                    </span>
                    <button type="button" className="link-btn xs" onClick={() => patch.mutate({ id: bag.id, body: { status: 'stored' } })}>
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </main>

      <Sheet open={scanning} title="Scan a milk bag" onClose={() => setScanning(false)}>
        {scanning ? (
          <div className="stack">
            <QrScanner key={scanAttempt} onDecode={onDecode} accept={accept} onCancel={() => setScanning(false)} />
            {scanError ? (
              <p className="log-error" role="alert">
                {scanError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet open={selected !== null} title={selected ? stashItemName(selected) : ''} onClose={() => setSelected(null)}>
        {selected ? (
          <BagActions
            bag={selected}
            unit={unit}
            now={now}
            busy={patch.isPending || unmake.isPending}
            error={patch.isError ? describeApiError(patch.error) : unmake.isError ? describeApiError(unmake.error) : null}
            onUndo={() => patch.mutate({ id: selected.id, body: { status: 'stored' } })}
            onUnmake={() => unmake.mutate(selected.id)}
            onBottle={() => startBottle(selected)}
            onMove={(location, at) => {
              const from = selected.location
              // Into the freezer or out of it to thaw: a new label prints when Settings asks for it (reprintOnMoveWanted).
              patch.mutate({ id: selected.id, body: at ? { location, moved_at: at.toISOString() } : { location } }, { onSuccess: (moved) => void reprintMoved(child, moved, from) })
            }}
            onDiscard={() => patch.mutate({ id: selected.id, body: { status: 'discarded' } })}
            onUsedElsewhere={() => patch.mutate({ id: selected.id, body: { status: 'used' } })}
            onSetLeft={(ml) => patch.mutate({ id: selected.id, body: { remaining_ml: ml } })}
            onReprint={() => {
              setSelected(null)
              setReprint(selected)
            }}
            onTravel={() => {
              patch.reset()
              setRecoding(selected)
              setSelected(null)
            }}
          />
        ) : null}
      </Sheet>

      <Sheet open={recoding !== null} title="Scan the travel sticker" onClose={() => setRecoding(null)}>
        {recoding ? (
          <div className="stack">
            <p className="small muted">Bag {recoding.code} takes the travel sticker's code; its old label stops working.</p>
            <QrScanner
              key={recodeAttempt}
              accept={accept}
              onCancel={() => setRecoding(null)}
              onDecode={(code) =>
                patch.mutate(
                  { id: recoding.id, body: { travel_code: code } },
                  { onSuccess: () => setRecoding(null), onError: () => setRecodeAttempt((n) => n + 1) },
                )
              }
            />
            {patch.isError ? (
              <p className="log-error" role="alert">
                {describeApiError(patch.error)}
              </p>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      <NicuTripSheet open={trip} child={child.id} candidates={toTake} birth={child.birth_date} unit={unit} now={now} onClose={() => setTrip(false)} />
      <NightBottlesSheet open={making} child={child.id} bags={bags} unit={unit} now={now} typical={typical} fortify={settings.fortify ?? null} onClose={() => setMaking(false)} />
      <LogSheet request={request} child={child} names={names} onClose={() => setRequest(null)} />
      <MilkLabelSheet
        open={reprint !== null || adding}
        child={child.id}
        bag={reprint}
        intake={adding}
        input={
          reprint
            ? { childName: child.first_name, pumpedAt: parseDate(reprint.pumped_at), amount: convertVolume(reprint.volume_ml, 'ml', unit), unit, notes: reprint.notes, code: reprint.code, birthDate: child.birth_date }
            : adding
              ? { childName: child.first_name, pumpedAt: now, amount: null, unit, birthDate: child.birth_date }
              : null
        }
        onClose={() => {
          setReprint(null)
          setAdding(false)
        }}
      />
    </>
  )
}


/** "Used" / "Discarded" for the history list; a part-used bag says so. */
function historyLine(bag: MilkBag, unit: 'oz' | 'ml'): string {
  if (bag.status === 'discarded') return isPartlyUsed(bag) ? `Discarded with ${formatMl(bag.remaining_ml, unit)} left` : 'Discarded'
  if (bag.uses.some((u) => u.kind === 'nicu')) return 'Taken to the NICU'
  const bottles = bag.uses.filter((u) => u.kind === 'bottle').length
  return bottles > 1 ? `Used up over ${bottles} bottles` : 'Used'
}

function BagActions({ bag, unit, now, busy, error, onUndo, onUnmake, onBottle, onMove, onDiscard, onUsedElsewhere, onSetLeft, onReprint, onTravel }: { bag: MilkBag; unit: 'oz' | 'ml'; now: Date; busy: boolean; error: string | null; onUndo: () => void; onUnmake: () => void; onBottle: () => void; onMove: (l: MilkLocation, at?: Date) => void; onDiscard: () => void; onUsedElsewhere: () => void; onSetLeft: (ml: number) => void; onReprint: () => void; onTravel: () => void }) {
  const state = bagState(bag, now)
  const partly = isPartlyUsed(bag)
  const [adjusting, setAdjusting] = useState(false)
  // Milk out on the counter past its window that really went in the fridge in time: when it went in.
  const [fridgedAt, setFridgedAt] = useState<Date | null>(null)
  // Opened with the balance in the field (not as a grey placeholder that reads as empty), and focused: the
  // field appears after the sheet opened, so the sheet's own autofocus never reaches it.
  const [leftText, setLeftText] = useState(() => String(bagAmountIn(bag, unit)))
  const leftRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (adjusting) leftRef.current?.querySelector('input')?.focus({ preventScroll: true })
  }, [adjusting])
  if (bag.status !== 'stored') return <GoneBag bag={bag} unit={unit} now={now} busy={busy} error={error} onUndo={onUndo} onReprint={onReprint} />
  if (isNightBottle(bag)) return <BottleActions bag={bag} unit={unit} now={now} busy={busy} error={error} onBottle={onBottle} onDiscard={onDiscard} onUnmake={onUnmake} />
  const leftMl = leftText === '' ? null : toMl(Number(leftText), unit)
  const leftProblem = leftMl === null || Number.isNaN(leftMl) ? 'Enter what is left in the bag.' : leftMl < 0 ? 'It cannot be less than nothing.' : leftMl > bag.volume_ml + 0.01 ? `The bag held ${bagVolume(bag, unit)}; it cannot have more than that left.` : null
  const leftWhat = leftMl === null || leftProblem ? null : leftMl < 1 ? 'Nothing left: the bag leaves the stash as used.' : `${formatMl(leftMl, unit)} stays in the stash.`
  return (
    <div className="stack">
      <div className="bag-head">
        <p className="strong bag-head-vol">
          {bagLeft(bag, unit)}
          {partly ? <span className="bag-head-left"> left</span> : null}
        </p>
        {partly ? (
          <div className="bag-gauge" role="img" aria-label={`${formatMl(bag.remaining_ml, unit)} of ${bagVolume(bag, unit)} left`}>
            <span className="bag-gauge-fill" style={{ width: `${Math.max(4, Math.round((bag.remaining_ml / bag.volume_ml) * 100))}%` }} />
          </div>
        ) : null}
        <p className={`small ${state === 'expired' ? 'text-health' : state === 'soon' ? 'text-pumping' : 'muted'}`}>
          Pumped {format(parseDate(bag.pumped_at), 'EEE MMM d, h:mm a')} · {LOCATION_LABEL[bag.location]}
          {bag.thawed ? ', thawed' : ''} · {state === 'expired' ? `expired ${formatAgo(bag.expires_at, now)}` : `good until ${format(parseDate(bag.expires_at), 'EEE MMM d, h:mm a')}`}
        </p>
      </div>
      {bag.uses.length ? (
        <ul className="bag-uses" aria-label="What came out of this bag">
          {bag.uses.map((u) => (
            <li key={u.id}>
              <span>{describeUse(u, unit)}</span>
              <span className="xs muted">{format(parseDate(u.at), 'EEE MMM d, h:mm a')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="log-error" role="alert">
          {error}
        </p>
      ) : null}
      {adjusting ? (
        <form
          className="bag-adjust stack"
          onSubmit={(e) => {
            e.preventDefault()
            if (leftMl !== null && !leftProblem) onSetLeft(leftMl)
          }}
        >
          <div ref={leftRef}>
            <TextField
              label={`What's left in the bag (${volumeLabel(unit)})`}
              type="number"
              inputMode="decimal"
              min={0}
              step={unit === 'oz' ? 0.1 : 1}
              value={leftText}
              onChange={(e) => setLeftText(e.target.value)}
              hint="A spill, a syringe, a misread: set what is really in the bag. 0 means it is used up."
            />
          </div>
          {leftText !== '' ? (
            <p className={`small ${leftProblem ? 'text-health' : 'muted'}`} role={leftProblem ? 'alert' : 'status'}>
              {leftProblem ?? leftWhat}
            </p>
          ) : null}
          <div className="row">
            <Button variant="secondary" block type="button" onClick={() => { setAdjusting(false); setLeftText(String(bagAmountIn(bag, unit))) }} disabled={busy}>
              Cancel
            </Button>
            <Button block type="submit" loading={busy} disabled={leftMl === null || leftProblem !== null || leftText === String(bagAmountIn(bag, unit))}>
              Set what's left
            </Button>
          </div>
        </form>
      ) : null}
      {state !== 'expired' ? (
        <Button size="lg" block onClick={onBottle} disabled={busy}>
          Make a bottle with this bag
        </Button>
      ) : (
        <Button size="lg" block variant="danger" onClick={onDiscard} loading={busy}>
          <TrashIcon className="btn-icon" /> Discard expired milk
        </Button>
      )}
      {state === 'expired' && bag.location === 'room' ? (
        <InTimeMove bag={bag} now={now} at={fridgedAt} onAt={setFridgedAt} busy={busy} onMove={(at) => onMove('fridge', at)} />
      ) : null}
      {state !== 'expired' ? (
      <div className="row">
        {bag.location !== 'freezer' && !bag.thawed ? (
          <Button variant="secondary" block onClick={() => onMove('freezer')} disabled={busy}>
            Move to freezer
          </Button>
        ) : null}
        {bag.location !== 'fridge' ? (
          <Button variant="secondary" block onClick={() => onMove('fridge')} disabled={busy}>
            {bag.location === 'freezer' ? 'Thaw in fridge' : 'Move to fridge'}
          </Button>
        ) : null}
        {bag.location !== 'room' ? (
          <Button variant="secondary" block onClick={() => onMove('room')} disabled={busy}>
            Out on counter
          </Button>
        ) : null}
      </div>
      ) : null}
      {bag.location === 'freezer' && state !== 'expired' ? <p className="xs muted">Thawed milk keeps 24 hours in the fridge and is never refrozen; the clock restarts when you thaw it.</p> : null}
      <div className="bag-actions-ghosts">
        {!adjusting ? (
          <Button variant="ghost" block onClick={() => setAdjusting(true)} disabled={busy}>
            Adjust what's left
          </Button>
        ) : null}
        <Button variant="ghost" block onClick={onReprint} disabled={busy}>
          Reprint label
        </Button>
        {state !== 'expired' ? (
          <Button variant="ghost" block onClick={onTravel} disabled={busy}>
            It's on a travel sticker
          </Button>
        ) : null}
        {state !== 'expired' ? (
          <Button variant="ghost" block onClick={onUsedElsewhere} disabled={busy}>
            {partly ? 'Rest used without a bottle' : 'Used without a bottle'}
          </Button>
        ) : null}
      </div>
      {state !== 'expired' ? (
        <Button variant="danger" block onClick={onDiscard} disabled={busy}>
          <TrashIcon className="btn-icon" /> Discard this milk
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Room-temperature milk shown as expired that really went in the fridge in time (the move was never made in
 * Bramble): say when, and it keeps its fridge days from the pump. A time after the room window ended is refused
 * here and on the server; that milk was out too long.
 */
function InTimeMove({ bag, now, at, onAt, busy, onMove }: { bag: MilkBag; now: Date; at: Date | null; onAt: (d: Date) => void; busy: boolean; onMove: (at: Date) => void }) {
  const deadline = parseDate(bag.expires_at)
  const pumped = parseDate(bag.pumped_at)
  const until = format(deadline, 'h:mm a')
  const late = at !== null && at.getTime() > deadline.getTime() + 60_000
  return (
    <section className="in-time-move stack" aria-label="Went in the fridge in time">
      <div>
        <p className="strong in-time-title">Went in the fridge in time?</p>
        <p className="small muted in-time-note">
          Out on the counter it kept until {until}. If it was in the fridge by then, say when and it keeps its fridge days.
        </p>
      </div>
      <TimeField label="In the fridge at" value={at} min={pumped} max={now} onChange={onAt} placeholder="Choose when" />
      {late ? (
        <p className="small text-health" role="alert">
          That is after {until}: it was out too long. Discard it.
        </p>
      ) : null}
      <Button variant="outline" block onClick={() => at && onMove(at)} disabled={busy || at === null || late}>
        Move to fridge
      </Button>
    </section>
  )
}

/**
 * A bag that has left the stash, opened by its code (a scan of a used bottle's label): what became of it and
 * Undo, as in the history list. No bottle, move or discard: there is nothing in the stash to act on.
 */
function GoneBag({ bag, unit, now, busy, error, onUndo, onReprint }: { bag: MilkBag; unit: 'oz' | 'ml'; now: Date; busy: boolean; error: string | null; onUndo: () => void; onReprint: () => void }) {
  return (
    <div className="stack">
      <div className="bag-head">
        <p className="strong bag-head-vol">{bagVolume(bag, unit)}</p>
        <p className="small text-health strong" role="status">
          {historyLine(bag, unit)}
          {bag.used_at ? ` ${formatAgo(bag.used_at, now)} · ${format(parseDate(bag.used_at), 'EEE MMM d, h:mm a')}` : ''} · not in the stash
        </p>
        <p className="small muted">
          Pumped {format(parseDate(bag.pumped_at), 'EEE MMM d, h:mm a')} · {LOCATION_LABEL[bag.location]}
          {bag.thawed ? ', thawed' : ''}
        </p>
      </div>
      {bag.uses.length ? (
        <ul className="bag-uses" aria-label="What came out of this bag">
          {bag.uses.map((u) => (
            <li key={u.id}>
              <span>{describeUse(u, unit)}</span>
              <span className="xs muted">{format(parseDate(u.at), 'EEE MMM d, h:mm a')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="log-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="secondary" size="lg" block onClick={onUndo} loading={busy}>
        Undo · put it back in the stash
      </Button>
      {isNightBottle(bag) ? null : (
        <Button variant="ghost" block onClick={onReprint} disabled={busy}>
          Reprint label
        </Button>
      )}
    </div>
  )
}

/**
 * A premade bottle in its spot: what is in it and from which bags, how long it keeps (its oldest milk's fridge
 * time), Feed it (the bottle sheet, the whole bottle taken), throw it out, or undo it (not really made, or made
 * from the wrong bags: the milk goes back on the bags it came from, after one confirm). No moves, labels or
 * partial pours: the spot sticker is its label, and a bottle a baby fed from is finished.
 */
function BottleActions({ bag, unit, now, busy, error, onBottle, onDiscard, onUnmake }: { bag: MilkBag; unit: 'oz' | 'ml'; now: Date; busy: boolean; error: string | null; onBottle: () => void; onDiscard: () => void; onUnmake: () => void }) {
  const state = bagState(bag, now)
  const [confirming, setConfirming] = useState(false)
  // The bottle's note lists its pours ("From 10 mL of bag X, 12 mL of bag Y"): one per bag.
  const sources = (bag.notes?.match(/ of bag /g) ?? []).length
  return (
    <div className="stack" data-testid="bottle-actions">
      <div className="bag-head">
        <p className="strong bag-head-vol">{formatMl(bag.remaining_ml, unit)}</p>
        <p className={`small ${state === 'expired' ? 'text-health' : state === 'soon' ? 'text-pumping' : 'muted'}`}>
          In spot {bag.spot} in the fridge · {state === 'expired' ? `expired ${formatAgo(bag.expires_at, now)}` : `good until ${format(parseDate(bag.expires_at), 'EEE MMM d, h:mm a')}`}
          {bag.thawed ? ' · has thawed milk' : ''}
        </p>
        <p className="xs muted">
          Oldest milk pumped {format(parseDate(bag.pumped_at), 'EEE MMM d, h:mm a')}
          {bag.notes ? ` · ${bag.notes}` : ''}
        </p>
      </div>
      {error ? (
        <p className="log-error" role="alert">
          {error}
        </p>
      ) : null}
      {state !== 'expired' ? (
        <Button size="lg" block onClick={onBottle} disabled={busy}>
          Feed this bottle
        </Button>
      ) : null}
      <Button variant="danger" block onClick={onDiscard} loading={busy}>
        <TrashIcon className="btn-icon" /> {state === 'expired' ? 'Discard expired bottle' : 'Discard this bottle'}
      </Button>
      {state !== 'expired' ? <p className="xs muted">Feed it and the whole bottle leaves the stash: she drinks what she drinks and the rest is thrown away. Its spot is free again.</p> : null}
      {confirming ? (
        <div className="stack unmake-confirm" data-testid="unmake-confirm">
          <p className="small">
            Put the {formatMl(bag.remaining_ml, unit)} back on {sources === 1 ? 'its bag' : sources > 1 ? `its ${sources} bags` : 'the bags it came from'} and free spot {bag.spot}?
          </p>
          <div className="row gap">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Keep the bottle
            </Button>
            <Button onClick={onUnmake} loading={busy}>
              Put it back
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" block onClick={() => setConfirming(true)} disabled={busy}>
          Undo this bottle
        </Button>
      )}
    </div>
  )
}
