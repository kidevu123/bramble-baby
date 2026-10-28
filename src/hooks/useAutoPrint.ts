import { useCallback } from 'react'
import { describeApiError } from '../lib/api/client'
import { companion, type MilkBag, type MilkLocation } from '../lib/api/companion'
import type { Child, Pumping } from '../lib/api/types'
import { autoPrintWanted, blobToBase64, labelInputFor, renderLabelBlob } from '../lib/auto-print'
import { toMl } from '../lib/milk'
import { beginPrintNotice, updatePrintNotice } from '../lib/print-notice'
import { toIso } from '../lib/time'
import { volumeLabel } from '../lib/units'
import { useInvalidateMilk, useMilkWindows, usePrinterStatus } from './useMilk'
import { usePrefs } from './usePrefs'

/**
 * "Save prints the sticker": after a new pumping entry with a volume is saved, register its bag (the same
 * idempotent call the label sheet makes, keyed on the pumping id) and send the label to the printer on
 * the Bramble server. Runs on after the sheet has closed or the timer page has left; the PrintNotice
 * banner shows what became of it. The label sheet and the Stash keep the reprint.
 */
export function useAutoPrint() {
  const { prefs } = usePrefs()
  const printer = usePrinterStatus()
  const windows = useMilkWindows()
  const invalidateMilk = useInvalidateMilk()
  const printerConfigured = Boolean(printer.data?.configured)
  const enabled = prefs.labels.autoPrint && printerConfigured
  const unit = prefs.units.volume

  /** `amount` in this phone's unit; `saved` as Baby Buddy returned it. Resolves when the print is sent or has failed. */
  const run = useCallback(
    async (child: Child, saved: Pumping, amount: number | null, opts: { editing: boolean; bag: MilkBag | null; location?: MilkLocation }): Promise<void> => {
      if (!autoPrintWanted({ prefs: prefs.labels, printerConfigured, editing: opts.editing, amount, bagAlready: opts.bag !== null })) return
      const volume = amount as number
      const id = beginPrintNotice(`${unit === 'oz' ? Math.round(volume * 100) / 100 : Math.round(volume)} ${volumeLabel(unit)}`)
      try {
        const bag = await companion.milk.create({
          child: child.id,
          pumped_at: toIso(new Date(saved.start)),
          volume_ml: toMl(volume, unit),
          location: opts.location ?? 'fridge',
          pumping_id: saved.id,
          notes: saved.notes ?? '',
          windows,
        })
        invalidateMilk(child.id)
        updatePrintNotice(id, { bagCode: bag.code })
        const blob = await renderLabelBlob(labelInputFor(child, saved, volume, unit, bag.code), prefs.labels)
        const res = await companion.print.label(await blobToBase64(blob), bag.code)
        updatePrintNotice(id, { state: 'sent', job: res.job })
      } catch (err) {
        updatePrintNotice(id, { state: 'failed', error: describeApiError(err) })
      }
    },
    [prefs.labels, printerConfigured, unit, windows, invalidateMilk],
  )
  return { enabled, run }
}
