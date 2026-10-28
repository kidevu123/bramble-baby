import type { ReactNode } from 'react'
import { ChevronDownIcon, InfoIcon } from '../icons'
import './about.css'

/**
 * How to read a chart or a number, folded away at the bottom of its card: the card shows the data, one tap
 * here shows the explanation (the pattern Apple Health uses under its charts). Closed by default.
 */
export function About({ children, label = 'About this chart', testId }: { children: ReactNode; label?: string; testId?: string }) {
  return (
    <details className="about" data-testid={testId}>
      <summary className="about-summary">
        <InfoIcon className="about-icon" />
        <span className="grow">{label}</span>
        <ChevronDownIcon className="about-chev" />
      </summary>
      <div className="about-body">{children}</div>
    </details>
  )
}
