import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrefsProvider } from '../../hooks/usePrefs'
import type { FeedingTakes, MilkBag } from '../../lib/api/companion'
import type { Child, Feeding, Timer } from '../../lib/api/types'
import { FeedingSheet, fillAmount } from './FeedingSheet'

const timers: Timer[] = []
const create = vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 11, ...body }))
const update = vi.fn((id: number, body: Record<string, unknown>) => Promise.resolve({ id, ...body }))
const remove = vi.fn((_id: number) => Promise.resolve())
const setTakes = vi.fn((_id: number, _takes: unknown[]) => Promise.resolve({ bag: null, use: null, takes: [], total_ml: 0 }))
let forFeeding: () => Promise<FeedingTakes> = () => new Promise(() => undefined)

vi.mock('../../hooks/useEvents', async (orig) => {
  const mod = await orig<typeof import('../../hooks/useEvents')>()
  return { ...mod, useTimers: () => ({ data: timers }) }
})
vi.mock('../../hooks/useStorageUnits', () => ({ useUnitBoundary: () => ({ ready: true, toStorage: (_k: string, b: unknown) => b, toDisplay: (_k: string, b: unknown) => b }) }))
vi.mock('../../lib/api/endpoints', async (orig) => {
  const mod = await orig<typeof import('../../lib/api/endpoints')>()
  return {
    ...mod,
    feedings: { ...mod.feedings, create: (b: Record<string, unknown>) => create(b), update: (id: number, b: Record<string, unknown>) => update(id, b), remove: (id: number) => remove(id) },
  }
})
vi.mock('../../lib/api/companion', async (orig) => {
  const mod = await orig<typeof import('../../lib/api/companion')>()
  return {
    ...mod,
    companion: {
      ...mod.companion,
      milk: { ...mod.companion.milk, list: () => Promise.resolve([]), forFeeding: () => forFeeding(), setTakes: (id: number, t: unknown[]) => setTakes(id, t) },
    },
  }
})

const child = { id: 1, first_name: 'Ivy', birth_date: '2026-09-01' } as unknown as Child
const bag = { id: 9, child: 1, code: 'FTALLS', pumped_at: new Date().toISOString(), volume_ml: 100, remaining_ml: 70, uses: [], location: 'fridge', thawed: false, expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: 'stored', pumping_id: null, feeding_id: 21, notes: '', created: '', created_by: null, used_at: null, used_by: null } as MilkBag
const bottle = { id: 21, child: 1, start: new Date(Date.now() - 3600_000).toISOString(), end: new Date(Date.now() - 3600_000).toISOString(), duration: '00:00:00', type: 'breast milk', method: 'bottle', amount: 30, notes: '', tags: [] } as unknown as Feeding
const linked: FeedingTakes = { bag, use: { id: 1, bag: 9, feeding_id: 21, amount_ml: 30, kind: 'bottle', at: '', by_user: null }, takes: [{ bag, use: { id: 1, bag: 9, feeding_id: 21, amount_ml: 30, kind: 'bottle', at: '', by_user: null } }], total_ml: 30 }

function mount(props: Partial<Parameters<typeof FeedingSheet>[0]>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PrefsProvider>
        <MemoryRouter>
          <FeedingSheet child={child} editing={null} onClose={() => undefined} {...props} />
        </MemoryRouter>
      </PrefsProvider>
    </QueryClientProvider>,
  )
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)))

describe('FeedingSheet', () => {
  beforeEach(() => {
    localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } }))
    timers.length = 0
    for (const f of [create, update, remove, setTakes]) f.mockClear()
    forFeeding = () => new Promise(() => undefined)
  })

  it('"nursed left 12 min" with no time is a feed that just ended, not one ending 12 minutes from now', async () => {
    mount({ initial: 'nursing', prefill: { kind: 'nursing', side: 'left', minutes: 12 } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    const body = create.mock.calls[0][0] as { start: string; end: string }
    expect(Math.abs(new Date(body.end).getTime() - Date.now())).toBeLessThan(60_000)
    expect(new Date(body.end).getTime() - new Date(body.start).getTime()).toBe(12 * 60_000)
  })

  it('the nursing chips move the whole feed so it ends at the chosen moment', async () => {
    mount({ initial: 'nursing' })
    fireEvent.change(screen.getByLabelText('Left (min)'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '15 min ago' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    const body = create.mock.calls[0][0] as { start: string; end: string }
    expect(Math.abs(new Date(body.end).getTime() - (Date.now() - 15 * 60_000))).toBeLessThan(60_000)
    expect(new Date(body.end).getTime() - new Date(body.start).getTime()).toBe(20 * 60_000)
  })

  it('offers a live timer for each side while none is running', async () => {
    mount({ initial: 'nursing' })
    expect(screen.getByRole('button', { name: 'Start left' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start right' })).toBeTruthy()
  })

  it('opens the nursing timer already running instead of starting a second one', async () => {
    timers.push({ id: 4, child: 1, name: 'nursing:L=0;R=0;A=left;S=2026-10-10T10:00:00Z', start: new Date().toISOString() } as unknown as Timer)
    mount({ initial: 'nursing' })
    expect(screen.getByText('Nursing timer already running')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start left' })).toBeNull()
  })

  it('an edited stash bottle switched to nursing gives its milk back', async () => {
    forFeeding = () => Promise.resolve(linked)
    mount({ editing: bottle })
    await settle()
    fireEvent.click(screen.getByRole('tab', { name: 'Nursing' }))
    fireEvent.change(screen.getByLabelText('Left (min)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(update).toHaveBeenCalledTimes(1)
    expect(setTakes).toHaveBeenCalledWith(21, [])
  })

  it('an edited stash bottle switched to formula gives its milk back, even before its bags loaded', async () => {
    mount({ editing: bottle })
    fireEvent.click(screen.getByRole('radio', { name: 'Formula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(setTakes).toHaveBeenCalledWith(21, [])
  })

  it('deleting a bottle gives the milk back even when its bags have not loaded, and a failure is said and retried', async () => {
    setTakes.mockImplementationOnce(() => Promise.reject(new Error('companion down')))
    mount({ editing: bottle })
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    await settle()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toMatch(/deleted, but its milk did not go back/)
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    await settle()
    expect(remove).toHaveBeenCalledTimes(1) // the bottle is not deleted twice
    expect(setTakes).toHaveBeenCalledTimes(2)
    expect(setTakes).toHaveBeenLastCalledWith(21, [])
  })

  it('says, without blocking Save, that an amount looks like a slip', async () => {
    mount({ initial: 'bottle' })
    fireEvent.change(screen.getByLabelText('Amount in mL'), { target: { value: '9999' } })
    expect(screen.getByText(/9999 mL is a lot for one bottle/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('fillAmount', () => {
  it('fills what the bags hold at the field step, rounded up so the last bag empties', () => {
    expect(fillAmount(100, 'oz')).toBe(3.4)
    expect(fillAmount(11.28, 'oz')).toBe(0.4)
    expect(fillAmount(88.72, 'oz')).toBe(3.0)
    expect(fillAmount(59.5, 'ml')).toBe(60)
    expect(fillAmount(60, 'ml')).toBe(60)
  })
})
