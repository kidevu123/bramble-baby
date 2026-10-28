import { describe, expect, it } from 'vitest'
import { concentrateMl, mixWithPowder, POWDERS, powderGrams, powderOf, recipeFor, recipeText, smallestBatchOz, spoonText, type FortifySettings } from './fortify'
import { convertVolume } from './units'

const oz = (n: number) => convertVolume(n, 'oz', 'ml')
const standard = POWDERS[0]
const tsp = standard.gPerTbsp / 3

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
    expect(spoonText(1)).toBe('¼ teaspoon')
    expect(spoonText(5)).toBe('1¼ teaspoons')
    expect(spoonText(14)).toBe('1 tablespoon + ½ teaspoon')
    expect(spoonText(24)).toBe('2 tablespoons')
    const f: FortifySettings = { kcalPerOz: 24, with: 'powder', powder: 'standard' }
    const r = recipeFor(oz(10), f)
    expect(r.with === 'powder' && r.scoops).toBe('1 scoop')
    expect(r.tooSmall).toBe(false)
    expect(Math.abs(r.kcalPerOz - 24)).toBeLessThan(0.6)
    expect(recipeText(recipeFor(oz(5), f))).toBe('2 teaspoons of powder')
  })

  it('says when a batch is too small to measure, and how small it can go', () => {
    const f: FortifySettings = { kcalPerOz: 22, with: 'powder', powder: 'standard' }
    expect(recipeFor(15, f).tooSmall).toBe(true)
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
  })

  it('takes the powder from the can when it is typed in', () => {
    const p = powderOf({ powder: 'custom', custom: { kcalPerScoop: 49.3, gPerScoop: 9.6 } })
    expect(p.kcalPerG).toBeCloseTo(5.135, 2)
    expect(powderOf({ powder: 'nope' })).toBe(standard)
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
