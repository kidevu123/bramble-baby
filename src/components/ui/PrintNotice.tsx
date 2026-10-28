import { useEffect, useState } from 'react'
import { PRINT_JOB_POLL_LIMIT_MS, usePrintJob } from '../../hooks/useMilk'
import { printJobTone } from '../../lib/print'
import { currentPrintNotice, dismissPrintNotice, subscribePrintNotice, type PrintNotice as Notice } from '../../lib/print-notice'
import './print-notice.css'

/**
 * The one-line bar for a label printing on its own after a pumping was saved: "Printing label…", then
 * what the printer answered, or why it did not go. Good news leaves by itself; a problem stays until
 * dismissed. Lives above the tab bar on every page, because the sheet that started it has closed.
 */
export function PrintNotice() {
  const [notice, setNotice] = useState<Notice | null>(() => currentPrintNotice())
  useEffect(() => subscribePrintNotice(setNotice), [])
  const followed = usePrintJob(notice?.job ?? null)
  const job = followed.data ?? notice?.job ?? null
  const tone = notice?.state === 'failed' ? 'failed' : notice?.state === 'sending' ? 'waiting' : job ? printJobTone(job) : 'good'
  // Good news leaves by itself once the printer's answer is in; anything that needs a hand stays.
  // A print the phone stopped following (the companion listened longer than the phone polls) settles too.
  useEffect(() => {
    if (!notice || notice.state !== 'sent' || tone === 'problem' || tone === 'failed') return
    const id = notice.id
    const t = setTimeout(() => dismissPrintNotice(id), tone === 'good' && !job?.checking ? 7000 : PRINT_JOB_POLL_LIMIT_MS + 5000)
    return () => clearTimeout(t)
  }, [notice, tone, job?.checking])
  if (!notice) return null
  // "60 mL" and "ID T6NMZC" never break across lines.
  const vol = notice.volumeText.replace(/ /g, '\u00a0')
  const id = notice.bagCode ? `ID\u00a0${notice.bagCode}` : ''
  const headline =
    notice.state === 'sending'
      ? `Printing label · ${vol}${id ? ` · ${id}` : ''}`
      : notice.state === 'failed'
        ? `Could not print the label for ${vol}`
        : `Label sent to the printer · ${vol} · ${id}`
  const detail = notice.state === 'failed' ? notice.error : job?.detail ?? null
  return (
    <div className={`print-notice tone-${tone}`} role={tone === 'failed' || tone === 'problem' ? 'alert' : 'status'} data-testid="print-notice">
      <span className="print-notice-dot" aria-hidden />
      <span className="print-notice-text">
        <span className="print-notice-head">{headline}</span>
        {detail ? <span className="print-notice-detail">{detail}</span> : null}
        {notice.state === 'failed' ? <span className="print-notice-detail">The entry is saved; open it from the timeline and tap Print milk label to try again.</span> : null}
      </span>
      <button type="button" onClick={() => dismissPrintNotice(notice.id)} aria-label="Dismiss">
        OK
      </button>
    </div>
  )
}
