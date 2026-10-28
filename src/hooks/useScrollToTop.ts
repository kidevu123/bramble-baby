import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * A page opened by a tap (a tab, the top bar, a band) starts at its top. The window keeps its scroll
 * offset across route changes otherwise, so Reports opened after scrolling Home came up with its view
 * switcher already pushed out of sight. Back (a POP) is left alone: the browser restores where you were.
 */
export function useScrollToTop() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  useEffect(() => {
    if (navigationType === 'POP') return
    window.scrollTo(0, 0)
  }, [pathname, navigationType])
}
