import { Logo } from '../icons'
import './splash.css'

export function Splash({ message }: { message?: string }) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <Logo className="splash-logo" />
      <p className="muted small">{message ?? 'Loading…'}</p>
    </div>
  )
}
