import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { PillChoice } from '../../components/ui/Field'
import { usePrefs } from '../../hooks/usePrefs'
import { describeApiError } from '../../lib/api/client'
import { companion } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { blobToBase64 } from '../../lib/auto-print'
import { canShareFiles, canvasToPng, drawTravelLabel } from '../../lib/labels'
import { newClientKey } from '../../lib/milk'
import { partlyPrinted, printInOrder } from '../../lib/print'

const COUNTS = ['5', '10', '20'] as const

/**
 * Travel stickers: the printer stays home, so blank QR stickers are printed ahead and taken along. Each is a code
 * with no milk yet; scanned in the pumping sheet when that session is logged, the session's bag takes its code.
 * Printed on the server printer, or shared when there is none.
 */
export function TravelStickers({ printer, child }: { printer: boolean; child: Child | null }) {
  const { prefs } = usePrefs()
  const qc = useQueryClient()
  const [count, setCount] = useState<(typeof COUNTS)[number]>('10')
  // One key per batch: a retry after a failed print reprints the same codes instead of reserving more.
  const key = useRef(newClientKey())
  // The codes of this batch that have already gone to the printer: a tap after a failure sends only the rest.
  const done = useRef(new Set<string>())
  const [progress, setProgress] = useState<{ sent: number; of: number } | null>(null)
  const list = useQuery({ queryKey: ['milk-travel', child?.id], queryFn: () => companion.milk.travel(child!.id), enabled: Boolean(child) })
  const unused = (list.data ?? []).filter((t) => t.status === 'unused').length

  const send = useMutation({
    mutationFn: async () => {
      if (!child) throw new Error('No child yet.')
      const stickers = await companion.milk.reserveTravel(child.id, Number(count), key.current)
      try {
        await Promise.all([document.fonts?.load?.("900 32px 'Nunito'"), document.fonts?.load?.("800 32px 'Nunito'")])
      } catch {
        /* fonts are best-effort */
      }
      const blobs = await Promise.all(
        stickers.map((t) => {
          const canvas = document.createElement('canvas')
          if (!drawTravelLabel(canvas, t.code, prefs.labels, prefs.labels.showName ? child.first_name : '')) throw new Error('This phone cannot draw the sticker image.')
          return canvasToPng(canvas)
        }),
      )
      if (printer) {
        const jobs = stickers.map((t, i) => ({ code: t.code, blob: blobs[i] }))
        await printInOrder(jobs, (j) => j.code, async (j) => companion.print.label(await blobToBase64(j.blob), j.code), done.current, (sent, of) => setProgress({ sent, of }))
        return { how: 'printed' as const, n: stickers.length }
      }
      const files = blobs.map((b, i) => new File([b], `travel-sticker-${stickers[i].code}.png`, { type: 'image/png' }))
      if (canShareFiles()) {
        await navigator.share({ files, title: 'Travel milk stickers' })
        return { how: 'shared' as const, n: stickers.length }
      }
      for (const f of files) {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(f)
        a.download = f.name
        a.click()
        URL.revokeObjectURL(a.href)
      }
      return { how: 'saved' as const, n: stickers.length }
    },
    onSuccess: () => {
      key.current = newClientKey() // the next tap is a new batch
      done.current = new Set()
      setProgress(null)
      void qc.invalidateQueries({ queryKey: ['milk-travel'] })
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['milk-travel'] }),
  })
  const partly = send.isError && progress ? partlyPrinted(progress.sent, progress.of) : null
  /** Another count is another batch: a run that stopped part-way is let go (its unprinted codes stay unused). */
  const pick = (c: (typeof COUNTS)[number]) => {
    if (c !== count) {
      key.current = newClientKey()
      done.current = new Set()
      setProgress(null)
      send.reset()
    }
    setCount(c)
  }

  return (
    <section className="card ls-spots stack" aria-label="Travel stickers" data-testid="travel-stickers">
      <span className="ls-row-text">
        <span className="strong">Travel stickers</span>
        <span className="small muted">
          Blank QR stickers to take along when the printer is not with you. After pumping, stick one on, write the amount on it, and scan it in the pumping sheet: that session's milk takes its code.
          {unused ? ` ${unused} printed and not used yet.` : ''}
        </span>
      </span>
      <PillChoice label="How many travel stickers" tone="teal" value={count} onChange={pick} options={COUNTS.map((c) => ({ value: c, label: c }))} />
      <Button variant="secondary" block onClick={() => send.mutate()} loading={send.isPending} disabled={!child}>
        {printer ? (partly ? `Print the other ${progress!.of - progress!.sent}` : `Print ${count} travel stickers`) : `Share ${count} travel stickers`}
      </Button>
      {send.isPending && printer && progress && progress.of > 0 ? (
        <p className="small muted" role="status" data-testid="travel-progress">
          Sent {progress.sent} of {progress.of} to the printer…
        </p>
      ) : null}
      {send.isSuccess ? (
        <p className="small ls-spots-done" role="status">
          {send.data.how === 'printed' ? `Sent ${send.data.n} travel stickers to the printer.` : send.data.how === 'shared' ? 'Shared.' : 'Saved to Downloads.'}
        </p>
      ) : null}
      {send.isError && !(send.error instanceof DOMException && send.error.name === 'AbortError') ? (
        <p className="log-error" role="alert">
          Could not {printer ? 'print' : 'share'} the travel stickers: {describeApiError(send.error)}
          {partly ? ` ${partly}` : ''}
        </p>
      ) : null}
    </section>
  )
}
