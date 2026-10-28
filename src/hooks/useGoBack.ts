import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * "Back" means where the user came from. Pages reached from the top bar, a band or a tile (Settings,
 * Insights, nap window, a timer, Contractions) pop the history entry they pushed; a page opened cold
 * (a fresh PWA launch on a deep link) has nowhere to go back to and lands on Home instead.
 */
export function useGoBack() {
  const navigate = useNavigate()
  return useCallback(() => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/')
  }, [navigate])
}
