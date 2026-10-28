import type { Child } from '../../lib/api/types'
import './avatar.css'

const palette = ['var(--teal)', 'var(--orange)', 'var(--purple)', 'var(--green)', 'var(--pink)']

export function Avatar({ child, size = 40 }: { child: Child; size?: number }) {
  const initial = child.first_name.trim().charAt(0).toUpperCase() || '?'
  const bg = palette[child.id % palette.length]
  const style = { width: size, height: size, fontSize: size * 0.45, background: child.picture ? undefined : bg }
  return (
    <span className="avatar" style={style} aria-hidden>
      {child.picture ? <img src={child.picture} alt="" /> : initial}
    </span>
  )
}
