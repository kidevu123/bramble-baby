import { useState } from 'react'
import { About } from '../../components/ui/About'
import { ValueField } from '../log/LogFields'
import { FORTIFIED_KEEP_HOURS, gramsText, powderOf, recipeFor, recipeText, smallestBatchOz, strengthText, type FortifySettings } from '../../lib/fortify'
import { convertVolume, formatVolume, volumeLabel, type VolumeUnit } from '../../lib/units'

const AMOUNTS: Record<VolumeUnit, number[]> = { oz: [2, 3, 4, 5, 6, 8], ml: [60, 90, 120, 150, 180, 240] }

/**
 * Stash tab, while the household fortifies (Settings › Calories & fortifying): what to stir into the milk you have.
 * Type the amount and the measure follows; the common amounts are listed under it like the hospital's chart.
 */
export function FortifyCard({ fortify, unit }: { fortify: FortifySettings; unit: VolumeUnit }) {
  const [amount, setAmount] = useState(String(AMOUNTS[unit][2]))
  const milkMl = convertVolume(Number(amount) || 0, unit, 'ml')
  const recipe = milkMl > 0 ? recipeFor(milkMl, fortify) : null
  const least = recipe?.tooSmall ? smallestBatchOz(fortify) : null
  const vol = (ml: number) => formatVolume(convertVolume(ml, 'ml', unit), unit)
  const powder = powderOf(fortify)
  const brand = powder.id === 'standard' || powder.id === 'custom' ? 'formula' : powder.name
  return (
    <section className="card card-pad stack fortify-card" data-testid="fortify-card" aria-label="Fortify recipe">
      <header className="row fortify-head">
        <h3 className="grow">Fortify to {strengthText(fortify.kcalPerOz)}</h3>
        <span className="xs muted">{fortify.with === 'concentrate' ? 'liquid concentrate' : `${brand} · level, unpacked`}</span>
      </header>
      <div className="row fortify-calc">
        <ValueField label="Milk" unit={volumeLabel(unit)} name={`Breast milk in ${volumeLabel(unit)}`} type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <p className="grow fortify-out" role="status" data-testid="fortify-out">
          {!recipe ? (
            'Type how much milk you are mixing.'
          ) : recipe.tooSmall ? (
            <>Too little to measure accurately{least ? <>: mix at least {formatVolume(convertVolume(least, 'oz', unit), unit)} at a time</> : null}.</>
          ) : (
            <>
              Add <span className="strong">{recipeText(recipe)}</span>
              <span className="xs muted fortify-sub">
                makes {vol(recipe.ml)} at about {strengthText(recipe.kcalPerOz)}
              </span>
            </>
          )}
        </p>
      </div>
      <RecipeChart fortify={fortify} unit={unit} />
      <About label="How to mix it">
        <p>Wash your hands and the top of the can. Warm the milk to room temperature (powder clumps in cold milk), measure it in a clear cup at eye level, add level, unpacked spoons and shake gently.</p>
        <p>A kitchen scale that reads 0.1 g is more exact than spoons (Bobbie advises weighing its powder): set the cup on it, zero it, and add the grams shown. With scoops, use only the scoop from the can.</p>
        <p>Keep it in the fridge and throw it away {FORTIFIED_KEEP_HOURS} hours after mixing; throw away what is left in a bottle after a feed. Do not freeze it, and warm it in water, never the microwave.</p>
        <p>Never mix it stronger than the doctor asked. The recipe counts breast milk at 20 kcal/oz, as hospital charts do; set the strength in Settings › Calories & fortifying.</p>
      </About>
    </section>
  )
}

/** The recipe for six common amounts, like a hospital's chart: spoons and grams (or mL of concentrate). Shown on the
 *  Stash tab's card and in Settings › Calories & fortifying. */
export function RecipeChart({ fortify, unit }: { fortify: FortifySettings; unit: VolumeUnit }) {
  return (
    <table className="fortify-table" aria-label="Recipe for common amounts">
      <thead>
        <tr>
          <th scope="col">Breast milk</th>
          <th scope="col">{fortify.with === 'concentrate' ? 'Concentrate' : 'Powder · or weigh it'}</th>
        </tr>
      </thead>
      <tbody>
        {AMOUNTS[unit].map((a) => {
          const r = recipeFor(convertVolume(a, unit, 'ml'), fortify)
          return (
            <tr key={a}>
              <td>{formatVolume(a, unit)}</td>
              <td>{r.tooSmall ? <span className="muted">too little to measure</span> : r.with === 'concentrate' ? `${r.addMl} mL` : `${r.spoons} · ${gramsText(r.scaleGrams)}${r.scoops ? ` · ${r.scoops}` : ''}`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
