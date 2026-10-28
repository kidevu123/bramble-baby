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
import { volumeLabel, type VolumeUnit } from '../../lib/units'
import { FORTIFIED_KEEP_HOURS, recipeFor, recipeText, strengthText, type FortifySettings } from '../../lib/fortify'
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
    keys.current = new Map()
    // Opening the sheet sets it up once; the stash ticking under it must not reset what was typed.
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const sources = all.filter((b) => !left.has(b.id))
  const sizeMl = toMl(Number(sizeText) || 0, unit)
  const plan = sizeMl > 0 ? planNightBottles(sources, sizeMl, count, spots) : []
  const holds = sources.reduce((s, b) => s + b.remaining_ml, 0)
  /** Mixed now when fortified: what to add to each bottle, and the day it keeps from now. */
  const mix = fortified === 'fortified' && fortify ? fortify : null
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
        bottles: plan.map((p) => {
          if (!keys.current.has(p.spot)) keys.current.set(p.spot, newClientKey())
          const base = { spot: p.spot, client_key: keys.current.get(p.spot)!, takes: p.takes.map((t) => ({ bag: t.bag.id, amount_ml: t.ml })) }
          if (!mix) return base
          const r = recipeFor(p.ml, mix)
          return { ...base, kcal_per_oz: mix.kcalPerOz, added_ml: Math.max(0, Math.round((r.ml - p.ml) * 10) / 10) }
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
          {plan.length ? (
            <ul className="night-plan" aria-label="The bottles" data-testid="night-plan">
              {plan.map((p) => (
                <li key={p.spot} className="night-plan-row">
                  <span className="spot-badge" aria-hidden>
                    {p.spot}
                  </span>
                  <span className="grow night-plan-main">
                    <span className="strong">
                      Spot {p.spot} · {formatMl(p.ml, unit)}
                      {p.short ? <span className="text-pumping"> · the milk runs out here</span> : null}
                    </span>
                    <span className="xs muted">
                      {p.takes.map((t) => `${formatMl(t.ml, unit)} ${t.bag.code}`).join(' + ')} · good until {bagStamp(goodUntil(p.takes), now, { today: '' })}
                    </span>
                    {mix ? <FortifyStep ml={p.ml} fortify={mix} /> : null}
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
            <ul className="night-sources">
              {all.map((b) => {
                const out = left.has(b.id)
                const used = plan.flatMap((p) => p.takes).filter((t) => t.bag.id === b.id).reduce((s, t) => s + t.ml, 0)
                return (
                  <li key={b.id}>
                    <button type="button" className={`night-source${out ? ' is-out' : ''}`} aria-pressed={!out} onClick={() => toggle(b.id)} aria-label={`Bag ${b.code}, ${formatMl(b.remaining_ml, unit)}${out ? ', left out' : ''}`}>
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
          </FieldGroup>
          {frozen ? <p className="xs muted">Frozen milk is not used: thaw a bag in the fridge first.</p> : null}
          <p className="xs muted">
            {mix
              ? `Fortified bottles keep ${FORTIFIED_KEEP_HOURS} hours from now in the fridge (sooner if their milk runs out first) and are never frozen. Mix each one as shown before it goes in its spot.`
              : "Each bottle is good until its oldest milk's fridge time ends."}{' '}
            At night, open Bottle and tap its spot; she drinks what she drinks and the rest is thrown away.
          </p>
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

/** What to stir into one premade bottle, or that the bottle is too small to measure for. */
function FortifyStep({ ml, fortify }: { ml: number; fortify: FortifySettings }) {
  const r = recipeFor(ml, fortify)
  return (
    <span className={r.tooSmall ? 'xs text-pumping' : 'xs night-plan-mix'}>
      {r.tooSmall ? `Too little milk to measure ${strengthText(fortify.kcalPerOz)} for; make it bigger or mix a batch.` : `Add ${recipeText(r)} → ${strengthText(r.kcalPerOz)}`}
    </span>
  )
}
