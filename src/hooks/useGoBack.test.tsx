import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useGoBack } from './useGoBack'

function Probe() {
  const goBack = useGoBack()
  const location = useLocation()
  return (
    <>
      <span data-testid="path">{location.pathname}</span>
      <button type="button" onClick={goBack}>
        back
      </button>
    </>
  )
}

// The hook reads the browser's history length; the router it drives is in memory, so stub the length.
function setHistoryLength(n: number) {
  Object.defineProperty(window.history, 'length', { value: n, configurable: true })
}

describe('useGoBack', () => {
  afterEach(() => {
    delete (window.history as unknown as { length?: number }).length
  })

  it('pops history when the page was reached from inside the app', async () => {
    setHistoryLength(2)
    render(
      <MemoryRouter initialEntries={['/reports', '/settings']} initialIndex={1}>
        <Probe />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('path').textContent).toBe('/settings')
    await act(async () => screen.getByText('back').click())
    expect(screen.getByTestId('path').textContent).toBe('/reports')
  })

  it('falls back to Home on a cold start with nothing to go back to', async () => {
    setHistoryLength(1)
    render(
      <MemoryRouter initialEntries={['/contractions']}>
        <Probe />
      </MemoryRouter>,
    )
    await act(async () => screen.getByText('back').click())
    expect(screen.getByTestId('path').textContent).toBe('/')
  })
})
