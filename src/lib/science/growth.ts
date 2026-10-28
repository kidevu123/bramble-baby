import { WHO_LMS, type GrowthMetric, type Sex } from './growth-data'

export type { GrowthMetric, Sex }

function lmsAt(metric: GrowthMetric, sex: Sex, ageMonths: number): [number, number, number] {
  const table = WHO_LMS[metric][sex]
  const m = Math.max(0, Math.min(table.length - 1, ageMonths))
  const lo = Math.floor(m)
  const hi = Math.min(table.length - 1, lo + 1)
  const t = m - lo
  const a = table[lo]
  const b = table[hi]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Oldest age (months) the bundled WHO table covers. Beyond it we return NaN instead of the 24-month row. */
export function growthTableMaxMonths(metric: GrowthMetric, sex: Sex): number {
  return WHO_LMS[metric][sex].length - 1
}

/** WHO LMS z-score. Weight in kg, length/head in cm. Valid 0–24 months; NaN outside the table. */
export function zScore(metric: GrowthMetric, sex: Sex, ageMonths: number, value: number): number {
  if (!Number.isFinite(ageMonths) || ageMonths < 0 || ageMonths > growthTableMaxMonths(metric, sex)) return NaN
  const [L, M, S] = lmsAt(metric, sex, ageMonths)
  if (value <= 0) return NaN
  return Math.abs(L) < 1e-6 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S)
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26), good to ~1e-7. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

export function percentile(metric: GrowthMetric, sex: Sex, ageMonths: number, value: number): number {
  const z = zScore(metric, sex, ageMonths, value)
  if (Number.isNaN(z)) return NaN
  return Math.round(normalCdf(z) * 1000) / 10
}

/** The value at a given percentile (for drawing reference curves). */
export function valueAtPercentile(metric: GrowthMetric, sex: Sex, ageMonths: number, p: number): number {
  const [L, M, S] = lmsAt(metric, sex, ageMonths)
  const z = inverseNormal(p / 100)
  return Math.abs(L) < 1e-6 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L)
}

/** Acklam's rational approximation of the inverse normal CDF. */
function inverseNormal(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p <= 1 - pl) {
    const q = p - 0.5
    const r = q * q
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }
  const q = Math.sqrt(-2 * Math.log(1 - p))
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
}

export function describePercentile(p: number): string {
  if (Number.isNaN(p)) return ''
  // Off the chart either way, a rounded "0th" or "100th" means nothing: say where it sits instead.
  if (p < 0.5) return 'below the 1st percentile · below the typical range; worth discussing at the next visit'
  if (p > 99.5) return 'above the 99th percentile · above the typical range; usually fine if following their curve'
  const r = Math.round(p)
  const suffix = r % 10 === 1 && r % 100 !== 11 ? 'st' : r % 10 === 2 && r % 100 !== 12 ? 'nd' : r % 10 === 3 && r % 100 !== 13 ? 'rd' : 'th'
  if (r < 3) return `${r}${suffix} percentile · below the typical range; worth discussing at the next visit`
  if (r > 97) return `${r}${suffix} percentile · above the typical range; usually fine if following their curve`
  return `${r}${suffix} percentile (WHO)`
}

/** Typical weight gain by age (AAP HealthyChildren). */
export function expectedWeightGain(ageMonths: number): { gramsPerWeek: [number, number]; text: string; sources: string[] } {
  const sources = ['hc-weight-gain']
  if (ageMonths < 0.5) return { gramsPerWeek: [0, 0], text: 'Newborns lose up to 7–10% of birth weight in the first days and regain it by 10–14 days.', sources }
  if (ageMonths < 3) return { gramsPerWeek: [150, 200], text: 'About 150–200 g (5–7 oz) a week, roughly doubling birth weight by 4–5 months.', sources }
  if (ageMonths < 6) return { gramsPerWeek: [100, 150], text: 'About 100–150 g (3.5–5 oz) a week.', sources }
  if (ageMonths < 12) return { gramsPerWeek: [70, 90], text: 'About 70–90 g (2.5–3 oz) a week, tripling birth weight by the first birthday.', sources }
  return { gramsPerWeek: [40, 60], text: 'Toddlers gain about 2–3 kg a year; growth slows and appetite varies day to day.', sources }
}
