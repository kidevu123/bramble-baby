import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MilkBag } from '../lib/api/companion'
import type { Child, Pumping } from '../lib/api/types'
import { useAutoPrint } from './useAutoPrint'
import { PrefsProvider } from './usePrefs'

const list = vi.fn<(child: number) => Promise<MilkBag[]>>()
const create = vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 5, code: 'NEWBAG', ...body } as unknown as MilkBag))
vi.mock('../lib/api/companion', async (orig) => {
  const mod = await orig<typeof import('../lib/api/companion')>()
  return {
    ...mod,
    companion: {
      ...mod.companion,
      settings: { ...mod.companion.settings, get: () => Promise.resolve({}), put: () => Promise.resolve({}) },
      print: { ...mod.companion.print, status: () => Promise.resolve({ configured: false }) },
      milk: { ...mod.companion.milk, list: (child: number) => list(child), create: (body: Record<string, unknown>) => create(body) },
    },
  }
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <PrefsProvider>{children}</PrefsProvider>
    </QueryClientProvider>
  )
}

const child = { id: 31, first_name: 'Ivy', birth_date: '2026-09-01' } as unknown as Child
const saved = { id: 77, child: 31, start: new Date(Date.now() - 1_800_000).toISOString(), end: new Date().toISOString(), amount: 60, notes: '', tags: [] } as unknown as Pumping
const held = { id: 1, child: 31, code: 'OLDBAG', status: 'used' } as unknown as MilkBag

describe('useAutoPrint: the milk of a saved session, with no sticker printing', () => {
  beforeEach(() => {
    localStorage.clear()
    list.mockReset()
    create.mockClear()
  })

  it('asks the stash when its listing has not answered yet, instead of taking silence for "no stash" (sweep 2026-11-24)', async () => {
    // The sheet's own listing is still on its way when Save is tapped; the household has kept a stash for months.
    list.mockImplementationOnce(() => new Promise(() => undefined))
    list.mockResolvedValue([held])
    const { result } = renderHook(() => useAutoPrint(child.id), { wrapper })
    await act(() => result.current.run(child, saved, 60, { editing: false, bag: null, location: 'fridge' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ child: 31, pumping_id: 77, location: 'fridge' })
  })

  it('makes no bag for a household that has never kept a stash, or when the stash cannot be reached', async () => {
    list.mockImplementationOnce(() => new Promise(() => undefined))
    list.mockResolvedValueOnce([])
    const { result } = renderHook(() => useAutoPrint(child.id), { wrapper })
    await act(() => result.current.run(child, saved, 60, { editing: false, bag: null }))
    list.mockRejectedValueOnce(new Error('offline'))
    await act(() => result.current.run(child, saved, 60, { editing: false, bag: null }))
    expect(create).not.toHaveBeenCalled()
  })

  it('uses the listing it already has', async () => {
    list.mockResolvedValue([held])
    const { result } = renderHook(() => useAutoPrint(child.id), { wrapper })
    await waitFor(() => expect(result.current.stashes).toBe(true))
    list.mockClear()
    create.mockImplementationOnce((body) => {
      expect(list).not.toHaveBeenCalled() // no second question before the bag is made (the listing is read again after)
      return Promise.resolve({ id: 5, code: 'NEWBAG', ...body } as unknown as MilkBag)
    })
    await act(() => result.current.run(child, saved, 60, { editing: false, bag: null }))
    expect(create).toHaveBeenCalledTimes(1)
  })
})
