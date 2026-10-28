import { useState, type FormEvent } from 'react'
import { parseQuickText, QUICK_EXAMPLES, type QuickPrefill } from '../../lib/quick-text'
import type { UnitPrefs } from '../../lib/units'

/**
 * Home › "Type it": one line ("60 ml bottle 3pm", "wet diaper", "pump 90") opens the matching log sheet with
 * its fields filled in. The line under the field says what was understood before anything opens; nothing is
 * saved from here, the sheet's Save is still the only way an entry lands.
 */
export function QuickType({ units, onOpen }: { units: UnitPrefs; onOpen: (prefill: QuickPrefill) => void }) {
  const [text, setText] = useState('')
  const [missed, setMissed] = useState<string | null>(null)
  // The examples show while the field is in use; an idle Home keeps just the placeholder's one example.
  const [focused, setFocused] = useState(false)
  const parsed = text.trim() ? parseQuickText(text, units) : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const now = text.trim() ? parseQuickText(text, units) : null
    if (!now) {
      if (text.trim()) setMissed(text.trim())
      return
    }
    onOpen(now.prefill)
    setText('')
    setMissed(null)
  }
  const hint = parsed ? `${parsed.summary} · opens the sheet to check and save` : missed && missed === text.trim() ? `Did not get "${missed}". Try: ${QUICK_EXAMPLES.join(' · ')}` : `Try: ${QUICK_EXAMPLES.join(' · ')}`
  return (
    <form className="quick-type" onSubmit={submit} data-testid="quick-type">
      <div className="quick-type-row">
        <input
          className="text-input quick-type-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          enterKeyHint="go"
          aria-label="Type what to log"
          placeholder="Type it: 60 ml bottle 3pm"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value)
            if (missed) setMissed(null)
          }}
        />
        <button type="submit" className={`quick-type-go${parsed ? '' : ' idle'}`} aria-label="Open the sheet for what was typed">
          Go
        </button>
      </div>
      {focused || text.trim() || missed ? (
        <p className={`xs quick-type-hint${parsed ? ' got' : missed ? ' missed' : ''}`} data-testid="quick-type-hint" aria-live="polite">
          {hint}
        </p>
      ) : null}
    </form>
  )
}
