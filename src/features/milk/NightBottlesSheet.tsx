import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FieldGroup, PillChoice } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { Sheet } from '../../components/ui/Sheet'
import { useInvalidateMilk, useMilkWindows } from '../../hooks/useMilk'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag } from '../../lib/api/companion'
import type { Id } from '../../lib/api/types'
import { bagStamp, expectedExpiry, formatMl, freeSpots, newClientKey, NIGHT_SPOTS, nightBottleSources, planNightBottles, toMl } from '../../lib/milk'
import { parseDate } from '../../lib/time'
import { convertVolume, volumeLabel, type VolumeUnit } from '../../lib/units'
import { RecipeFold } from './Recipe'
import { batchFor, FORTIFIED_KEEP_HOURS, gramsText, levelScoops, powderOf, recipeFor, recipeText, scoopFit, strengthText, type Batch, type FortifySettings } from '../../lib/fortify'
import { ValueField } from '../log/LogFields'
import './milk.css'

/**
 * Premade bottles made ahead (before bed): pick a size and how many, and Bramble pours them from the fridge bags,
 * the milk that has to go first going first, into the free numbered spots (the stickers 1–5 in the fridge). The
 * milk leaves the bags when they are made; at night, the bottle sheet offers the spots and a feed takes the whole
 * bottle. Bags can be left out with a tap; frozen milk is never used (thaw it in the fridge first).
 */
