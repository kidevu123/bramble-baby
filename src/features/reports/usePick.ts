import { useEffect, useRef, useState } from 'react'

/**
 * Tap or slide along a chart to pick the nearest column; a second tap on it, a tap anywhere else or Escape puts it
 * away; arrow keys, Home and End move it. Shared by the line and bar charts so every chart answers a tap the same way.
 */
export function usePick(count: number, nearest: (viewX: number) => number, viewW: number) {
  const [sel, setSel] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  // A tap anywhere outside the chart puts the readout away.
  useEffect(() => {
    if (sel === null) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setSel(null)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [sel])
  const picked = sel !== null && sel < count ? sel : null
  const pickAt = (clientX: number, toggle = false) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || box.width === 0 || count === 0) return
    const best = nearest(((clientX - box.left) / box.width) * viewW)
    // A second tap on the one already open closes it.
    setSel((was) => (toggle && was === best ? null : best))
  }
  const handlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      // No focus ring for a finger or a mouse (the keyboard still gets one through Tab).
      e.preventDefault()
      dragging.current = true
      pickAt(e.clientX, true)
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragging.current) pickAt(e.clientX)
    },
    onPointerUp: () => {
      dragging.current = false
    },
    onPointerCancel: () => {
      dragging.current = false
    },
    onKeyDown: (e: React.KeyboardEvent<SVGSVGElement>) => {
      const at = picked ?? count
      if (e.key === 'ArrowLeft') setSel(Math.max(0, at - 1))
      else if (e.key === 'ArrowRight') setSel(Math.min(count - 1, picked === null ? count - 1 : at + 1))
      else if (e.key === 'Home') setSel(0)
      else if (e.key === 'End') setSel(count - 1)
      else if (e.key === 'Escape') setSel(null)
      else return
      e.preventDefault()
    },
  }
  return { ref, picked, handlers }
}
