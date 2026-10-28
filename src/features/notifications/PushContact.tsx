import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { describeApiError } from '../../lib/api/client'
import { companion } from '../../lib/api/companion'
import { configKey, useServerConfig } from '../more/PrinterSetup'

/**
 * The email push services ask for (Apple refuses a placeholder): set by an admin of this Bramble here, instead
 * of on the server. Without one, no notification goes out, so the card says so while it is missing.
 */
export function PushContact() {
  const qc = useQueryClient()
  const config = useServerConfig()
  const [text, setText] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const save = useMutation({
    mutationFn: (value: string) => companion.config.update({ pushContact: value }),
    onSuccess: (next) => {
      qc.setQueryData(configKey, next)
      setText(null)
      setEditing(false)
    },
  })
  const data = config.data
  if (!data) return null
  const current = data.pushContact.value?.replace(/^mailto:/, '') ?? ''
  const missing = data.pushContact.source === 'none'
  if (!data.admin && !missing) return null
  if (!missing && !editing) {
    // Set: one quiet line, so the reminders stay at the top of the sheet.
    return (
      <p className="small muted push-contact-line" data-testid="push-contact">
        Push contact: {current}
        {data.pushContact.source === 'server' ? ' (set on the server)' : ''}{' '}
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>
          Change
        </button>
      </p>
    )
  }
  return (
    <section className={`card card-pad stack push-contact${missing ? ' is-missing' : ''}`} aria-label="Push contact" data-testid="push-contact">
      <span className="strong">Push contact</span>
      <span className="small muted">
        {missing
          ? 'Notifications need a contact email for the push services (Apple refuses a made-up one). Until it is set, nothing is sent.'
          : `Push services see ${current}${data.pushContact.source === 'server' ? ' (set on the server)' : ''}. It is never shown to anyone else.`}
      </span>
      {data.admin ? (
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (text !== null && text.trim()) save.mutate(text.trim())
          }}
        >
          <TextField label="Contact email" type="email" inputMode="email" autoCapitalize="none" value={text ?? current} onChange={(e) => setText(e.target.value)} placeholder="you@example.com" />
          {save.isError ? (
            <p className="log-error" role="alert">
              {describeApiError(save.error)}
            </p>
          ) : null}
          <Button type="submit" variant="secondary" loading={save.isPending} disabled={text === null || !text.trim() || text.trim() === current}>
            Save contact
          </Button>
        </form>
      ) : (
        <span className="xs muted">An admin of this Bramble sets it here.</span>
      )}
    </section>
  )
}
