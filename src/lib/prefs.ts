import { DEFAULT_LABEL_PREFS, type LabelPrefs } from './labels'
import { DEFAULT_UNITS, type UnitPrefs } from './units'

export type Theme = 'system' | 'light' | 'dark'

export interface Prefs {
  theme: Theme
  units: UnitPrefs
  selectedChild: number | null
  /** Breast-milk label printing (size, storage windows, fields). */
  labels: LabelPrefs
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  units: DEFAULT_UNITS,
  selectedChild: null,
  labels: DEFAULT_LABEL_PREFS,
}

const KEY = 'bramble.prefs'

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    const labels = { ...DEFAULT_LABEL_PREFS, ...(parsed.labels ?? {}) }
    // 50 × 30 was the default before the household's 51 × 38 stock had a preset: a phone still on it without
    // ever picking a size printed a 30 mm design on 38 mm labels (a blank band under the strip, small type).
    if (labels.size === '50x30' && !labels.sizeChosen) labels.size = '51x38'
    return { ...DEFAULT_PREFS, ...parsed, units: { ...DEFAULT_UNITS, ...(parsed.units ?? {}) }, labels }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
