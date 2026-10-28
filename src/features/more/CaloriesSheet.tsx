import { format } from 'date-fns'
import { useState } from 'react'
import { About } from '../../components/ui/About'
import { Button } from '../../components/ui/Button'
import { FieldGroup, PillChoice, TextField } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { usePrefs } from '../../hooks/usePrefs'
import { calorieTracking, TYPICAL_KCAL_PER_KG, type CalorieTracking } from '../../lib/calories'
import type { ChildSettings } from '../../lib/api/companion'
import { FORMULA_KCAL_PER_OZ, POWDERS, recipeFor, recipeText, STRENGTHS, strengthText, validStrength, type FortifySettings, type FortifyWith } from '../../lib/fortify'
import { convertVolume, formatVolume } from '../../lib/units'

/**
 * Settings › Calories & fortifying: the calories a day per kilogram the pediatrician asked for, and the household's
 * fortification (strength, formula or concentrate, which powder). Shared per child; the Stash tab shows the recipe,
 * log sheets mark fortified bottles with their strength, Reports › Feeding counts the calories.
 */
export function CaloriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { child } = useChildren()
  const { settings, update } = useChildSettings(child?.id ?? null)
  if (!child) return null
  return (
    <Sheet open={open} title="Calories & fortifying" onClose={onClose}>
      <CaloriesEditor
        name={child.first_name}
        tracking={calorieTracking(settings)}
        goal={settings.calorieGoal ?? null}
        fortify={settings.fortify ?? null}
        formulaKcal={settings.formulaKcalPerOz ?? FORMULA_KCAL_PER_OZ}
        onSave={(patch) => {
          update(patch)
          onClose()
        }}
      />
    </Sheet>
  )
}

const POWDER_OPTIONS = [...POWDERS.map((p) => ({ value: p.id, label: p.name })), { value: 'custom', label: 'From the can' }]
const FORMULA_OPTIONS = [FORMULA_KCAL_PER_OZ, ...STRENGTHS].map((s) => ({ value: String(s), label: s === FORMULA_KCAL_PER_OZ ? `${s} · as the can says` : String(s) }))

type CaloriesPatch = Pick<ChildSettings, 'caloriesOn' | 'calorieGoal' | 'fortify' | 'formulaKcalPerOz'>

