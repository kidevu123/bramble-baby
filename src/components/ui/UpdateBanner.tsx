import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateReady } from '../../lib/update'
import './update-banner.css'

/** One-line bar above the tab bar when a newer build has downloaded. Tapping swaps it in and reloads. */
export function UpdateBanner() {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => onUpdateReady(setReady), [])
  if (!ready) return null
  return (
    <div className="update-banner" role="status">
      <span>A new version of Bramble is ready.</span>
      <button
        type="button"
        onClick={() => {
          setBusy(true)
          applyUpdate().catch(() => window.location.reload())
          // If the swap stalls (iOS sometimes needs a full relaunch), give the tap back after a few seconds.
          setTimeout(() => setBusy(false), 8000)
        }}
        disabled={busy}
      >
        {busy ? 'Updating…' : 'Update'}
      </button>
    </div>
  )
}
