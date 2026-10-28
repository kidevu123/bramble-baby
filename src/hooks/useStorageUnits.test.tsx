import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChildSettings } from './useChildSettings'
import { usePrefs, PrefsProvider } from './usePrefs'
import { useStorageUnits } from './useStorageUnits'

const get = vi.fn()
const put = vi.fn()
vi.mock('../lib/api/companion', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/api/companion')>()
  return { ...mod, companion: { ...mod.companion, settings: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } } }
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <PrefsProvider>{children}</PrefsProvider>
    </QueryClientProvider>
  )
}

const ML_HOUSEHOLD = { volume: 'ml', temp: 'f', weight: 'lb', length: 'in' } as const

describe('useStorageUnits', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear() // the local copy must not leak between cases (no-op where jsdom has no storage)
    } catch {
      /* no storage in this runtime */
    }
    get.mockReset()
    put.mockReset()
    put.mockResolvedValue({})
  })

  it('uses the storage units the household recorded', async () => {
    get.mockResolvedValue({ storageUnits: ML_HOUSEHOLD })
    const { result } = renderHook(() => useStorageUnits(6), { wrapper })
    await waitFor(() => expect(result.current).toEqual(ML_HOUSEHOLD))
  })

  it('never guesses this phone’s units while the household copy has not been seen', async () => {
    // A fresh phone whose companion is unreachable: there is no local copy to fall back on, and the phone
    // displays oz. Guessing oz here would show the household’s mL numbers as oz and write bottles in oz.
    get.mockRejectedValue(new TypeError('Failed to fetch'))
    // A child this session has never fetched (what the companion answered for is remembered per child).
    const { result } = renderHook(() => ({ units: useStorageUnits(7), settings: useChildSettings(7) }), { wrapper })
    await waitFor(() => expect(result.current.settings.isLoaded).toBe(true))
    expect(result.current.units).toBeNull()
  })

  it('seeds a legacy household from this phone only once the companion has answered', async () => {
    get.mockResolvedValue({})
    const { result } = renderHook(() => ({ units: useStorageUnits(8), prefs: usePrefs().prefs.units }), { wrapper })
    await waitFor(() => expect(result.current.units).not.toBeNull())
    expect(result.current.units).toEqual(result.current.prefs)
  })
})
