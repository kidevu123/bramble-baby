import { useCallback } from 'react'
import { describeApiError } from '../lib/api/client'
import { companion, type MilkBag, type MilkLocation } from '../lib/api/companion'
import type { Child, Id, Pumping } from '../lib/api/types'
import { autoPrintWanted, blobToBase64, labelInputFor, labelInputForBag, renderLabelBlob, reprintOnMoveWanted, stashOnSaveWanted } from '../lib/auto-print'
import { bagVolume, toMl } from '../lib/milk'
import { beginPrintNotice, updatePrintNotice } from '../lib/print-notice'
import { toIso } from '../lib/time'
import { volumeLabel } from '../lib/units'
import { useChildSettings } from './useChildSettings'
import { useInvalidateMilk, useMilkStash, useMilkWindows, usePrinterStatus } from './useMilk'
import { usePrefs } from './usePrefs'

/**
 * What follows a new pumping entry with a volume. Its milk goes into the stash (the same idempotent call the label
 * sheet makes, keyed on the pumping id): always when the sticker prints on save, and otherwise whenever the household
 * keeps a stash (`stashOnSaveWanted`), so a session saved away from the printer, or with printing switched off, is
 * still in the stash. "Save prints the sticker" then sends the label to the printer on the Bramble server when that
 * is asked for. Runs on after the sheet has closed or the timer page has left; the PrintNotice banner shows what
 * became of a print, or says when the milk could not be put in the stash. The label sheet and the Stash keep the reprint.
 */
export function useAutoPrint(childId: Id | null = null) {
  const { prefs } = usePrefs()
  const printer = usePrinterStatus()
  const windows = useMilkWindows()
  const invalidateMilk = useInvalidateMilk()
  const { settings } = useChildSettings(childId)
  const stash = useMilkStash(childId)
  const printerConfigured = Boolean(printer.data?.configured)
  /** Saving prints the sticker (and so puts the milk in the stash). */
  const enabled = prefs.labels.autoPrint && printerConfigured
  const stashSetting = settings.stashOnSave
  const stashInUse = (stash.data?.length ?? 0) > 0
  /** The stash listing has answered: only then does "nothing in it" mean the household keeps no stash. */
  const stashKnown = stash.data !== undefined
  /** Saving puts the milk in the stash, sticker or not. */
  const stashes = enabled || (stashSetting ?? stashInUse)
  const unit = prefs.units.volume

  /** `amount` in this phone's unit; `saved` as Baby Buddy returned it. Resolves when the print is sent or has failed. */
  const run = useCallback(
    async (child: Child, saved: Pumping, amount: number | null, opts: { editing: boolean; bag: MilkBag | null; location?: MilkLocation }): Promise<void> => {
      const print = autoPrintWanted({ prefs: prefs.labels, printerConfigured, editing: opts.editing, amount, bagAlready: opts.bag !== null })
      if (!print) {
        let inUse = stashInUse
        if (stashSetting === undefined && !stashKnown && !opts.editing && (amount ?? 0) > 0 && opts.bag === null) {
          // The listing has not answered yet (the sheet was open for seconds, or it failed): ask now rather than take
          // silence for "this household keeps no stash" and leave the milk out of it without a word.
          try {
            inUse = (await companion.milk.list(child.id)).length > 0
          } catch {
            return // unreachable: the Stash tab offers the session as "not in the stash" once it is back
          }
        }
        if (!stashOnSaveWanted({ setting: stashSetting, stashInUse: inUse, editing: opts.editing, amount, bagAlready: opts.bag !== null })) return
      }
      const volume = amount as number
      const text = `${unit === 'oz' ? Math.round(volume * 100) / 100 : Math.round(volume)} ${volumeLabel(unit)}`
      // A print is followed from its first moment; the stash step alone is quiet unless it fails.
      let id = print ? beginPrintNotice(text) : null
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
        if (id === null) return
        updatePrintNotice(id, { bagCode: bag.code })
        const blob = await renderLabelBlob(labelInputFor(child, saved, volume, unit, bag.code), prefs.labels)
        const res = await companion.print.label(await blobToBase64(blob), bag.code)
        updatePrintNotice(id, { state: 'sent', job: res.job })
      } catch (err) {
        id ??= beginPrintNotice(text, 'stash')
        updatePrintNotice(id, { state: 'failed', error: describeApiError(err) })
      }
    },
    [prefs.labels, printerConfigured, stashSetting, stashInUse, stashKnown, unit, windows, invalidateMilk],
  )

  /**
   * A bag that has just moved (`bag` as the server returned it, `from` where it was): a new label when it went into
   * the freezer or came out of it to thaw, and the phone asked for that. The PrintNotice says what became of it.
   */
  const reprintMoved = useCallback(
    async (child: Child, bag: MilkBag, from: MilkLocation): Promise<void> => {
      if (!reprintOnMoveWanted({ prefs: prefs.labels, printerConfigured, from, to: bag.location })) return
      const id = beginPrintNotice(bagVolume(bag, unit))
      updatePrintNotice(id, { bagCode: bag.code })
      try {
        const blob = await renderLabelBlob(labelInputForBag(child, bag, unit), prefs.labels)
        const res = await companion.print.label(await blobToBase64(blob), bag.code)
        updatePrintNotice(id, { state: 'sent', job: res.job })
      } catch (err) {
        updatePrintNotice(id, { state: 'failed', error: describeApiError(err) })
      }
    },
    [prefs.labels, printerConfigured, unit],
  )
  return { enabled, stashes, run, reprintMoved }
}
