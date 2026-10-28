import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrefsProvider } from '../../hooks/usePrefs'
import type { MilkBag } from '../../lib/api/companion'
import { MilkLabelSheet } from './MilkLabelSheet'

const create = vi.fn()
const drawn: { amount: number | null; code?: string | null }[] = []
vi.mock('../../lib/labels', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/labels')>()
  return {
    ...mod,
    drawLabel: (_c: unknown, input: { amount: number | null; code?: string | null }) => {
      drawn.push({ amount: input.amount, code: input.code })
      return false
    },
  }
})
vi.mock('../../lib/api/companion', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api/companion')>()
  return {
    ...mod,
    companion: {
      ...mod.companion,
      milk: { ...mod.companion.milk, create: (...args: unknown[]) => create(...args) },
      print: { ...mod.companion.print, status: () => Promise.resolve({ configured: false, kind: null, detail: null }) },
    },
  }
})
// The nested settings sheet needs the child provider and the printer query; it is not under test here.
vi.mock('../more/LabelSettingsSheet', () => ({ LabelSettingsSheet: () => null }))

const bag = (volume_ml: number): MilkBag => ({
  id: 1, child: 1, code: 'ABC234', pumped_at: '2026-10-06T12:00:00+00:00', volume_ml, remaining_ml: volume_ml, uses: [], location: 'fridge', thawed: false,
  expires_at: '2026-10-10T12:00:00+00:00', status: 'stored', pumping_id: null, feeding_id: null, notes: '', created: '', created_by: null, used_at: null, used_by: null,
})

function mount(amount: number | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PrefsProvider>
        <MilkLabelSheet open child={1} pumpingId={null} input={{ childName: 'Ivy', pumpedAt: new Date('2026-10-06T12:00:00Z'), amount, unit: 'ml' }} onClose={() => undefined} />
      </PrefsProvider>
    </QueryClientProvider>,
  )
}

describe('MilkLabelSheet: volume typed in the label sheet (pumping path)', () => {
  beforeEach(() => {
    // jsdom has no <dialog> implementation; the sheet only needs open/close to work.
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false
    }
    // No canvas in jsdom: the preview reports it cannot draw, which is fine for what is under test.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null as never)
    create.mockReset()
    create.mockImplementation((body: { volume_ml: number }) => Promise.resolve(bag(body.volume_ml)))
  })
  afterEach(() => vi.restoreAllMocks())

  it('registers the bag with the whole volume the owner typed, not the first keystroke', async () => {
    mount(null)
    // Typing "120" on a phone arrives one digit at a time.
    for (const partial of ['1', '12', '120']) {
      fireEvent.change(screen.getByLabelText('Volume in mL'), { target: { value: partial } })
      await act(async () => undefined)
    }
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Volume in mL')).toHaveValue(120)

    fireEvent.click(screen.getByRole('button', { name: 'Add to stash' }))
    await act(async () => undefined)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ child: 1, volume_ml: 120, location: 'fridge' })
    await screen.findByText(/Bag ABC234/)
  })

  it('registers straight away when the caller already knows the volume', async () => {
    mount(90)
    await act(async () => undefined)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ volume_ml: 90 })
    expect(screen.queryByLabelText('Volume in mL')).toBeNull()
  })
})

describe('MilkLabelSheet: a bag already exists', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false
    }
    drawn.length = 0
  })

  it('prints what the bag holds, not a volume typed since, and says saving corrects the bag', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <PrefsProvider>
          {/* The pumping sheet registered the bag at 60 mL, then its Volume field was changed to 100. */}
          <MilkLabelSheet open child={1} pumpingId={null} bag={bag(60)} input={{ childName: 'Ivy', pumpedAt: new Date('2026-10-06T12:00:00Z'), amount: 100, unit: 'ml' }} onClose={() => undefined} />
        </PrefsProvider>
      </QueryClientProvider>,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const last = drawn[drawn.length - 1]
    expect(last).toEqual({ amount: 60, code: 'ABC234' })
    expect(screen.getByText(/This label prints what bag ABC234 holds: 60 mL/)).toBeTruthy()
    expect(screen.getByText(/Save the pumping entry and the bag follows it \(100 mL/)).toBeTruthy()
  })
})
