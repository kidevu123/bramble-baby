/**
 * Printing a milk label on its own when a pumping is saved: the decision, the label input built from
 * the saved entry, and the offscreen render. The bag itself is registered through the same idempotent
 * `companion.milk.create` the label sheet uses, so a reprint from the sheet or the Stash finds it.
 */
import type { Child, Pumping } from './api/types'
import { canvasToPng, drawLabel, type LabelPrefs, type MilkLabelInput } from './labels'
import { parseDate } from './time'
import type { VolumeUnit } from './units'

/**
 * Print on save only when the phone asked for it, the Bramble server has a printer, the entry is new, it
 * has a volume, and the label sheet was not already used for this entry (then its bag exists and the
 * label was printed, or deliberately not, from there).
 */
export function autoPrintWanted(opts: { prefs: Pick<LabelPrefs, 'autoPrint'>; printerConfigured: boolean; editing: boolean; amount: number | null; bagAlready: boolean }): boolean {
  return opts.prefs.autoPrint && opts.printerConfigured && !opts.editing && opts.amount !== null && opts.amount > 0 && !opts.bagAlready
}

/** The label for a pumping entry as this phone shows it (`amount` in the phone's unit, not storage). */
export function labelInputFor(child: Pick<Child, 'first_name' | 'birth_date'>, saved: Pick<Pumping, 'start' | 'notes'>, amount: number, unit: VolumeUnit, code: string): MilkLabelInput {
  return { childName: child.first_name, pumpedAt: parseDate(saved.start), amount, unit, notes: saved.notes, code, birthDate: child.birth_date }
}

/** Draws the label on a canvas nobody sees, once the label fonts are in, and returns the PNG. */
export async function renderLabelBlob(input: MilkLabelInput, prefs: LabelPrefs): Promise<Blob> {
  try {
    await Promise.all([document.fonts?.load?.("800 32px 'Nunito'"), document.fonts?.load?.("900 32px 'Fraunces'")])
  } catch {
    /* fonts are best-effort; the canvas falls back */
  }
  const canvas = document.createElement('canvas')
  if (!drawLabel(canvas, input, prefs)) throw new Error('This phone cannot draw the label image.')
  return canvasToPng(canvas)
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('Could not read the label image.'))
    r.readAsDataURL(blob)
  })
}
