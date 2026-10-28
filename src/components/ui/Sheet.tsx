import { useEffect, useRef, type ReactNode } from 'react'
import { CloseIcon } from '../icons'
import { markSheetClosed } from './sheet-state'
import './sheet.css'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  action?: ReactNode
}

/** Full-height modal sheet, like the "Add …" screens of the usual baby apps (X left, title centered, action right). */
export function Sheet({ open, title, onClose, children, footer, action }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      // React's autoFocus fires before the dialog is shown (a no-op) and never writes the attribute, so
      // fields that want focus mark themselves with data-autofocus and the sheet focuses them here.
      const target = el.querySelector<HTMLElement>('[data-autofocus]')
      if (target) requestAnimationFrame(() => target.focus())
    }
    if (!open && el.open) {
      el.close()
      markSheetClosed()
    }
  }, [open])

  // iPhone: the on-screen keyboard shrinks the visible area but not the dialog, so the bottom of a long sheet (the
  // bottle sheet's time and Save) sat under the keyboard where no scroll could reach it. While open, the sheet is
  // sized to the visual viewport, so its body scrolls everything into view above the keyboard.
  useEffect(() => {
    const el = ref.current
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!el || !vv || !open) return
    const fit = () => {
      const covered = window.innerHeight - vv.height > 1
      el.style.height = covered ? `${vv.height}px` : ''
      el.style.top = covered ? `${vv.offsetTop}px` : ''
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
      el.style.height = ''
      el.style.top = ''
    }
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [onClose])

  return (
    <dialog ref={ref} className="sheet" aria-label={title}>
      <header className="sheet-head">
        <button type="button" className="sheet-icon-btn" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
        <h2 className="sheet-title">{title}</h2>
        <div className="sheet-action">{action}</div>
      </header>
      <div className="sheet-body">{open ? children : null}</div>
      {footer ? <footer className="sheet-foot">{footer}</footer> : null}
    </dialog>
  )
}
