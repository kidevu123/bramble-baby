import './toggle.css'

/** iOS-style switch: a 56 × 32 track inside a 56 × 44 button, so the whole tap target is 44 px tall. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={checked ? 'toggle on' : 'toggle'} onClick={() => onChange(!checked)}>
      <span className="toggle-track" aria-hidden>
        <span className="toggle-knob" />
      </span>
    </button>
  )
}
