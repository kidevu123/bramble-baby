import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrefsProvider } from '../../hooks/usePrefs'
import type { MilkBag } from '../../lib/api/companion'
import { StashPicker } from './StashPicker'

vi.mock('../../lib/api/companion', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api/companion')>()
  return { ...mod, companion: { ...mod.companion, milk: { ...mod.companion.milk, list: () => Promise.resolve([]), byCode: (code: string) => byCode(code) } } }
})
const byCode = vi.fn((_code: string): Promise<MilkBag> => Promise.reject(new Error('not found')))
const bagNamed = (code: string, expiresInHours: number): MilkBag =>
  ({ id: code === 'AAAAAA' ? 1 : 2, child: 1, code, pumped_at: new Date().toISOString(), volume_ml: 60, remaining_ml: 60, uses: [], location: 'fridge', thawed: false, expires_at: new Date(Date.now() + expiresInHours * 3600_000).toISOString(), status: 'stored', pumping_id: null, feeding_id: null, notes: '', created: '', created_by: null, used_at: null, used_by: null }) as MilkBag
vi.mock('jsqr', () => ({ default: () => null }))

/** The picker as a page renders it: the page re-renders on its own clock and query ticks. */
function Page() {
  const [tick, setTick] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setTick((t) => t + 1)}>
        tick {tick}
      </button>
      <StashPicker open child={1} unit="ml" onPick={() => undefined} onClose={() => undefined} />
    </>
  )
}

describe('StashPicker scanner', () => {
  const getUserMedia = vi.fn()
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false
    }
    getUserMedia.mockReset()
    getUserMedia.mockImplementation(() => Promise.resolve({ getTracks: () => [] }))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps the camera running while the page around it re-renders', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <PrefsProvider>
          <Page />
        </PrefsProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Scan the bag/ }))
    await act(async () => undefined)
    await act(async () => undefined)
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    // A minute tick or a query refetch re-renders the page; the scanner must not restart the camera.
    fireEvent.click(screen.getByRole('button', { name: /tick/ }))
    await act(async () => undefined)
    await act(async () => undefined)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('StashPicker scan rules', () => {
  const onPick = vi.fn()
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    onPick.mockReset()
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
  })
  async function scanCode(code: string, selected: number[]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <PrefsProvider>
          <StashPicker open child={1} unit="ml" selected={selected} onPick={onPick} onClose={() => undefined} />
        </PrefsProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Scan the bag/ }))
    await act(async () => undefined)
    fireEvent.change(screen.getByLabelText('Or type the code'), { target: { value: code } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    await act(async () => new Promise((r) => setTimeout(r, 10)))
  }

  it('refuses an expired bag with the same words as the list', async () => {
    byCode.mockImplementation(() => Promise.resolve(bagNamed('AAAAAA', -2)))
    await scanCode('AAAAAA', [])
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText(/Bag AAAAAA has expired/)).toBeTruthy()
  })

  it('keeps a bag already in the bottle when it is scanned again', async () => {
    byCode.mockImplementation(() => Promise.resolve(bagNamed('BBBBBB', 24)))
    await scanCode('BBBBBB', [2])
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText('Bag BBBBBB is already in this bottle.')).toBeTruthy()
  })

  it('starts the scanner again after a code the server does not know', async () => {
    byCode.mockImplementation(() => Promise.reject(new Error('No bag with that code')))
    await scanCode('CCCCCC', [])
    // The scanner was remounted: the typed code is cleared, ready for the next scan.
    expect((screen.getByLabelText('Or type the code') as HTMLInputElement).value).toBe('')
    expect(screen.getByText(/No bag with that code/)).toBeTruthy()
  })
})