function CaloriesEditor({ name, tracking, goal, fortify, formulaKcal, onSave }: { name: string; tracking: CalorieTracking | null; goal: number | null; fortify: FortifySettings | null; formulaKcal: number; onSave: (patch: CaloriesPatch) => void }) {
  const { prefs } = usePrefs()
  const unit = prefs.units.volume
  // Off keeps what was set (the goal, the recipe), so turning it back on brings it all back.
  const [tracked, setTracked] = useState<'off' | 'on'>(tracking ? 'on' : 'off')
  const [goalText, setGoalText] = useState(goal === null ? '' : String(goal))
  const [formula, setFormula] = useState(String(formulaKcal))
  const [on, setOn] = useState<'off' | 'on'>(fortify ? 'on' : 'off')
  const [strength, setStrength] = useState<string>(String(fortify?.kcalPerOz ?? 24))
  const [withWhat, setWithWhat] = useState<FortifyWith>(fortify?.with ?? 'powder')
  const [powder, setPowder] = useState(fortify?.powder ?? 'standard')
  const [scoopKcal, setScoopKcal] = useState(fortify?.custom ? String(fortify.custom.kcalPerScoop) : '')
  const [scoopG, setScoopG] = useState(fortify?.custom ? String(fortify.custom.gPerScoop) : '')
  const [since, setSince] = useState(fortify?.since ?? format(new Date(), 'yyyy-MM-dd'))
  const [touched, setTouched] = useState(false)
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setTouched(true)
    set(v)
  }

  const goalNum = goalText.trim() === '' ? null : Number(goalText)
  const goalProblem = goalNum !== null && !(goalNum >= 50 && goalNum <= 250) ? 'A calorie goal is between 50 and 250 kcal per kg a day.' : null
  const custom = powder === 'custom' ? { kcalPerScoop: Number(scoopKcal), gPerScoop: Number(scoopG) } : null
  const customProblem = custom && !(custom.kcalPerScoop > 0 && custom.gPerScoop > 0 && custom.kcalPerScoop / custom.gPerScoop >= 4 && custom.kcalPerScoop / custom.gPerScoop <= 6)
    ? 'Type the calories and grams in one level scoop from the can’s label (about 44 kcal in 8.7 g for most).'
    : null
  const draft: FortifySettings | null = on === 'on' ? { kcalPerOz: Number(strength), with: withWhat, powder, custom, since } : null
  const strengthProblem = draft && !validStrength(draft.kcalPerOz) ? 'Pick the strength the doctor gave.' : null
  const problem = tracked === 'off' ? null : goalProblem ?? (draft ? strengthProblem ?? (withWhat === 'powder' ? customProblem : null) : null)
  const sample = convertVolume(unit === 'oz' ? 4 : 120, unit, 'ml')
  const preview = draft && !problem ? recipeFor(sample, draft) : null
  const save = () => onSave(tracked === 'off' ? { caloriesOn: false } : { caloriesOn: true, calorieGoal: goalNum, fortify: draft, formulaKcalPerOz: Number(formula) })

  return (
    <div className="stack">
      <FieldGroup title="Track calories" hint={tracked === 'off' ? `Off: no calories anywhere in the app. Turn it on when the doctor watches how many calories ${name} gets, or asks you to fortify milk.` : undefined}>
        <Segmented label="Track calories" options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} value={tracked} onChange={touch(setTracked)} />
      </FieldGroup>
      {tracked === 'on' ? (
        <>
          <FieldGroup title="Calorie goal" hint={`What ${name}'s doctor asked for, in kcal per kg a day. Healthy babies under 6 months take about ${TYPICAL_KCAL_PER_KG[0]}–${TYPICAL_KCAL_PER_KG[1]}. Leave it empty if none was given.`}>
            <TextField label="kcal per kg a day" type="number" inputMode="numeric" min={50} max={250} value={goalText} placeholder="e.g. 120" onChange={(e) => touch(setGoalText)(e.target.value)} />
          </FieldGroup>
          <FieldGroup title="Formula is mixed to · kcal per oz" hint="20 is the can's own recipe (Bobbie and other standard formulas). Pick another only if the doctor gave you a stronger formula recipe; each formula bottle then keeps it.">
            <PillChoice tone="orange" value={formula} onChange={touch(setFormula)} options={FORMULA_OPTIONS} />
          </FieldGroup>
          <FieldGroup title="Fortified breast milk">
            <Segmented label="Fortifying" options={[{ value: 'off', label: 'Not fortifying' }, { value: 'on', label: 'Fortifying' }]} value={on} onChange={touch(setOn)} />
            {on === 'on' ? null : problem ? <p className="small text-health">{problem}</p> : null}
          </FieldGroup>
          {on === 'on' ? (
            <>
              <FieldGroup title="Strength · kcal per oz" hint="The number on the doctor's or the NICU's recipe.">
                <PillChoice tone="orange" value={strength} onChange={touch(setStrength)} options={STRENGTHS.map((s) => ({ value: String(s), label: String(s) }))} />
              </FieldGroup>
              <FieldGroup title="Mixed with">
                <Segmented label="Mixed with" options={[{ value: 'powder', label: 'Formula powder' }, { value: 'concentrate', label: 'Liquid concentrate' }]} value={withWhat} onChange={touch(setWithWhat)} />
                {withWhat === 'powder' ? (
                  <>
                    <PillChoice label="Powder" value={powder} onChange={touch(setPowder)} options={POWDER_OPTIONS} />
                    {powder === 'custom' ? (
                      <div className="row" style={{ gap: 8 }}>
                        <TextField label="kcal in a scoop" type="number" inputMode="decimal" value={scoopKcal} placeholder="44" onChange={(e) => touch(setScoopKcal)(e.target.value)} />
                        <TextField label="grams in a scoop" type="number" inputMode="decimal" value={scoopG} placeholder="8.7" onChange={(e) => touch(setScoopG)(e.target.value)} />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </FieldGroup>
              <TextField label="Started on" type="date" value={since} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => touch(setSince)(e.target.value)} />
              {preview ? (
                <p className="small" data-testid="fortify-preview">
                  {formatVolume(convertVolume(sample, 'ml', unit), unit)} of breast milk + <span className="strong">{recipeText(preview)}</span> makes about {strengthText(preview.kcalPerOz)}. The Stash tab has the recipe for any amount.
                </p>
              ) : null}
              {problem ? <p className="small text-health">{problem}</p> : null}
            </>
          ) : null}
        </>
      ) : null}
      <About label="About calories and fortifying">
        <p>
          <strong>Off</strong> by default: most babies never need calories counted. <strong>Calories</strong> are counted from bottles: breast milk and formula at 20
          kcal/oz (formula at the strength set above), fortified milk at the strength it was mixed to. Each bottle keeps its strength, so changing the recipe later does not
          rewrite the past. Nursing has no volume, so a day with nursing shows bottles only. Breast milk really varies
          (studies find averages of 18–20 kcal/oz, single samples from about 12 to 30), so the numbers are close, not exact; the weight checks show whether it is enough.
        </p>
        <p>
          <strong>The goal</strong> comes from the doctor. Healthy term babies under 6 months take about 100–120 kcal per kg a day; babies who need to catch up are often fed
          120–150. Bramble only compares against the doctor&apos;s number.
        </p>
        <p>
          <strong>The recipe</strong> works out the same mix as a hospital&apos;s home chart (formula powder stirred into breast milk; every row of one such chart comes out within
          about half a calorie of its strength). Use level, unpacked spoons; teaspoons differ by brand, so pick yours, or type the scoop from the can. Liquid concentrate (40
          kcal/oz) is the other way: one part to four of milk for 24 kcal/oz. It is sterile until opened; CDC advises liquid rather than powdered formula for babies under 2
          months, born early or with weak immunity, because powder is not sterile. Ask the care team which to use.
        </p>
        <p>
          <strong>Safety:</strong> never make it stronger than prescribed (too concentrated is hard on a baby&apos;s kidneys). Mix with clean hands and tools; warm milk mixes
          best. Keep fortified milk in the fridge and throw it away 24 hours after mixing, and throw away what is left in a bottle after a feed. Do not freeze it.
        </p>
      </About>
      <Button size="lg" block disabled={!touched || problem !== null} onClick={save}>
        Save
      </Button>
    </div>
  )
}
