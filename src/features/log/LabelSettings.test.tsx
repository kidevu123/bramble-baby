import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PrefsProvider } from '../../hooks/usePrefs'
import { LabelSettings } from './LabelSettings'

const stored = () => JSON.parse(localStorage.getItem('bramble.prefs') ?? '{}').labels ?? {}

describe('Settings › Milk labels › Storage windows', () => {
  beforeEach(() => localStorage.removeItem('bramble.prefs'))

  it('can be cleared and retyped like any field: 4 days becomes 3, not 14', () => {
    render(
      <PrefsProvider>
        <LabelSettings unit="ml" />
      </PrefsProvider>,
    )
    const fridge = screen.getByLabelText('Fridge (days)') as HTMLInputElement
    expect(fridge.value).toBe('4')
    fireEvent.change(fridge, { target: { value: '' } }) // backspace
    expect(fridge.value).toBe('')
    fireEvent.change(fridge, { target: { value: '3' } })
    expect(fridge.value).toBe('3')
    expect(stored().fridgeDays ?? 4).toBe(4) // nothing saved mid-edit
    fireEvent.blur(fridge)
    expect(stored().fridgeDays).toBe(3)
  })

  it('never stores an out-of-range window: leaving the field puts the saved value back and says why', () => {
    render(
      <PrefsProvider>
        <LabelSettings unit="ml" />
      </PrefsProvider>,
    )
    const room = screen.getByLabelText('Room (hours)') as HTMLInputElement
    fireEvent.change(room, { target: { value: '46' } })
    expect(screen.getByText('1–24 hours')).toBeTruthy()
    fireEvent.blur(room)
    expect(room.value).toBe('4')
    expect(stored().roomHours ?? 4).toBe(4)
    expect(screen.getByRole('alert').textContent).toMatch(/Room takes 1–24 hours; kept 4/)
  })
})
