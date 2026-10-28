import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { usePrefs } from '../../hooks/usePrefs'
import { describeApiError } from '../../lib/api/client'
import { companion } from '../../lib/api/companion'
import { blobToBase64 } from '../../lib/auto-print'
import { canShareFiles, canvasToPng, drawSpotLabel } from '../../lib/labels'
import { NIGHT_SPOTS } from '../../lib/milk'

const SPOTS = Array.from({ length: NIGHT_SPOTS }, (_, i) => i + 1)

/** The five spot stickers as PNGs, once the label fonts are in. */
async function renderSpots(size: Parameters<typeof drawSpotLabel>[2]): Promise<Blob[]> {
  try {
    await Promise.all([document.fonts?.load?.("900 32px 'Nunito'"), document.fonts?.load?.("900 32px 'Fraunces'")])
  } catch {
    /* fonts are best-effort; the canvas falls back */
  }
  return Promise.all(
    SPOTS.map((spot) => {
      const canvas = document.createElement('canvas')
      if (!drawSpotLabel(canvas, spot, size)) throw new Error('This phone cannot draw the sticker image.')
      return canvasToPng(canvas)
    }),
  )
}

/**
 * The fridge spot stickers for premade bottles (Stash › Premade bottles), printed once: 1 to 5 on the label stock
 * that is loaded, straight to the server printer, or through the share sheet when there is none.
 */
export function SpotStickers({ printer }: { printer: boolean }) {
  const { prefs } = usePrefs()
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let live = true
    void renderSpots({ size: prefs.labels.size })
      .then((blobs) => {
        if (!live) return
        url = URL.createObjectURL(blobs[0])
        setPreview(url)
      })
      .catch(() => setPreview(null))
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [prefs.labels.size])

  const send = useMutation({
    mutationFn: async () => {
      const blobs = await renderSpots({ size: prefs.labels.size })
      if (printer) {
        // One at a time, in order, so they come out 1 to 5.
        for (const [i, blob] of blobs.entries()) await companion.print.label(await blobToBase64(blob), `SPOT${i + 1}`)
        return 'printed' as const
      }
      const files = blobs.map((b, i) => new File([b], `night-bottle-spot-${i + 1}.png`, { type: 'image/png' }))
      if (canShareFiles()) {
        await navigator.share({ files, title: 'Premade bottle spots 1–5' })
        return 'shared' as const
      }
      for (const f of files) {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(f)
        a.download = f.name
        a.click()
        URL.revokeObjectURL(a.href)
      }
      return 'saved' as const
    },
  })

  return (
    <section className="card ls-spots stack" aria-label="Fridge spot stickers" data-testid="spot-stickers">
      <div className="ls-spots-head">
        {preview ? <img className="ls-spot-preview" src={preview} alt="Sticker for spot 1" /> : null}
        <span className="ls-row-text grow">
          <span className="strong">Fridge spot stickers</span>
          <span className="small muted">1 to {NIGHT_SPOTS}, one time. Stick them where the premade bottles stand; the Stash shows which spot holds which bottle.</span>
        </span>
      </div>
      <Button variant="secondary" block onClick={() => send.mutate()} loading={send.isPending}>
        {printer ? `Print stickers 1–${NIGHT_SPOTS}` : `Share stickers 1–${NIGHT_SPOTS}`}
      </Button>
      {send.isSuccess ? (
        <p className="small ls-spots-done" role="status">
          {send.data === 'printed' ? `Sent ${NIGHT_SPOTS} stickers to the printer.` : send.data === 'shared' ? 'Shared.' : 'Saved to Downloads.'}
        </p>
      ) : null}
      {send.isError && !(send.error instanceof DOMException && send.error.name === 'AbortError') ? (
        <p className="log-error" role="alert">
          Could not {printer ? 'print' : 'share'} the stickers: {describeApiError(send.error)}
        </p>
      ) : null}
    </section>
  )
}
