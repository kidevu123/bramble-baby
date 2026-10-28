import { useGoBack } from '../../hooks/useGoBack'
import { ChevronLeftIcon } from '../icons'
import './nav.css'

/**
 * The one Back control: a round 44 px button with a chevron, the same on every page that has one (top-bar
 * pages, Settings, timers, Contractions). It goes where the user came from (`useGoBack`) unless the page
 * passes its own `onClick` (a timer that has to decide what leaving means).
 */
export function BackButton({ onClick, className }: { onClick?: () => void; className?: string }) {
  const goBack = useGoBack()
  return (
    <button type="button" className={className ? `back-btn ${className}` : 'back-btn'} onClick={onClick ?? goBack} aria-label="Back">
      <ChevronLeftIcon />
    </button>
  )
}
