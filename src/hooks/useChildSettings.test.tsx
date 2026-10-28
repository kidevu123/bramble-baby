import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChildSettings } from './useChildSettings'

const get = vi.fn()
const put = vi.fn()
vi.mock('../lib/api/companion', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/api/companion')>()
  return { ...mod, companion: { ...mod.companion, settings: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } } }
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useChildSettings.update', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear()
    } catch {
      /* no storage in this runtime */
    }
    get.mockReset()
    put.mockReset()
    put.mockResolvedValue({})
  })

  it('sends only the changed keys, and two quick updates both land', async () => {
    get.mockResolvedValue({ sex: 'female', weightGoalGPerDay: 20 })
    const { result } = renderHook(() => useChildSettings(11), { wrapper })
    await waitFor(() => expect(result.current.isLoaded).toBe(true))
    act(() => {
      // the same render's `update`, twice in one tick: the second must not drop the first
      result.current.update({ stashGoalDays: 10 })
      result.current.update({ weightGoalGPerDay: 25 })
    })
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put).toHaveBeenNthCalledWith(1, 11, { stashGoalDays: 10 })
    expect(put).toHaveBeenNthCalledWith(2, 11, { weightGoalGPerDay: 25 })
    expect(result.current.settings).toMatchObject({ sex: 'female', stashGoalDays: 10, weightGoalGPerDay: 25 })
  })

  it('reads the shared copy before the first change on a phone still showing its defaults', async () => {
    let answer: (v: unknown) => void = () => {}
    get.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useChildSettings(12), { wrapper })
    act(() => result.current.update({ stashGoalDays: 5 }))
    expect(put).not.toHaveBeenCalled()
    answer({ sex: 'male' })
    await waitFor(() => expect(put).toHaveBeenCalledWith(12, { stashGoalDays: 5 }))
    await waitFor(() => expect(result.current.settings).toMatchObject({ sex: 'male', stashGoalDays: 5 }))
  })

  it('a change the companion did not take (a restart, offline) is sent again on the next read, not undone by it', async () => {
    // sweep 2026-10-21: the PUT failed silently and the next refetch put the old value back
    get.mockResolvedValue({ pumps: [{ name: 'Medela', minutes: 20 }] })
    put.mockRejectedValueOnce(new Error('502'))
    const { result } = renderHook(() => useChildSettings(13), { wrapper })
    await waitFor(() => expect(result.current.isLoaded).toBe(true))
    act(() => result.current.update({ pumps: [{ name: 'Medela', minutes: 20 }, { name: 'Eufy', minutes: 30 }] }))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    // the next read still answers the old list: the change goes out again and stays on screen
    const { result: again } = renderHook(() => useChildSettings(13), { wrapper })
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put).toHaveBeenLastCalledWith(13, { pumps: [{ name: 'Medela', minutes: 20 }, { name: 'Eufy', minutes: 30 }] })
    await waitFor(() => expect(again.current.settings.pumps?.map((p) => p.name)).toEqual(['Medela', 'Eufy']))
  })
})
