import type { ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { TrashIcon } from '../../components/icons'

export function SheetFooter({
  onSave,
  onDelete,
  busy,
  error,
  disabled,
  label = 'Save',
  note,
  extra,
}: {
  onSave: () => void
  onDelete?: () => void
  busy: boolean
  error: string | null
  disabled?: boolean
  label?: string
  /** What saving will do, in words, right above the button (a bottle from the stash: what it takes and what stays). */
  note?: ReactNode
  /** A second action that belongs beside Save (the pumping sheet's milk label), between Delete and Save. */
  extra?: ReactNode
}) {
  return (
    <div className="stack sheet-save" style={{ width: '100%' }}>
      {note}
      {error ? (
        <p className="log-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row">
        {onDelete ? (
          <Button variant="danger" size="lg" className="sheet-delete" onClick={onDelete} disabled={busy} aria-label="Delete entry">
            <TrashIcon style={{ width: 20, height: 20 }} />
          </Button>
        ) : null}
        {extra}
        <Button size="lg" block onClick={onSave} loading={busy} disabled={disabled}>
          {label}
        </Button>
      </div>
    </div>
  )
}
