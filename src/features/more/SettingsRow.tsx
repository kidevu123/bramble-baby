import type { ReactNode } from 'react'
import { ChevronRightIcon } from '../../components/icons'

/**
 * One row of a Settings list: an icon, a title, its state in a few words, and a chevron. A button that
 * opens a sheet, or (with `href`) a link that leaves the app. Used by the Settings page and by the lists
 * its sheets hold (Integrations), so a row looks the same at either level. Styled by more.css, which the
 * Settings page loads (not imported here: its place in the cascade is set there).
 */
export function SettingsRow({ icon, title, value, onClick, href }: { icon: ReactNode; title: string; value: string; onClick?: () => void; href?: string }) {
  const body = (
    <>
      <span className="settings-row-icon" aria-hidden>
        {icon}
      </span>
      <span className="grow settings-row-text">
        <span className="settings-row-title">{title}</span>
        <span className="small muted settings-row-value">{value}</span>
      </span>
      {href ? <ExternalIcon className="chev" /> : <ChevronRightIcon className="chev" aria-hidden />}
    </>
  )
  if (href) {
    return (
      <a className="settings-row" href={href} target="_blank" rel="noreferrer">
        {body}
      </a>
    )
  }
  return (
    <button type="button" className="settings-row" onClick={onClick}>
      {body}
    </button>
  )
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />
    </svg>
  )
}
