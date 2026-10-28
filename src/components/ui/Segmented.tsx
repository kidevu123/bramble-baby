import './segmented.css'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  /** 'sm' is the compact type size for inline rows (Settings, chart toggles); both sizes are 44 px targets. */
  size?: 'md' | 'sm'
}

/**
 * One-of-N switch. Announced as a tab list with `aria-selected` everywhere it is used (view switchers and
 * value pickers alike), the same contract as the app's other tab rows.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md' }: Props<T>) {
  return (
    <div className={`segmented segmented-${size}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          className={o.value === value ? 'seg active' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
