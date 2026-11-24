import { describe, expect, it } from 'vitest'
import { batchFor, scoopFit, concentrateMl, mixWithPowder, POWDERS, powderGrams, powderLimit, powderOf, recipeFor, recipeText, scoopMilkMl, smallestBatchOz, spoonDrift, spoonText, type FortifySettings } from './fortify'
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

describe("Enfamil A.R., from Mead Johnson's own sheets", () => {
  const ar = POWDERS.find((p) => p.id === 'enfamil-ar')!
  const ar24: FortifySettings = { kcalPerOz: 24, with: 'powder', powder: 'enfamil-ar' }

  it('carries the scoop: 9 g and 45 Cal, and one scoop to 2 fl oz of water is its 20 kcal/oz', () => {
    expect(ar.gPerScoop).toBe(9)
    expect(ar.gPerScoop * ar.kcalPerG).toBe(45)
    // "Dilutions Per 1 Scoop": 1 scoop + 59 mL yields 66 mL at 20; + 48 mL yields 55 mL at 24.
    expect(mixWithPowder(59, 9, ar, 0).ml).toBeCloseTo(66, 0)
    expect(Math.abs(mixWithPowder(59, 9, ar, 0).kcalPerOz - 20)).toBeLessThan(0.3)
    expect(Math.abs(mixWithPowder(48, 9, ar, 0).kcalPerOz - 24)).toBeLessThan(0.3)
  })

  // Table 427, grams of powder and mL of water for a final volume: the powder's volume and its calories at once.
  it.each([
    [20, 136, 897, 1000],
    [22, 150, 886, 1000],
    [24, 163, 876, 1000],
    [20, 16.3, 108, 120],
    [24, 78, 420, 480],
  ])("reproduces the maker's table: %i kcal/fl oz from %f g in %i mL of water, %i mL in all", (kcal, grams, water, total) => {
    const mixed = mixWithPowder(water, grams, ar, 0)
    expect(Math.abs(mixed.ml - total)).toBeLessThan(total * 0.005)
    expect(Math.abs(mixed.kcalPerOz - kcal)).toBeLessThan(0.25)
  })

  // Table 342, "approximate household measures", unpacked and level: grams against cups, tablespoons and teaspoons.
  it.each([
    [127, 1.25 * 16 + 1],
    [140, (4 / 3) * 16 + 1 + 2 / 3],
    [153, 1.5 * 16 + 1 + 1 / 3],
  ])("takes its tablespoon from the maker's household measures: %i g is %f tablespoons", (grams, tbsp) => {
    expect(Math.abs(grams / tbsp - ar.gPerTbsp!)).toBeLessThan(0.05)
  })

  it('so a level teaspoon is about 2 g, and its 9 g scoop about a tablespoon and a half', () => {
    expect(ar.gPerTbsp! / 3).toBeCloseTo(2.02, 2)
    expect(ar.gPerScoop / ar.gPerTbsp!).toBeCloseTo(1.49, 2)
  })

  // Worked by hand: grams = mL × (24 − 20)/29.5735 ÷ (5.0 − 24/29.5735 × 0.76) = mL × 0.030857; spoons at 2.02 g a teaspoon.
  it.each([
    [60, 1.9, '⅞ teaspoon'],
    [90, 2.8, '1⅜ teaspoons'],
    [120, 3.7, '1¾ teaspoons'],
    [180, 5.6, '2¾ teaspoons'],
    [240, 7.4, '1 tablespoon + ⅝ teaspoon'],
    [360, 11.1, '1 tablespoon + 2½ teaspoons'],
  ])('at 24: %i mL takes %f g on a scale, %s by spoon', (ml, grams, spoons) => {
    const r = recipeFor(ml, ar24)
    expect(r.with === 'powder' && r.scaleGrams).toBe(grams)
    expect(r.with === 'powder' && r.spoons).toBe(spoons)
    expect(r.tooSmall).toBe(false)
    expect(recipeText(r)).toBe(`${spoons} of Enfamil A.R., or ${grams} g on a scale`)
  })

  it('never rounds a spoon past 24, the strongest its maker allows', () => {
    for (let ml = 30; ml <= 600; ml += 7) expect(recipeFor(ml, ar24).kcalPerOz).toBeLessThanOrEqual(24.05)
    // 72 mL takes 2.2 g, 1.1 teaspoons: the nearest eighth (1⅛) would make 24.2, so it is 1 teaspoon.
    expect(recipeText(recipeFor(72, ar24))).toBe('1 teaspoon of Enfamil A.R., or 2.2 g on a scale')
    expect(mixWithPowder(72, (9 / 8) * (ar.gPerTbsp! / 3), ar).kcalPerOz).toBeGreaterThan(24.05)
    // Below its limit a spoon rounds to the nearest eighth, like any powder.
    expect(recipeText(recipeFor(60, { ...ar24, kcalPerOz: 22 }))).toBe('½ teaspoon of Enfamil A.R., or 0.9 g on a scale')
  })

  it('is refused above 24 in words, and other powders are not', () => {
    expect(powderLimit(ar24)).toBeNull()
    expect(powderLimit({ ...ar24, kcalPerOz: 22 })).toBeNull()
    expect(powderLimit({ ...ar24, kcalPerOz: 26 })).toBe('Enfamil A.R. should not be mixed stronger than 24 kcal/oz: its maker says it gets too thick. For 26, ask the doctor which formula to use.')
    expect(powderLimit({ kcalPerOz: 30, with: 'powder', powder: 'bobbie' })).toBeNull()
    expect(powderLimit({ kcalPerOz: 30, with: 'concentrate', powder: 'enfamil-ar' })).toBeNull()
  })

  it("matches the children's hospital chart where it uses the can's scoop: 10 oz and 1 scoop, 20 oz and 2 scoops for 24", () => {
    expect(recipeText(recipeFor(oz(10), ar24))).toBe('1 tablespoon + 1½ teaspoons of Enfamil A.R. (1 scoop), or 9.1 g on a scale')
    expect(recipeText(recipeFor(oz(20), ar24))).toBe('3 tablespoons of Enfamil A.R. (2 scoops), or 18.3 g on a scale')
    expect(Math.abs(mixWithPowder(oz(10), ar.gPerScoop, ar).kcalPerOz - 24)).toBeLessThan(0.1)
    expect(scoopMilkMl(ar24)).toBeCloseTo(291.7, 0)
    expect(scoopMilkMl({ kcalPerOz: 24, with: 'concentrate', powder: 'standard' })).toBeNull()
    // Sweep 2026-11-24: at the maker's limit a whole scoop is offered only where it does not pass it. One 9 g scoop
    // in 280 mL makes 24.2, so no scoop is named there; from the scoop's own amount of milk up it is.
    for (let ml = 200; ml <= 700; ml += 1) {
      const r = recipeFor(ml, ar24)
      if (r.with !== 'powder' || !r.scoops) continue
      expect(mixWithPowder(ml, parseInt(r.scoops, 10) * ar.gPerScoop, ar).kcalPerOz, `${ml} mL`).toBeLessThanOrEqual(24.05)
    }
    expect(recipeText(recipeFor(280, ar24))).not.toContain('scoop')
    expect(recipeText(recipeFor(295, ar24))).toContain('(1 scoop)')
    // Below the limit a scoop a little over the target is still a scoop within a few percent.
    expect(recipeText(recipeFor(570, { ...ar24, kcalPerOz: 22 }))).toContain('(1 scoop)')
    // The chart's teaspoons are for standard formula (about 2.3 g a teaspoon). A.R. is lighter, so the same spoons
    // come out under 24 with it: 5 oz and 2 teaspoons is about 23.5.
    expect(mixWithPowder(oz(5), 2 * (ar.gPerTbsp! / 3), ar).kcalPerOz).toBeCloseTo(23.5, 0)
  })

  it('mixes five bottles as one batch: the milk together, the powder measured once, then each bottle its share', () => {
    const b = batchFor([72, 72, 72, 72, 72], ar24)
    expect(b.milkMl).toBe(360)
    expect(recipeText(b.recipe)).toBe('1 tablespoon + 2½ teaspoons of Enfamil A.R., or 11.1 g on a scale')
    expect(b.ml).toBeCloseTo(368.4, 1)
    expect(b.pours.map((p) => Math.round(p))).toEqual([74, 74, 74, 74, 74])
    expect(b.pours.reduce((s, p) => s + p, 0)).toBeCloseTo(b.ml, 6)
    // The batch takes what the five bottles would take one by one: the recipe is a straight line in the milk.
    expect(powderGrams(360, 24, ar)).toBeCloseTo(5 * powderGrams(72, 24, ar), 9)
    // One measure for the batch lands on 24; five small ones, each rounded down, land under it.
    expect(b.recipe.kcalPerOz).toBeCloseTo(24, 1)
    expect(recipeFor(72, ar24).kcalPerOz).toBeLessThan(23.7)
    // A last bottle that is short gets its own share.
    expect(batchFor([72, 72, 30], ar24).pours.map((p) => Math.round(p))).toEqual([74, 74, 31])
    // With no spoons at all (a can typed in), the bottle size at which five bottles take whole level scoops.
    const can: FortifySettings = { kcalPerOz: 24, with: 'powder', powder: 'custom', custom: { kcalPerScoop: 45, gPerScoop: 9 } }
    const fit = scoopFit(72, 5, can)!
    expect(fit.scoops).toBe(1)
    expect(recipeText(recipeFor(5 * Math.round(fit.sizeMl), can))).toMatch(/ g of powder on a scale \(1 level scoop\)$/)
    expect(scoopFit(110, 5, can)).toMatchObject({ scoops: 2 })
    expect(scoopFit(20, 2, can)).toMatchObject({ scoops: 1 }) // never zero scoops
    expect(scoopFit(72, 5, { kcalPerOz: 24, with: 'concentrate', powder: 'standard' })).toBeNull()
    // Bobbie's batch is one rounded measure for all of it.
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