export function NightBottlesSheet({ open, child, bags, unit, now, typical, fortify = null, onClose }: { open: boolean; child: Id; bags: MilkBag[]; unit: VolumeUnit; now: Date; /** A usual bottle in the phone unit (recent breast-milk bottles), for the size field. */ typical: number | null; /** The household's fortification (Settings › Calories & fortifying): offered, and on by default. */ fortify?: FortifySettings | null; onClose: () => void }) {
  const invalidate = useInvalidateMilk()
  const windows = useMilkWindows()
  const spots = useMemo(() => freeSpots(bags), [bags])
  const all = useMemo(() => nightBottleSources(bags, now), [bags, now])
  const frozen = bags.some((b) => b.status === 'stored' && b.location === 'freezer')
  const [sizeText, setSizeText] = useState('')
  const [count, setCount] = useState(1)
  const [left, setLeft] = useState<Set<Id>>(() => new Set())
  const [fortified, setFortified] = useState<'plain' | 'fortified'>('plain')
  // Fortified bottles are mixed as one batch unless told otherwise: all the milk in one container, the formula measured
  // once, then poured into the bottles. One larger measure is easier to get right than five small ones.
  const [how, setHow] = useState<'together' | 'each'>('together')
  // One key per spot for this sitting: a retry (a dropped answer, a second tap) returns the bottles already made.
  const keys = useRef<Map<number, string>>(new Map())
  useEffect(() => {
    if (!open) return
    const size = typical && typical > 0 ? typical : unit === 'oz' ? 2 : 60
    setSizeText(String(size))
    const total = all.reduce((s, b) => s + b.remaining_ml, 0)
    setCount(Math.max(1, Math.min(spots.length, Math.floor(total / Math.max(1, toMl(size, unit))) || 1)))
    setLeft(new Set())
    setFortified(fortify ? 'fortified' : 'plain')
    setHow('together')
    keys.current = new Map()
    // Opening the sheet sets it up once; the stash ticking under it must not reset what was typed.
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const sources = all.filter((b) => !left.has(b.id))
  const sizeMl = toMl(Number(sizeText) || 0, unit)
  const plan = sizeMl > 0 ? planNightBottles(sources, sizeMl, count, spots) : []
  const holds = sources.reduce((s, b) => s + b.remaining_ml, 0)
  /** Mixed now when fortified: what to add to each bottle, and the day it keeps from now. */
  const mix = fortified === 'fortified' && fortify ? fortify : null
  const batch = mix && plan.length > 1 && how === 'together' ? batchFor(plan.map((p) => p.ml), mix) : null
  const goodUntil = (takes: { bag: MilkBag }[]) => {
    const pumped = Math.min(...takes.map((t) => parseDate(t.bag.pumped_at).getTime()))
    const thawed = takes.filter((t) => t.bag.thawed && t.bag.thawed_at).map((t) => parseDate(t.bag.thawed_at!).getTime())
    const milk = expectedExpiry({ pumpedAt: new Date(pumped), location: 'fridge', thawedAt: thawed.length ? new Date(Math.min(...thawed)) : null }, windows)
    return mix ? new Date(Math.min(milk.getTime(), now.getTime() + FORTIFIED_KEEP_HOURS * 3_600_000)) : milk
  }

  const make = useMutation({
    mutationFn: () =>
      companion.milk.makeBottles({
        child,
        windows,
        bottles: plan.map((p, i) => {
          if (!keys.current.has(p.spot)) keys.current.set(p.spot, newClientKey())
          const base = { spot: p.spot, client_key: keys.current.get(p.spot)!, takes: p.takes.map((t) => ({ bag: t.bag.id, amount_ml: t.ml })) }
          if (!mix) return base
          // What the formula adds to this bottle: its share of the batch, or its own measure when mixed one by one.
          const holds = batch ? batch.pours[i] : recipeFor(p.ml, mix).ml
          return { ...base, kcal_per_oz: mix.kcalPerOz, added_ml: Math.max(0, Math.round((holds - p.ml) * 10) / 10) }
        }),
      }),
    onSuccess: () => {
      invalidate(child)
      onClose()
    },
  })
  const { reset } = make
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const toggle = (id: Id) =>
    setLeft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Sheet
      open={open}
      title="Make premade bottles"
      onClose={onClose}
      footer={
        <Button size="lg" block onClick={() => make.mutate()} loading={make.isPending} disabled={!plan.length}>
          {plan.length ? `Make ${plan.length} bottle${plan.length === 1 ? '' : 's'}` : 'Make bottles'}
        </Button>
      }
    >
      {spots.length === 0 ? (
        <p className="small muted">All {NIGHT_SPOTS} spots have a bottle. Feed or discard one to free its spot.</p>
      ) : all.length === 0 ? (
        <p className="small muted">No milk in the fridge to pour from. {frozen ? 'Thaw a bag in the fridge first; frozen milk is not used.' : 'Add milk to the stash first.'}</p>
      ) : (
        <>
          <div className="night-size">
            <ValueField label="Each bottle" unit={volumeLabel(unit)} name={`Each bottle in ${volumeLabel(unit)}`} type="number" inputMode="decimal" min={0} step={unit === 'oz' ? 0.5 : 5} value={sizeText} onChange={(e) => setSizeText(e.target.value)} />
          </div>
          {fortify ? (
            <FieldGroup title="Fortify">
              <Segmented
                label="Fortify these bottles"
                options={[
                  { value: 'fortified', label: `Fortified · ${fortify.kcalPerOz}` },
                  { value: 'plain', label: 'Plain milk' },
                ]}
                value={fortified}
                onChange={setFortified}
              />
            </FieldGroup>
          ) : null}
          <FieldGroup title="How many">
            <PillChoice
              tone="purple"
              value={String(count)}
              onChange={(v) => setCount(Number(v))}
              options={spots.map((_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            />
          </FieldGroup>
          {mix && plan.length > 1 ? (
            <FieldGroup title="Mix">
              <Segmented
                label="How to mix them"
                options={[
                  { value: 'together', label: 'All together' },
                  { value: 'each', label: 'Bottle by bottle' },
                ]}
                value={how}
                onChange={setHow}
              />
            </FieldGroup>
          ) : null}
          {batch ? <BatchSteps batch={batch} fortify={mix!} unit={unit} sizeMl={sizeMl} onSize={(ml) => setSizeText(String(unit === 'oz' ? Math.round(convertVolume(ml, 'ml', 'oz') * 10) / 10 : Math.round(ml)))} /> : null}
          {plan.length ? (
            <ul className="night-plan" aria-label="The bottles" data-testid="night-plan">
              {plan.map((p) => (
                <li key={p.spot} className="night-plan-row">
                  <span className="spot-badge" aria-hidden>
                    {p.spot}
                  </span>
                  <span className="grow night-plan-main">
                    <span className="strong">
                      Spot {p.spot} · {formatMl(batch ? batch.pours[plan.indexOf(p)] : p.ml, unit)}
                      {p.short ? <span className="text-pumping"> · the milk runs out here</span> : null}
                    </span>
                    <span className="xs muted">
                      {p.takes.map((t) => `${formatMl(t.ml, unit)} ${t.bag.code}`).join(' + ')} · good until {bagStamp(goodUntil(p.takes), now, { today: '' })}
                    </span>
                    {mix && !batch ? <FortifyStep ml={p.ml} fortify={mix} /> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small text-health" role="alert">
              {sizeMl > 0 ? 'The bags left in hold no milk.' : 'Enter how much goes in each bottle.'}
            </p>
          )}
          {plan.length && plan.length < count ? (
            <p className="small muted" role="status">
              The bags hold {formatMl(holds, unit)}: enough for {plan.length} bottle{plan.length === 1 ? '' : 's'}.
            </p>
          ) : null}
          <FieldGroup title="Poured from" hint="Soonest to expire first. Tap a bag to leave it out.">
            <SourceList all={all} left={left} takes={plan.flatMap((p) => p.takes)} unit={unit} now={now} onToggle={toggle} />
          </FieldGroup>
          {frozen ? <p className="xs muted">Frozen milk is not used: thaw a bag in the fridge first.</p> : null}
          <p className="xs muted">
            {mix
              ? `Fortified bottles keep ${FORTIFIED_KEEP_HOURS} hours from now in the fridge (sooner if their milk runs out first) and are never frozen. ${batch ? 'Mix the batch as shown, then pour each bottle.' : 'Mix each one as shown before it goes in its spot.'}`
              : "Each bottle is good until its oldest milk's fridge time ends."}{' '}
            At night, open Bottle and tap its spot; she drinks what she drinks and the rest is thrown away.
          </p>
          {mix ? <RecipeFold fortify={mix} unit={unit} /> : null}
          {make.isError ? (
            <p className="log-error" role="alert">
              {describeApiError(make.error)}
            </p>
          ) : null}
        </>
      )}
    </Sheet>
  )
}

/** The bags the milk is poured from, soonest to expire first: each says what it gives, and a tap leaves it out. */
export function SourceList({ all, left, takes, unit, now, onToggle }: { all: MilkBag[]; left: Set<Id>; takes: { bag: MilkBag; ml: number }[]; unit: VolumeUnit; now: Date; onToggle: (id: Id) => void }) {
  return (
    <ul className="night-sources">
      {all.map((b) => {
        const out = left.has(b.id)
        const used = takes.filter((t) => t.bag.id === b.id).reduce((s, t) => s + t.ml, 0)
        return (
          <li key={b.id}>
            <button type="button" className={`night-source${out ? ' is-out' : ''}`} aria-pressed={!out} onClick={() => onToggle(b.id)} aria-label={`Bag ${b.code}, ${formatMl(b.remaining_ml, unit)}${out ? ', left out' : ''}`}>
              <span className="strong">{b.code}</span>
              <span className="grow small muted">
                {formatMl(b.remaining_ml, unit)} · good until {bagStamp(parseDate(b.expires_at), now, { today: '' })}
              </span>
              <span className="xs night-source-use">{out ? 'left out' : used > 0 ? (used >= b.remaining_ml - 0.5 ? 'all of it' : `${formatMl(used, unit)}`) : 'not needed'}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Several fortified bottles mixed as one batch: four numbered steps with the two numbers that matter large (all the
 * milk, the formula), then what to pour into each bottle. Nothing to work out: read the step, do the step.
 * With `keep` the batch is not split: it stays in its one container and each bottle is poured from it when needed.
 */
export function BatchSteps({ batch, fortify, unit, sizeMl, onSize, keep = false }: { batch: Batch; fortify: FortifySettings; unit: VolumeUnit; /** What each bottle is set to (the batch's milk, when kept whole), and how to set it: a family with no scale can make the batch fit the can's scoop. */ sizeMl: number; onSize: (ml: number) => void; /** The batch stays in one container (Stash › Make a batch). */ keep?: boolean }) {
  const r = batch.recipe
  const powder = fortify.with === 'powder' ? powderOf(fortify) : null
  const name = r.with === 'powder' ? (r.powderName === 'powder' ? 'formula powder' : r.powderName) : 'liquid concentrate'
  const pours = batch.pours.map((p) => formatMl(p, unit))
  const same = pours.every((p) => p === pours[0])
  // No published spoon weight and no whole scoop fits: the bottle size at which the batch is exactly whole level scoops,
  // one tap away, for a family with no scale.
  const fit = r.with === 'powder' && r.spoons === null && !r.scoops ? scoopFit(sizeMl, batch.pours.length, fortify) : null
  if (r.tooSmall) {
    return (
      <p className="small text-pumping" role="status">
        Too little milk to measure {strengthText(fortify.kcalPerOz)} for. {keep ? 'Make the batch bigger.' : 'Make the bottles bigger.'}
      </p>
    )
  }
  return (
    <ol className="batch-steps" aria-label={keep ? 'Mix the batch' : 'Mix them as one batch'} data-testid="batch-steps">
      <li className="batch-step">
        <span className="batch-n" aria-hidden>1</span>
        <span className="batch-main">
          <span className="batch-do">Pour all the milk into one container</span>
          <span className="batch-big" data-testid="batch-milk">{formatMl(batch.milkMl, unit)}</span>
        </span>
      </li>
      <li className="batch-step">
        <span className="batch-n" aria-hidden>2</span>
        <span className="batch-main">
          <span className="batch-do">Add the {name}</span>
          <span className="batch-big" data-testid="batch-add">{r.with === 'concentrate' ? `${r.addMl} mL` : r.spoons === null ? gramsText(r.scaleGrams) : r.spoons}</span>
          <span className="small muted" data-testid="batch-add-note">
            {r.with === 'concentrate'
              ? 'Measured in a syringe or a marked cup.'
              : r.spoons === null
                ? `On a kitchen scale${r.scoops ? `, or ${levelScoops(r.scoops)} from the can` : ''}.`
                : `Level and unpacked${r.scoops ? ` (${r.scoops})` : ''}, or ${gramsText(r.scaleGrams)} on a scale.`}
          </span>
          {fit ? (
            <span className="batch-fit">
              <span className="small" data-testid="batch-fit">
                {keep
                  ? `No scale? ${formatMl(fit.sizeMl, unit)} of milk takes exactly ${fit.scoops} level scoop${fit.scoops === 1 ? '' : 's'} from the can.`
                  : `No scale? ${batch.pours.length} bottles of ${formatMl(fit.sizeMl, unit)} take exactly ${fit.scoops} level scoop${fit.scoops === 1 ? '' : 's'} from the can.`}
              </span>
              <button type="button" className="link-btn" onClick={() => onSize(fit.sizeMl)}>
                {keep ? 'Make it' : 'Make them'} {formatMl(fit.sizeMl, unit)}
              </button>
            </span>
          ) : null}
        </span>
      </li>
      <li className="batch-step">
        <span className="batch-n" aria-hidden>3</span>
        <span className="batch-main">
          <span className="batch-do">{powder?.mixNote ?? 'Shake or swirl until nothing is left on the bottom.'}</span>
        </span>
      </li>
      <li className="batch-step">
        <span className="batch-n" aria-hidden>4</span>
        <span className="batch-main">
          {keep ? (
            <>
              <span className="batch-do">Keep it cold, and pour each bottle from it. It comes to</span>
              <span className="batch-big" data-testid="batch-holds">{formatMl(batch.ml, unit)}</span>
            </>
          ) : (
            <>
              <span className="batch-do">{same ? `Pour into each of the ${pours.length} bottles` : 'Pour each bottle to the amount beside its spot'}</span>
              {same ? <span className="batch-big" data-testid="batch-pour">{pours[0]}</span> : null}
            </>
          )}
        </span>
      </li>
    </ol>
  )
}

/** What to stir into one premade bottle, or that the bottle is too small to measure for. */
function FortifyStep({ ml, fortify }: { ml: number; fortify: FortifySettings }) {
  const r = recipeFor(ml, fortify)
  return (
    <span className={r.tooSmall ? 'xs text-pumping' : 'xs night-plan-mix'}>
      {r.tooSmall ? `Too little milk to measure ${strengthText(fortify.kcalPerOz)} for; make it bigger or mix a batch.` : `Add ${recipeText(r)}`}
    </span>
  )
}
