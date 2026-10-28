import { Logo } from '../icons'
import { Button } from './Button'
import './splash.css'

/** Full-screen, plain-language failure with a retry, used where a redirect would loop or mislead. */
export function ErrorScreen({ title, message, onRetry, onSignOut }: { title: string; message: string; onRetry: () => void; onSignOut?: () => void }) {
  return (
    <div className="splash" role="alert">
      <Logo className="splash-logo" />
      <p className="strong">{title}</p>
      <p className="muted small" style={{ maxWidth: 320, textAlign: 'center' }}>
        {message}
      </p>
      <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 8 }}>
        <Button onClick={onRetry}>Try again</Button>
        {onSignOut ? (
          <Button variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
        ) : null}
      </div>
    </div>
  )
}
