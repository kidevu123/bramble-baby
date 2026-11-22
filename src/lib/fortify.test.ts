import { describe, expect, it } from 'vitest'
import { batchFor, scoopFit, concentrateMl, mixWithPowder, POWDERS, powderGrams, powderOf, recipeFor, recipeText, scoopMilkMl, smallestBatchOz, spoonDrift, spoonText, type FortifySettings } from './fortify'
import { convertVolume } from './units'

const oz = (n: number) => convertVolume(n, 'oz', 'ml')
const standard = POWDERS[0]
const tsp = standard.gPerTbsp! / 3

describe('fortifying with powder', () => {
  // A children's hospital's home chart (standard powder, level unpacked spoons): every row makes its strength.
  const chart: [number, number, number][] = [
    [22, oz(3), 0.5 * tsp],
    [22, oz(8), 1.5 * tsp],
    [22, oz(16), 3 * tsp],
    [22, oz(18), standard.gPerScoop],
    [24, oz(2), 0.75 * tsp],
    [24, oz(5), 2 * tsp],
    [24, oz(10), standard.gPerScoop],
    [24, oz(20), 2 * standard.gPerScoop],
    [26, 50, tsp],
    [26, oz(9), 6 * tsp],
    [28, 100, 3 * tsp],
    [28, oz(12), 10.5 * tsp],
  ]
  it.each(chart)('the chart row for %i kcal/oz lands within 0.6 of it', (target, milk, grams) => {
    expect(Math.abs(mixWithPowder(milk, grams, standard).kcalPerOz - target)).toBeLessThan(0.6)
  })

  it('works the grams out for any amount, and plain milk needs none', () => {
    expect(powderGrams(oz(4), 24, standard)).toBeCloseTo(3.58, 1)
    expect(powderGrams(oz(4), 20, standard)).toBe(0)
    expect(mixWithPowder(oz(4), powderGrams(oz(4), 24, standard), standard).kcalPerOz).toBeCloseTo(24, 5)
  })

  it('writes the measure in level spoons, and whole scoops when they fit', () => {
    expect(spoonText(1)).toBe('⅛ teaspoon')
    expect(spoonText(3)).toBe('⅜ teaspoon')
    expect(spoonText(10)).toBe('1¼ teaspoons')
    expect(spoonText(28)).toBe('1 tablespoon + ½ teaspoon')
    expect(spoonText(48)).toBe('2 tablespoons')
    const f: FortifySettings = { kcalPerOz: 24, with: 'powder', powder: 'standard' }
    const r = recipeFor(oz(10), f)
    expect(r.with === 'powder' && r.scoops).toBe('1 scoop')
    expect(r.tooSmall).toBe(false)
    expect(Math.abs(r.kcalPerOz - 24)).toBeLessThan(0.6)
    expect(recipeText(recipeFor(oz(5), f))).toBe('2 teaspoons of powder, or 4.5 g on a scale')
  })

  it('says when a batch is too small to measure, and how small it can go', () => {
    const f: FortifySettings = { kcalPerOz: 22, with: 'powder', powder: 'standard' }
    expect(recipeFor(5, f).tooSmall).toBe(true)
    const least = smallestBatchOz(f)
    expect(least).not.toBeNull()
    expect(recipeFor(oz(least!), f).tooSmall).toBe(false)
  })

  it("has Bobbie's own figures: one scoop to 2 fl oz of water is its 20 kcal/oz", () => {
    const bobbie = POWDERS.find((p) => p.id === 'bobbie')!
    expect(Math.abs(mixWithPowder(oz(2), bobbie.gPerScoop, bobbie, 0).kcalPerOz - 20)).toBeLessThan(0.3)
    const r = recipeFor(oz(4), { kcalPerOz: 22, with: 'powder', powder: 'bobbie' })
    expect(r.tooSmall).toBe(false)
    expect(Math.abs(r.kcalPerOz - 22)).toBeLessThan(0.6)
    // Bobbie's spec sheet: 2.49 g a level teaspoon, so 60 mL to 22 kcal/oz (0.89 g) is a third of a teaspoon, written as the
    // nearest eighth. The owner mixed ½ teaspoon from an earlier build (1.9 g a teaspoon, derived from "about 1½ tablespoons
    // a scoop"), which made about 22.8 kcal/oz; this pins the teaspoon to the maker's figure.
    expect(bobbie.gPerTbsp! / 3).toBeCloseTo(2.49, 2)
    expect(recipeText(recipeFor(60, { kcalPerOz: 22, with: 'powder', powder: 'bobbie' }))).toBe('⅜ teaspoon of Bobbie, or 0.9 g on a scale')
    expect(recipeText(recipeFor(60, { kcalPerOz: 24, with: 'powder', powder: 'bobbie' }))).toBe('¾ teaspoon of Bobbie, or 1.8 g on a scale')
    expect(mixWithPowder(60, 2.49 / 2, bobbie).kcalPerOz).toBeCloseTo(22.8, 1)
  })

  // Worked by hand (and by bisection, outside the app) for Bobbie at 22 kcal/oz: grams = mL × (22 − 20)/29.5735 ÷ (5.14 − 22/29.5735 × 0.78);
  // spoons at 2.49 g a teaspoon to the nearest eighth.
  const bobbie22: FortifySettings = { kcalPerOz: 22, with: 'powder', powder: 'bobbie' }
  it.each([
    [60, 0.9, '⅜ teaspoon'],
    [90, 1.3, '½ teaspoon'],
    [120, 1.8, '¾ teaspoon'],
    [150, 2.2, '⅞ teaspoon'],
    [180, 2.7, '1⅛ teaspoons'],
    [240, 3.6, '1⅜ teaspoons'],
  ])('Bobbie at 22: %i mL takes %f g on a scale, %s by spoon', (ml, grams, spoons) => {
    const r = recipeFor(ml, bobbie22)
    expect(r.with === 'powder' && r.scaleGrams).toBe(grams)
    expect(r.with === 'powder' && r.spoons).toBe(spoons)
    // the scale makes the strength exactly; the spoons within a quarter of a calorie
    expect(mixWithPowder(ml, powderGrams(ml, 22, POWDERS.find((p) => p.id === 'bobbie')!), POWDERS.find((p) => p.id === 'bobbie')!).kcalPerOz).toBeCloseTo(22, 6)
    expect(Math.abs(r.kcalPerOz - 22)).toBeLessThan(0.25)
  })

  it('weighs in a straight line with the milk; spoons are the rounded measure and say how far they drift', () => {
    const g = (ml: number) => powderGrams(ml, 22, POWDERS.find((p) => p.id === 'bobbie')!)
    expect(g(240)).toBeCloseTo(4 * g(60), 9)
    const rows = [60, 90, 120, 150, 180, 240].map((ml) => recipeFor(ml, bobbie22))
    expect(spoonDrift(rows, 22)).toBeGreaterThan(0.1)
    expect(spoonDrift(rows, 22)).toBeLessThan(0.2)
  })

  it('takes the powder from the can when it is typed in', () => {
    const p = powderOf({ powder: 'custom', custom: { kcalPerScoop: 49.3, gPerScoop: 9.6 } })
    expect(p.kcalPerG).toBeCloseTo(5.135, 2)
    expect(powderOf({ powder: 'nope' })).toBe(standard)
    // Only its scoop is known: no spoon weight is borrowed from another powder, so it is weighed or scooped.
    expect(p.gPerTbsp).toBeNull()
    expect(recipeText(recipeFor(120, { kcalPerOz: 24, with: 'powder', powder: 'custom', custom: { kcalPerScoop: 49.3, gPerScoop: 9.6 } }))).toBe('3.6 g of powder on a scale')
  })
})

