import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FieldGroup } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { Sheet } from '../../components/ui/Sheet'
import { useInvalidateMilk, useMilkWindows } from '../../hooks/useMilk'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag } from '../../lib/api/companion'
import type { Id } from '../../lib/api/types'
import { batchFor, FORTIFIED_KEEP_HOURS, type FortifySettings } from '../../lib/fortify'
import { bagStamp, expectedExpiry, formatMl, newClientKey, nightBottleSources, planBatch, toMl } from '../../lib/milk'
import { parseDate } from '../../lib/time'
import { convertVolume, volumeLabel, type VolumeUnit } from '../../lib/units'
import { ValueField } from '../log/LogFields'
import { BatchSteps, SourceList } from './NightBottlesSheet'
import { RecipeFold } from './Recipe'
import './milk.css'

/**
 * A batch mixed ahead: milk from the fridge bags poured into ONE container (the milk that has to go first going
 * first), the formula measured once, and the container kept cold. Nothing is split into bottles: each feed pours what
 * she wants from it (the bottle sheet offers the batch), and the rest stays. The milk leaves the bags when the batch
 * is made. Fortified, it keeps 24 hours from now; what is left after that is thrown away, so the sheet starts on about
 * a day of bottles and says so when the batch is bigger than that.
 */
export function BatchSheet({ open, child, name, bags, unit, now, dayMl, fortify = null, onClose }: { open: boolean; child: Id; /** The child's first name, for the day's-worth line. */ name: string; bags: MilkBag[]; unit: VolumeUnit; now: Date; /** What she takes by bottle in a day, mL (the stash runway's figure); null when not known. */ dayMl: number | null; /** The household's fortification (Settings › Calories & fortifying): offered, and on by default. */ fortify?: FortifySettings | null; onClose: () => void }) {
  const invalidate = useInvalidateMilk()
  const windows = useMilkWindows()
  const all = useMemo(() => nightBottleSources(bags, now), [bags, now])
  const frozen = bags.some((b) => b.status === 'stored' && b.location === 'freezer')
  const [milkText, setMilkText] = useState('')
  const [left, setLeft] = useState<Set<Id>>(() => new Set())
  const [fortified, setFortified] = useState<'plain' | 'fortified'>('plain')
  // One key for this sitting: a retry (a dropped answer, a second tap) returns the batch already made.
  const key = useRef<string | null>(null)
  /** A volume in the phone's unit, never rounded up past what there is. */
  const shown = (ml: number) => String(unit === 'oz' ? Math.floor(convertVolume(ml, 'ml', 'oz') * 10) / 10 : Math.floor(ml))
  useEffect(() => {
    if (!open) return
    const holds = all.reduce((s, b) => s + b.remaining_ml, 0)
    // About a day of bottles when that is known, since a fortified batch keeps a day; never more than the bags hold.
    setMilkText(shown(dayMl && dayMl > 0 ? Math.min(holds, dayMl) : holds))
    setLeft(new Set())
    setFortified(fortify ? 'fortified' : 'plain')
    key.current = null
    // Opening the sheet sets it up once; the stash ticking under it must not reset what was typed.
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const sources = all.filter((b) => !left.has(b.id))
  const holds = sources.reduce((s, b) => s + b.remaining_ml, 0)
  const milkMl = toMl(Number(milkText) || 0, unit)
  const plan = planBatch(sources, milkMl)
  const mix = fortified === 'fortified' && fortify ? fortify : null
  const batch = mix && plan.ml > 0 ? batchFor([plan.ml], mix) : null
  const tooSmall = Boolean(batch?.recipe.tooSmall)
  const goodUntil = () => {
    const pumped = Math.min(...plan.takes.map((t) => parseDate(t.bag.pumped_at).getTime()))
    const thawed = plan.takes.filter((t) => t.bag.thawed && t.bag.thawed_at).map((t) => parseDate(t.bag.thawed_at!).getTime())
    const milk = expectedExpiry({ pumpedAt: new Date(pumped), location: 'fridge', thawedAt: thawed.length ? new Date(Math.min(...thawed)) : null }, windows)
    return mix ? new Date(Math.min(milk.getTime(), now.getTime() + FORTIFIED_KEEP_HOURS * 3_600_000)) : milk
  }
  /** Bigger than she drinks while it keeps: the rest would be poured away. */
  const overADay = mix !== null && dayMl !== null && dayMl > 0 && plan.ml > dayMl * 1.15

  const make = useMutation({
    mutationFn: () => {
      key.current ??= newClientKey()
      const base = { child, windows, client_key: key.current, takes: plan.takes.map((t) => ({ bag: t.bag.id, amount_ml: t.ml })) }
      // What the formula adds to the container: in the batch, not from a bag.
      return companion.milk.makeBatch(mix && batch ? { ...base, kcal_per_oz: mix.kcalPerOz, added_ml: Math.max(0, Math.round((batch.ml - plan.ml) * 10) / 10) } : base)
    },
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
      title="Make a batch"
      onClose={onClose}
      footer={
        <Button size="lg" block onClick={() => make.mutate()} loading={make.isPending} disabled={!plan.takes.length || tooSmall}>
          {plan.takes.length ? `Make the batch · ${formatMl(batch ? batch.ml : plan.ml, unit)}` : 'Make the batch'}
        </Button>
      }
    >
      {all.length === 0 ? (
        <p className="small muted">No milk in the fridge to pour from. {frozen ? 'Thaw a bag in the fridge first; frozen milk is not used.' : 'Add milk to the stash first.'}</p>
      ) : (
        <>
          <div className="night-size is-batch">
            <ValueField label="Milk in the batch" unit={volumeLabel(unit)} name={`Milk in the batch in ${volumeLabel(unit)}`} type="number" inputMode="decimal" min={0} step={unit === 'oz' ? 0.5 : 10} value={milkText} onChange={(e) => setMilkText(e.target.value)} />
          </div>
          {fortify ? (
            <FieldGroup title="Fortify">
              <Segmented
                label="Fortify the batch"
                options={[
                  { value: 'fortified', label: `Fortified · ${fortify.kcalPerOz}` },
                  { value: 'plain', label: 'Plain milk' },
                ]}
                value={fortified}
                onChange={setFortified}
              />
            </FieldGroup>
          ) : null}
          {plan.short && plan.takes.length ? (
            <p className="small text-pumping" role="status" data-testid="batch-short">
              The bags hold {formatMl(holds, unit)}, so that is the batch.
            </p>
          ) : null}
          {batch ? (
            <BatchSteps keep batch={batch} fortify={mix!} unit={unit} sizeMl={plan.ml} onSize={(ml) => setMilkText(String(unit === 'oz' ? Math.round(convertVolume(ml, 'ml', 'oz') * 10) / 10 : Math.round(ml)))} />
          ) : plan.takes.length ? (
            <p className="small" data-testid="batch-plain">
              Pour {formatMl(plan.ml, unit)} into one container and keep it cold. Each bottle is poured from it.
            </p>
          ) : (
            <p className="small text-health" role="alert">
              {milkMl > 0 ? 'The bags left in hold no milk.' : 'Enter how much milk goes in the batch.'}
            </p>
          )}
          {plan.takes.length ? (
            <p className="small" data-testid="batch-until">
              Good until {bagStamp(goodUntil(), now)}.
            </p>
          ) : null}
          {overADay ? (
            <p className="small text-pumping" role="status" data-testid="batch-over">
              That is more than {name} takes by bottle in a day (about {formatMl(dayMl!, unit)}). A fortified batch keeps {FORTIFIED_KEEP_HOURS} hours; what is left after that is thrown away.
            </p>
          ) : null}
          <FieldGroup title="Poured from" hint="Soonest to expire first. Tap a bag to leave it out.">
            <SourceList all={all} left={left} takes={plan.takes} unit={unit} now={now} onToggle={toggle} />
          </FieldGroup>
          {frozen ? <p className="xs muted">Frozen milk is not used: thaw a bag in the fridge first.</p> : null}
          <p className="xs muted">
            {mix
              ? `A fortified batch keeps ${FORTIFIED_KEEP_HOURS} hours from now (sooner if its milk runs out first) and is never frozen.`
              : "A plain batch is good until its oldest milk's fridge time ends."}{' '}
            When she is hungry, open Bottle, tap the batch and set what she drank: only that comes out of it. Pour into a clean bottle each time; what she leaves in the bottle is thrown away, never poured back.
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
