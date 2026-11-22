import { About } from '../../components/ui/About'
import { FORTIFIED_KEEP_HOURS, gramsText, levelScoops, powderOf, recipeFor, scoopMilkMl, spoonDrift, strengthText, type FortifySettings } from '../../lib/fortify'
import { formatMl } from '../../lib/milk'
import { convertVolume, formatVolume, type VolumeUnit } from '../../lib/units'
import './milk.css'

const AMOUNTS: Record<VolumeUnit, number[]> = { oz: [2, 3, 4, 5, 6, 8], ml: [60, 90, 120, 150, 180, 240] }

/**
 * The fortify recipe as a reference, folded at the bottom of the sheets where milk is mixed (Make premade bottles,
 * a fortified bottle): one row closed, the chart and how to mix it when opened. The sheet's own lines already say
 * what to add for the amount in hand; this is for checking another amount.
 */
export function RecipeFold({ fortify, unit }: { fortify: FortifySettings; unit: VolumeUnit }) {
  const powder = powderOf(fortify)
  const brand = fortify.with === 'concentrate' ? 'liquid concentrate' : powder.id === 'standard' || powder.id === 'custom' ? 'formula' : powder.name
  return (
    <About label={`Recipe chart · ${strengthText(fortify.kcalPerOz)} with ${brand}`} testId="recipe-fold">
      <RecipeChart fortify={fortify} unit={unit} />
      <p>
        Wash your hands and the top of the can. Warm the milk to room temperature (powder clumps in cold milk), measure it in a clear cup at eye level, add the powder and shake gently.
        {fortify.with === 'powder' && powder.gPerTbsp !== null ? ' Spoons are level and unpacked.' : ''}
      </p>
      {fortify.with === 'powder' && powder.mixNote ? <p>{powder.mixNote}</p> : null}
      <p>A kitchen scale that reads 0.1 g is more exact than spoons (Bobbie advises weighing its powder): set the cup on it, zero it, and add the grams shown. With scoops, use only the scoop from the can, level and unpacked.</p>
      <p>Mixing several bottles as one batch and then pouring them is one measure instead of several small ones, so it is easier to get right.</p>
      <p>Keep it in the fridge and throw it away {FORTIFIED_KEEP_HOURS} hours after mixing; throw away what is left in a bottle after a feed. Do not freeze it, and warm it in water, never the microwave.</p>
      <p>Never mix it stronger than the doctor asked. Breast milk is counted at 20 kcal/oz, as hospital charts do; the strength is set in Settings › Calories &amp; fortifying.</p>
    </About>
  )
}

/** The recipe for six common amounts, like a hospital's chart: grams for a scale (exact) and level spoons (rounded),
 *  or mL of concentrate. Shown in `RecipeFold` and in Settings › Calories & fortifying. */
export function RecipeChart({ fortify, unit }: { fortify: FortifySettings; unit: VolumeUnit }) {
  const rows = AMOUNTS[unit].map((a) => ({ a, r: recipeFor(convertVolume(a, unit, 'ml'), fortify) }))
  const powder = fortify.with !== 'concentrate'
  /** The maker publishes a spoon weight: a spoons column beside the scale. Without one, the scale and whole scoops only. */
  const spoons = powder && powderOf(fortify).gPerTbsp !== null
  const scoopMl = powder && !spoons ? scoopMilkMl(fortify) : null
  const drift = spoonDrift(rows.map((x) => x.r), fortify.kcalPerOz)
  return (
    <>
      <table className="fortify-table" aria-label="Recipe for common amounts">
        <thead>
          <tr>
            <th scope="col">Breast milk</th>
            {powder ? (
              <>
                <th scope="col">{spoons ? 'Scale' : 'On a scale'}</th>
                {spoons ? <th scope="col">or level spoons</th> : null}
              </>
            ) : (
              <th scope="col">Concentrate</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, r }) => (
            <tr key={a}>
              <td>{formatVolume(a, unit)}</td>
              {r.tooSmall ? (
                <td colSpan={spoons ? 2 : 1}>
                  <span className="muted">too little to measure</span>
                </td>
              ) : r.with === 'concentrate' ? (
                <td>{r.addMl} mL</td>
              ) : (
                <>
                  <td>
                    {gramsText(r.scaleGrams)}
                    {!spoons && r.scoops ? ` · ${levelScoops(r.scoops)}` : ''}
                  </td>
                  {spoons ? (
                    <td>
                      {r.spoons}
                      {r.scoops ? ` · ${r.scoops}` : ''}
                    </td>
                  ) : null}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {powder && !spoons ? (
        <p className="xs muted fortify-note" data-testid="scale-note">
          {powderOf(fortify).id === 'custom' ? 'This formula' : powderOf(fortify).name} has no published weight for a teaspoon, so Bramble gives grams for a scale and never guesses spoons.
          {scoopMl ? ` With no scale: 1 level scoop from the can is right for ${formatMl(scoopMl, unit)} of milk.` : ''}
        </p>
      ) : powder ? (
        <p className="xs muted fortify-note" data-testid="spoon-note">
          The scale is exact. Spoons are rounded to the nearest level ⅛ teaspoon, so they do not grow in a straight line with the milk; each one lands within{' '}
          {Math.max(0.1, Math.ceil(drift * 10) / 10)} kcal/oz of {fortify.kcalPerOz}.
        </p>
      ) : null}
    </>
  )
}
