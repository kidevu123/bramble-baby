import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { NoteField, TimePair, ValueField } from './LogFields'

function Note({ initial }: { initial: string }) {
  const [v, setV] = useState(initial)
  return <NoteField value={v} onChange={setV} />
}

describe('NoteField', () => {
  it('is one quiet line while empty, and opens to the field on a tap', () => {
    render(<Note initial="" />)
    expect(screen.queryByLabelText('Notes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Add a note' }))
    const field = screen.getByLabelText('Notes') as HTMLTextAreaElement
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'slow left side' } })
    expect(field.value).toBe('slow left side')
  })

  it('opens at once when the entry already has a note', () => {
    render(<Note initial="Took it slowly" />)
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Took it slowly')
    expect(screen.queryByRole('button', { name: '+ Add a note' })).toBeNull()
  })

  it('stays open when the note is cleared while typing', () => {
    render(<Note initial="x" />)
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } })
    expect(screen.getByLabelText('Notes')).toBeTruthy()
  })
})

describe('ValueField', () => {
  it('names the input with its unit for screen readers and probes', () => {
    render(<ValueField label="Volume" unit="mL" name="Volume in mL" type="number" defaultValue="60" />)
    expect((screen.getByLabelText('Volume in mL') as HTMLInputElement).value).toBe('60')
  })
})

describe('TimePair', () => {
  it('shows both times, the length between them, and the chips only when asked', () => {
    const start = new Date(2026, 9, 11, 10, 0)
    const end = new Date(2026, 9, 11, 10, 25)
    const { rerender } = render(<TimePair startLabel="Started:" endLabel="Finished:" start={start} end={end} onStart={() => undefined} onEnd={() => undefined} />)
    expect(screen.getByLabelText('Started:')).toBeTruthy()
    expect(screen.getByLabelText('Finished:')).toBeTruthy()
    expect(screen.getByText('25m')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Just now' })).toBeNull()
    rerender(<TimePair startLabel="Started:" endLabel="Finished:" start={start} end={end} onStart={() => undefined} onEnd={() => undefined} quick={() => undefined} showLength={false} hint="Like the last session" />)
    expect(screen.getByRole('button', { name: '1 h ago' })).toBeTruthy()
    expect(screen.queryByText('25m')).toBeNull()
    expect(screen.getByText('Like the last session')).toBeTruthy()
  })
})
