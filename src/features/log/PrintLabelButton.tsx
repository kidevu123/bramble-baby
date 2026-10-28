import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { usePrintJob } from '../../hooks/useMilk'
import { useNow } from '../../hooks/useNow'
import { describeApiError } from '../../lib/api/client'
import { companion, type PrintJob } from '../../lib/api/companion'
import { formatSince, printJobTone } from '../../lib/print'

interface Props {
  /** The rendered label; null while it is still drawing. */
  png: Blob | null
  /** False until the label belongs to a bag (no volume → no bag → nothing to print). */
  canPrint: boolean
  /** The bag's code, so the server log can say which label it was. */
  bagCode: string | null
}

/** One send of the label to the printer, as the sheet remembers it. */
interface Sent {
  at: Date
  job: PrintJob
}

/**
 * The "Print label" button for a printer attached to the Bramble server, with the feedback that goes
 * with it: a sending state the moment it is tapped, then a card that says the label was sent (with the
 * time) and relays what the printer itself answered, or a card that says why it did not go. After a
 * send the button turns into a deliberate "Print again · sent 12 s ago", so a second tap out of
 * impatience never prints a second label; a second label on purpose is one tap away.
 */
export function PrintLabelButton({ png, canPrint, bagCode }: Props) {
  const [sent, setSent] = useState<Sent | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const now = useNow(sent ? 1_000 : 60_000)
  const followed = usePrintJob(sent?.job ?? null)
  const job = followed.data ?? sent?.job ?? null
  // Set the instant a tap is accepted, before React has re-rendered the disabled button: two taps a few
  // milliseconds apart (a thumb bouncing) would otherwise both see "not pending" and print twice.
  const inFlight = useRef(false)

  const print = useMutation({
    mutationFn: async () => {
      if (!canPrint || !png) throw new Error(bagCode ? 'The label has not rendered yet.' : 'Enter the volume first; the label needs its bag.')
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(new Error('Could not read the label image.'))
        r.readAsDataURL(png)
      })
      return companion.print.label(b64, bagCode)
    },
    onSuccess: (res) => {
      setFailure(null)
      setSent({ at: new Date(), job: res.job })
    },
    onError: (err) => {
      setFailure(describeApiError(err))
    },
    onSettled: () => {
      inFlight.current = false
    },
  })

  function tap() {
    // A tap while a label is on its way does nothing: the one in flight is the one that prints.
    if (inFlight.current || print.isPending) return
    inFlight.current = true
    print.mutate()
  }

  const tone = job ? printJobTone(job) : 'good'
  const waiting = job?.checking ?? false
  // The card takes the button's place and pushes the button down: keep both on screen.
  const rootRef = useRef<HTMLDivElement>(null)
  const outcome = failure ?? sent?.at.getTime() ?? null
  useEffect(() => {
    if (outcome !== null) rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [outcome])

  return (
    <div ref={rootRef} className="stack print-label">
      {failure ? (
        <div className="print-card state-failed" role="alert">
          <span className="print-mark" aria-hidden>
            <svg viewBox="0 0 20 20" width="20" height="20"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
          </span>
          <div className="print-card-body">
            <p className="print-card-title">Could not print</p>
            <p className="print-card-detail">{failure}</p>
          </div>
        </div>
      ) : sent && job ? (
        <div className={`print-card state-sent tone-${tone}`} role="status" aria-live="polite">
          <span className="print-mark" aria-hidden>
            <svg viewBox="0 0 20 20" width="20" height="20"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="print-card-body">
            <p className="print-card-title">
              Sent to the printer <time dateTime={sent.at.toISOString()}>{format(sent.at, 'h:mm:ss a')}</time>
            </p>
            <p className="print-card-detail">
              {waiting ? <span className="print-pulse" aria-hidden /> : null}
              {job.detail}
            </p>
          </div>
        </div>
      ) : null}

      {print.isPending ? (
        <Button size="lg" block disabled aria-busy className="print-sending">
          <span className="print-spinner" aria-hidden />
          Sending to the printer…
        </Button>
      ) : failure ? (
        <Button size="lg" block onClick={tap} disabled={!canPrint}>
          Try again
        </Button>
      ) : sent ? (
        <Button variant="secondary" size="lg" block onClick={tap} disabled={!canPrint} className="print-again">
          <span>Print again</span>
          <span className="print-again-when">sent {formatSince(sent.at, now)}</span>
        </Button>
      ) : (
        <Button size="lg" block onClick={tap} disabled={!canPrint}>
          Print label
        </Button>
      )}
    </div>
  )
}
