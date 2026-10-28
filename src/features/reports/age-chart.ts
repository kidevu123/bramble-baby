/** Pure layout for the growth chart by age (`GrowthAgeChart`): the window, the fitted lines, the ticks. */

const WEEK_MONTHS = 7 / 30.4375

/** The whole chart, like the pediatrician's card: birth to 3, 6, 12 or 24 months, the smallest that holds the
 *  latest age with a week to spare. */
export function fullWindow(ageMonths: number): number {
  return [3, 6, 12, 24].find((w) => ageMonths + WEEK_MONTHS <= w) ?? 24
}

/** Zoomed in: how far the chart runs past the latest age, in months: a week, or a sixth of the age, whichever is more. */
export function ageWindowEnd(ageMonths: number): number {
  return Math.min(24, Math.max(0.5, ageMonths + Math.max(WEEK_MONTHS, ageMonths / 6)))
}

/**
 * Which lines the height is fitted to (indexes into the lines, low to high): the lines either side of every
 * measurement, and one more beyond them on each side for context. A baby on the 50th sees the 10th to the 90th;
 * a baby under the 2nd sees the 2nd and the 5th. Lines further out are clipped and labelled where they leave.
 */
export function linesAround(ys: number[], lineValuesAt: (k: number, i: number) => number, lineCount: number): number[] {
  if (!ys.length) return Array.from({ length: lineCount }, (_, k) => k)
  let lo = lineCount
  let hi = -1
  ys.forEach((y, i) => {
    let above = 0
    while (above < lineCount && lineValuesAt(above, i) <= y) above++
    lo = Math.min(lo, Math.max(0, above - 1))
    hi = Math.max(hi, Math.min(lineCount - 1, above))
  })
  const from = Math.max(0, lo - 1)
  const to = Math.min(lineCount - 1, hi + 1)
  return Array.from({ length: to - from + 1 }, (_, k) => from + k)
}

/** Age ticks: weeks up to about three months ("Birth", "2 wk", "4 wk"…), months after (always months with
 *  `months`, as on the whole chart); at most five. */
export function ageTicks(end: number, months = false, start = 'Birth'): { m: number; label: string }[] {
  const weeks = end / WEEK_MONTHS
  if (!months && weeks <= 14) {
    const step = [1, 2, 4].find((s) => Math.floor(weeks / s) + 1 <= 5) ?? 4
    return Array.from({ length: Math.floor(weeks / step) + 1 }, (_, k) => ({ m: k * step * WEEK_MONTHS, label: k ? `${k * step} wk` : start }))
  }
  const step = [1, 2, 3, 6].find((s) => Math.floor(end / s) + 1 <= 5) ?? 6
  return Array.from({ length: Math.floor(end / step) + 1 }, (_, k) => ({ m: k * step, label: k ? `${k * step} mo` : start }))
}
