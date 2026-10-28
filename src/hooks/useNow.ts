import { useEffect, useState } from 'react'

/** A ticking clock. Pauses when the tab is hidden to save battery. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let id: number | undefined
    const start = () => {
      stop()
      setNow(new Date())
      id = window.setInterval(() => setNow(new Date()), intervalMs)
    }
    const stop = () => {
      if (id) window.clearInterval(id)
      id = undefined
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
  return now
}
