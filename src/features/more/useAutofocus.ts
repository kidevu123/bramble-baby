import { useEffect, type RefObject } from 'react'

/**
 * Sheet focuses `[data-autofocus]` once, when the dialog opens. A form that appears later inside an open
 * sheet (the sign-in form once the status answers, the emailed-code field after the password went through)
 * focuses its own marked field when it mounts.
 */
export function useAutofocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const field = ref.current?.querySelector<HTMLElement>('[data-autofocus]')
    if (!field || !field.closest('dialog')?.open) return
    const id = requestAnimationFrame(() => field.focus())
    return () => cancelAnimationFrame(id)
  }, [ref])
}
