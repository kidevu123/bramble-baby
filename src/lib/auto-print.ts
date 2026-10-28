/**
 * Printing a milk label on its own when a pumping is saved: the decision, the label input built from
 * the saved entry, and the offscreen render. The bag itself is registered through the same idempotent
 * `companion.milk.create` the label sheet uses, so a reprint from the sheet or the Stash finds it.
 */
import type { MilkBag, MilkLocation } from './api/companion'
import type { Child, Pumping } from './api/types'
import { canvasToPng, drawLabel, type LabelPrefs, type MilkLabelInput } from './labels'
import { labelAmountIn } from './milk'
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

/**
 * A new label when a bag goes into the freezer or comes out of it to thaw (Settings › Milk labels & printer), when
 * the Bramble server has a printer. Moves between the counter and the fridge keep their label: nothing on it changes.
 */
export function reprintOnMoveWanted(opts: { prefs: Pick<LabelPrefs, 'reprintOnFreezer'>; printerConfigured: boolean; from: MilkLocation; to: MilkLocation }): boolean {
  return opts.prefs.reprintOnFreezer && opts.printerConfigured && opts.from !== opts.to && (opts.from === 'freezer' || opts.to === 'freezer')
}

/** A stash bag's label as the label sheet draws it: its own volume and pumped time, THAWED with the thaw clock. */
export function labelInputForBag(child: Pick<Child, 'first_name' | 'birth_date'>, bag: Pick<MilkBag, 'pumped_at' | 'volume_ml' | 'notes' | 'code' | 'thawed' | 'thawed_at'>, unit: VolumeUnit): MilkLabelInput {
  return {
    childName: child.first_name,
    pumpedAt: parseDate(bag.pumped_at),
    amount: labelAmountIn(bag, unit),
    unit,
    notes: bag.notes,
    code: bag.code,
    birthDate: child.birth_date,
    thawedAt: bag.thawed && bag.thawed_at ? parseDate(bag.thawed_at) : null,
  }
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