describe('Enfamil A.R., a powder with no published spoon weight', () => {
  const ar = POWDERS.find((p) => p.id === 'enfamil-ar')!
  const ar24: FortifySettings = { kcalPerOz: 24, with: 'powder', powder: 'enfamil-ar' }

  it("carries Mead Johnson's own figures: 9 g and 45 Cal a level scoop, and one scoop to 2 fl oz of water is its 20 kcal/oz", () => {
    expect(ar.gPerScoop).toBe(9)
    expect(ar.gPerScoop * ar.kcalPerG).toBe(45)
    // "Each scoop adds about 0.2 fl oz to the amount of prepared formula."
    expect(convertVolume(ar.gPerScoop * ar.mlPerG, 'ml', 'oz')).toBeCloseTo(0.2, 2)
    expect(Math.abs(mixWithPowder(oz(2), ar.gPerScoop, ar, 0).kcalPerOz - 20)).toBeLessThan(0.5)
    expect(ar.gPerTbsp).toBeNull()
  })

  it('is given in grams and whole level scoops, never in spoons', () => {
    // Worked by hand: grams = mL × (24 − 20)/29.5735 ÷ (5.0 − 24/29.5735 × 0.66) = mL × 0.030297.
    expect(powderGrams(360, 24, ar)).toBeCloseTo(10.907, 2)
    const r = recipeFor(360, ar24)
    expect(r.with === 'powder' && r.spoons).toBeNull()
    expect(r.tooSmall).toBe(false)
    expect(r.kcalPerOz).toBeCloseTo(24, 6)
    expect(recipeText(r)).toBe('10.9 g of Enfamil A.R. on a scale')
    expect(recipeText(recipeFor(72, ar24))).toBe('2.2 g of Enfamil A.R. on a scale')
    expect(recipeText(recipeFor(60, { ...ar24, kcalPerOz: 22 }))).toBe('0.9 g of Enfamil A.R. on a scale')
    expect(recipeFor(0, ar24).tooSmall).toBe(true)
    // No spoons, so nothing drifts.
    expect(spoonDrift([r, recipeFor(72, ar24)], 24)).toBe(0)
  })

  it("matches the children's hospital chart where it uses the can's scoop: 10 oz and 1 scoop, 20 oz and 2 scoops for 24", () => {
    expect(recipeText(recipeFor(oz(10), ar24))).toBe('9 g of Enfamil A.R. on a scale (1 level scoop)')
    expect(recipeText(recipeFor(oz(20), ar24))).toBe('17.9 g of Enfamil A.R. on a scale (2 level scoops)')
    expect(Math.abs(mixWithPowder(oz(10), ar.gPerScoop, ar).kcalPerOz - 24)).toBeLessThan(0.05)
    // The rule of thumb for a family with no scale: one level scoop does about 297 mL (10 oz) of milk.
    expect(scoopMilkMl(ar24)).toBeCloseTo(297.1, 0)
    expect(scoopMilkMl({ kcalPerOz: 24, with: 'concentrate', powder: 'standard' })).toBeNull()
  })

  it('mixes five bottles as one batch: the milk together, the powder measured once, then each bottle its share', () => {
    const b = batchFor([72, 72, 72, 72, 72], ar24)
    expect(b.milkMl).toBe(360)
    expect(recipeText(b.recipe)).toBe('10.9 g of Enfamil A.R. on a scale')
    expect(b.ml).toBeCloseTo(367.2, 1)
    expect(b.pours.map((p) => Math.round(p))).toEqual([73, 73, 73, 73, 73])
    expect(b.pours.reduce((s, p) => s + p, 0)).toBeCloseTo(b.ml, 6)
    // The batch takes what the five bottles would take one by one: the recipe is a straight line in the milk.
    expect(powderGrams(360, 24, ar)).toBeCloseTo(5 * powderGrams(72, 24, ar), 9)
    // A last bottle that is short gets its own share; five of 60 mL is one level scoop.
    expect(batchFor([72, 72, 30], ar24).pours.map((p) => Math.round(p))).toEqual([73, 73, 31])
    expect(recipeText(batchFor([60, 60, 60, 60, 60], ar24).recipe)).toBe('9.1 g of Enfamil A.R. on a scale (1 level scoop)')
    // With no scale: the bottle size nearest to 72 mL that makes five bottles a whole number of level scoops.
    const fit = scoopFit(72, 5, ar24)!
    expect(fit.scoops).toBe(1)
    expect(Math.round(fit.sizeMl)).toBe(59)
    expect(recipeText(recipeFor(5 * Math.round(fit.sizeMl), ar24))).toBe('8.9 g of Enfamil A.R. on a scale (1 level scoop)')
    expect(scoopFit(110, 5, ar24)).toMatchObject({ scoops: 2 })
    expect(Math.round(scoopFit(110, 5, ar24)!.sizeMl)).toBe(119)
    expect(scoopFit(20, 2, ar24)).toMatchObject({ scoops: 1 }) // never zero scoops
    expect(scoopFit(72, 5, { kcalPerOz: 24, with: 'concentrate', powder: 'standard' })).toBeNull()
    // With spoons (Bobbie), the batch is one rounded measure for all of it.
    expect(recipeText(batchFor([60, 60, 60, 60, 60], { kcalPerOz: 22, with: 'powder', powder: 'bobbie' }).recipe)).toBe('1¾ teaspoons of Bobbie, or 4.4 g on a scale')
  })
})

describe('fortifying with liquid concentrate', () => {
  it('is one part concentrate to four of milk for 24 kcal/oz, and to nine for 22', () => {
    expect(concentrateMl(80, 24)).toBeCloseTo(20, 5)
    expect(concentrateMl(90, 22)).toBeCloseTo(10, 5)
    const r = recipeFor(oz(4), { kcalPerOz: 24, with: 'concentrate', powder: 'standard' })
    expect(r.with).toBe('concentrate')
    expect(recipeText(r)).toBe('30 mL of liquid concentrate')
    expect(Math.abs(r.kcalPerOz - 24)).toBeLessThan(0.2)
  })
})
