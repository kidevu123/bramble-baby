import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { TextField } from './Field'
import './qr-scanner.css'

interface Props {
  /** Called once with the decoded text; the scanner stops itself. */
  onDecode: (text: string) => void
  /** Validate before accepting; return null to keep scanning. */
  accept?: (text: string) => string | null
  onCancel: () => void
  hint?: string
}

/**
 * In-app QR scanner: the phone camera in a video element, frames decoded with jsQR (loaded on demand).
 * Runs inside the installed web app on iOS 14.3+ and Android. Scanning a label with the system Camera
 * app instead would open Safari, which is not signed in, so the scanner lives here.
 */
export function QrScanner({ onDecode, accept, onCancel, hint }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [starting, setStarting] = useState(true)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let done = false
    const canvas = document.createElement('canvas')
    const video = videoRef.current
    const stop = () => {
      done = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
    const run = async () => {
      if (!video) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot open the camera. Type the code from the label instead.')
        setStarting(false)
        return
      }
      let jsQR: typeof import('jsqr').default
      try {
        jsQR = (await import('jsqr')).default
      } catch {
        setError('Could not load the QR decoder. Type the code from the label instead.')
        setStarting(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        setError(name === 'NotAllowedError' ? 'Camera access was denied. Allow it in Settings → Bramble, or type the code from the label.' : 'Could not start the camera. Type the code from the label instead.')
        setStarting(false)
        return
      }
      if (done) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      await video.play().catch(() => undefined)
      setStarting(false)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const tick = () => {
        if (done) return
        if (video.readyState >= 2 && ctx) {
          // Decode a centred square crop at a modest resolution: fast enough for 30 fps on a phone.
          const side = Math.min(video.videoWidth, video.videoHeight)
          const target = 480
          canvas.width = target
          canvas.height = target
          ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, target, target)
          const img = ctx.getImageData(0, 0, target, target)
          const hit = jsQR(img.data, target, target, { inversionAttempts: 'dontInvert' })
          if (hit?.data) {
            const value = accept ? accept(hit.data) : hit.data
            if (value !== null) {
              stop()
              onDecode(value)
              return
            }
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    void run()
    return stop
  }, [accept, onDecode])

  const submitManual = () => {
    const value = accept ? accept(manual) : manual.trim()
    if (value === null || value === '') {
      setError('That is not a Bramble bag code. It is the six characters printed under the QR code.')
      return
    }
    onDecode(value)
  }

  return (
    <div className="qr-scanner stack">
      <div className={`qr-viewport${error ? ' unavailable' : ''}`}>
        <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        {!error ? <div className="qr-frame" aria-hidden /> : null}
        {starting && !error ? <p className="qr-status">Starting camera…</p> : null}
      </div>
      {!error ? (
        <p className="small muted" style={{ textAlign: 'center' }}>
          {hint ?? 'Point the camera at the QR code on the milk label.'}
        </p>
      ) : null}
      {error ? (
        <p className="log-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row">
        <TextField label="Or type the code" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="e.g. K7M2QP" maxLength={6} autoCapitalize="characters" />
        <Button variant="secondary" onClick={submitManual} disabled={manual.trim().length < 6}>
          Find
        </Button>
      </div>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
