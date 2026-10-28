import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useScrollToTop } from './useScrollToTop'

function Probe() {
  useScrollToTop()
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/reports')}>
        reports
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    </>
  )
}

describe('useScrollToTop', () => {
  beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined))
  afterEach(() => vi.restoreAllMocks())

  it('starts a page opened by a tap at the top, and leaves Back where it was', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe />
      </MemoryRouter>,
    )
    vi.mocked(window.scrollTo).mockClear()
    await act(async () => screen.getByText('reports').click())
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
    vi.mocked(window.scrollTo).mockClear()
    await act(async () => screen.getByText('back').click())
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
