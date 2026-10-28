import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrefsProvider } from '../../hooks/usePrefs'
import { DEFAULT_CHILD_SETTINGS, type MilkBag } from '../../lib/api/companion'
import type { Child, Pumping } from '../../lib/api/types'
import { PumpingSheet } from './DurationSheets'

const calls: string[] = []
const milkUpdate = vi.fn((id: number, body: unknown) => {
  calls.push(`bag ${id} ${JSON.stringify(body)}`)
  return Promise.resolve({})
})
const bags: MilkBag[] = []
const pumpingUpdate = vi.fn((id: number, body: unknown) => {
  calls.push(`entry ${id}`)
  return Promise.resolve({ id, ...(body as object) })
})
const pumpingRemove = vi.fn((id: number) => {
  calls.push(`delete ${id}`)
  return Promise.resolve()
})

vi.mock('../../hooks/useEvents', async (orig) => {
  const mod = await orig<typeof import('../../hooks/useEvents')>()
  // Home keeps the 14-day pumping query warm: the last session (20 min) is known at once.
  return { ...mod, useLastPumping: () => ({ seconds: 1200, pump: null, ready: true }), useTimers: () => ({ data: [] }) }
})
vi.mock('../../hooks/useChildSettings', () => ({ useChildSettings: () => ({ settings: { ...DEFAULT_CHILD_SETTINGS, pumps: [] }, update: () => undefined }) }))
vi.mock('../../hooks/useStorageUnits', () => ({ useUnitBoundary: () => ({ ready: true, toStorage: (_k: string, b: unknown) => b, toDisplay: (_k: string, b: unknown) => b }) }))
vi.mock('../../lib/api/endpoints', async (orig) => {
  const mod = await orig<typeof import('../../lib/api/endpoints')>()
  return { ...mod, pumping: { ...mod.pumping, update: (id: number, b: unknown) => pumpingUpdate(id, b), remove: (id: number) => pumpingRemove(id) } }
})
vi.mock('../../lib/api/companion', async (orig) => {
  const mod = await orig<typeof import('../../lib/api/companion')>()
  return {
    ...mod,
    companion: {
      ...mod.companion,
      milk: { ...mod.companion.milk, list: () => Promise.resolve(bags), update: (id: number, b: unknown) => milkUpdate(id, b) },
      print: { ...mod.companion.print, status: () => Promise.resolve({ configured: false, kind: null, detail: null }) },
    },
  }
})

const child = { id: 1, first_name: 'Ivy', last_name: '', birth_date: '2026-09-01', slug: 'ivy' } as unknown as Child
const start = new Date(Date.now() - 3 * 3600_000)
const entry = { id: 5, child: 1, start: start.toISOString(), end: new Date(start.getTime() + 20 * 60_000).toISOString(), amount: 150, notes: '', tags: ['caregiver:admin'] } as unknown as Pumping
const bagFor = (uses: MilkBag['uses'] = []): MilkBag =>
  ({ id: 9, child: 1, code: 'VJCFFC', pumped_at: start.toISOString(), volume_ml: 150, remaining_ml: 150, uses, location: 'fridge', thawed: false, expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), status: 'stored', pumping_id: 5, feeding_id: null, notes: '', created: '', created_by: null, used_at: null, used_by: null }) as MilkBag

function mount(props: Partial<Parameters<typeof PumpingSheet>[0]>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PrefsProvider>
        <MemoryRouter>
          <PumpingSheet child={child} editing={null} onClose={() => undefined} {...props} />
        </MemoryRouter>
      </PrefsProvider>
    </QueryClientProvider>,
  )
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)))

describe('PumpingSheet', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } }))
    calls.length = 0
    bags.length = 0
    milkUpdate.mockClear()
  })

  it('does not credit the last session when a Type it line gave the length and the time', async () => {
    const end = new Date(Date.now() - 2 * 3600_000)
    mount({ prefill: { kind: 'pumping', amount: 90, minutes: 40, end } })
    await settle()
    expect(screen.queryByText(/like the last session/i)).toBeNull()
  })

  it('names the Type it finish time when only the time was given', async () => {
    mount({ prefill: { kind: 'pumping', amount: 90, end: new Date(Date.now() - 2 * 3600_000) } })
    await settle()
    expect(screen.getByText(/Like the last session: 20m, finished /).textContent).not.toMatch(/just now/)
  })

  it('corrects the bag before saving an edited volume and start', async () => {
    bags.push(bagFor())
    mount({ editing: entry })
    await settle()
    fireEvent.change(screen.getByLabelText('Volume in mL'), { target: { value: '105' } })
    await settle()
    expect(screen.getByText(/Saving also corrects bag VJCFFC to 105 mL/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(calls[0]).toMatch(/^bag 9 .*"volume_ml":105/)
    expect(calls[1]).toBe('entry 5')
  })

  it('takes an untouched bag out of the stash when its entry is deleted', async () => {
    bags.push(bagFor())
    mount({ editing: entry })
    await settle()
    expect(screen.getByText(/also takes bag VJCFFC \(150 mL\) out of the stash/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    await settle()
    expect(calls).toEqual(['delete 5', expect.stringMatching(/^bag 9 .*"status":"discarded"/)])
  })

  it('keeps a bag that already went into a bottle and says so', async () => {
    bags.push(bagFor([{ id: 1, bag: 9, feeding_id: 3, amount_ml: 40, kind: 'bottle', at: '', by_user: null }]))
    mount({ editing: entry })
    await settle()
    expect(screen.getByText(/already went into a bottle, so it stays in the stash/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    await settle()
    expect(calls).toEqual(['delete 5'])
  })
})
