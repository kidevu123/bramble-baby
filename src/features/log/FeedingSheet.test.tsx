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
const setTakes = vi.fn((_id: number, _takes: unknown[], _at?: string) => Promise.resolve({ bag: null, use: null, takes: [], total_ml: 0 }))
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
      milk: { ...mod.companion.milk, list: () => Promise.resolve([]), forFeeding: () => forFeeding(), setTakes: (...args: [number, unknown[], string?]) => setTakes(...args) },
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

  it('typing the minutes on a new sheet makes a feed that just finished, and Save stays live', async () => {
    mount({ initial: 'nursing' })
    fireEvent.change(screen.getByLabelText('Left (min)'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Right (min)'), { target: { value: '8' } })
    expect(screen.queryByText(/would end in the future/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    const body = create.mock.calls[0][0] as { start: string; end: string; method: string; notes: string }
    expect(Math.abs(new Date(body.end).getTime() - Date.now())).toBeLessThan(60_000)
    expect(new Date(body.end).getTime() - new Date(body.start).getTime()).toBe(20 * 60_000)
    expect(body.method).toBe('both breasts')
    expect(body.notes).toBe('Left 12m · Right 8m')
  })

  it('a new feed saved with `editing` undefined (as the log sheet passes it) saves once and closes the sheet', async () => {
    const onClose = vi.fn()
    mount({ initial: 'nursing', editing: undefined as unknown as null, onClose })
    fireEvent.change(screen.getByLabelText('Left (min)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(create).toHaveBeenCalledTimes(1)
    expect(setTakes).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a new formula bottle saved with `editing` undefined saves once and closes the sheet', async () => {
    const onClose = vi.fn()
    mount({ initial: 'bottle', editing: undefined as unknown as null, onClose })
    fireEvent.click(screen.getByRole('radio', { name: 'Formula' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: /Amount in/ }), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(create).toHaveBeenCalledTimes(1)
    expect(setTakes).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a start set by hand stays put, and the finish follows the minutes', async () => {
    mount({ initial: 'nursing' })
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000)
    twoHoursAgo.setSeconds(0, 0)
    fireEvent.change(screen.getByLabelText('Started:'), { target: { value: `${twoHoursAgo.getFullYear()}-${String(twoHoursAgo.getMonth() + 1).padStart(2, '0')}-${String(twoHoursAgo.getDate()).padStart(2, '0')}T${String(twoHoursAgo.getHours()).padStart(2, '0')}:${String(twoHoursAgo.getMinutes()).padStart(2, '0')}` } })
    fireEvent.change(screen.getByLabelText('Left (min)'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    const body = create.mock.calls[0][0] as { start: string; end: string }
    expect(new Date(body.start).getTime()).toBe(twoHoursAgo.getTime())
    expect(new Date(body.end).getTime() - new Date(body.start).getTime()).toBe(15 * 60_000)
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

describe('FeedingSheet: a feed logged after the fact', () => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  // A fortified premade bottle that ran out an hour ago: fed in time, the phone was offline, logged now.
  const ended = new Date(Date.now() - 3_600_000)
  const expired = { ...bag, id: 31, code: 'BTL003', kind: 'bottle', spot: 3, kcal_per_oz: 24, volume_ml: 72, remaining_ml: 72, expires_at: ended.toISOString() } as unknown as MilkBag

  beforeEach(() => {
    localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } }))
    for (const f of [create, update, remove, setTakes]) f.mockClear()
  })

  it('waits for the time of the feed, takes one before the deadline, and tells the stash when it happened', async () => {
    mount({ bag: expired })
    // Opened from the Stash tab on a fortified bottle: fortified milk, not plain.
    expect(screen.getByRole('radio', { name: 'Fortified' }).getAttribute('aria-checked')).toBe('true')
    const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(screen.getByTestId('late-feed').textContent).toMatch(/^Premade bottle 3 kept until .+\. If Ivy was fed before then, set the time of the feed; if not, take it out of this feed\.$/)
    expect(save().disabled).toBe(true)
    // Twenty minutes ago is still after it ran out.
    fireEvent.change(screen.getByLabelText('Fed at:'), { target: { value: local(new Date(Date.now() - 20 * 60_000)) } })
    expect(screen.queryByTestId('late-feed')).not.toBeNull()
    expect(save().disabled).toBe(true)
    const fed = new Date(Date.now() - 3 * 3_600_000)
    fed.setSeconds(0, 0)
    fireEvent.change(screen.getByLabelText('Fed at:'), { target: { value: local(fed) } })
    expect(screen.queryByTestId('late-feed')).toBeNull()
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await settle()
    const body = create.mock.calls[0][0] as { start: string; type: string }
    expect(body.type).toBe('fortified breast milk')
    expect(new Date(body.start).getTime()).toBe(fed.getTime())
    expect(setTakes).toHaveBeenCalledTimes(1)
    expect(setTakes.mock.calls[0][1]).toEqual([{ bag: 31, amount_ml: 72 }])
    expect(new Date(setTakes.mock.calls[0][2] as string).getTime()).toBe(fed.getTime())
  })

  it('leaves an edited bottle on the milk it already took, whatever its time is moved to', async () => {
    const was = { ...bag, expires_at: ended.toISOString() } as MilkBag
    forFeeding = () => Promise.resolve({ ...linked, bag: was, takes: [{ bag: was, use: linked.takes[0].use }] })
    mount({ editing: { ...bottle, start: new Date().toISOString(), end: new Date().toISOString() } })
    await settle()
    expect(screen.queryByTestId('late-feed')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('FeedingSheet: a bottle poured from a batch', () => {
  const batch = { ...bag, id: 41, code: 'BCH041', kind: 'batch', kcal_per_oz: 24, volume_ml: 370, remaining_ml: 310, mixed_at: new Date(Date.now() - 3_600_000).toISOString() } as unknown as MilkBag

  beforeEach(() => {
    localStorage.setItem('bramble.prefs', JSON.stringify({ theme: 'system', units: { volume: 'ml' } }))
    for (const f of [create, update, remove, setTakes]) f.mockClear()
    forFeeding = () => new Promise(() => undefined)
  })

  it('opens with no amount (never the whole batch), takes what she drank, and the rest stays', async () => {
    mount({ bag: batch })
    const amount = () => screen.getByLabelText('Amount in mL') as HTMLInputElement
    const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(amount().value).toBe('')
    expect(save().disabled).toBe(true)
    // mixed to a strength: fortified milk
    expect(screen.getByRole('radio', { name: 'Fortified' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('batch-picked').textContent).toContain('The batch · 310 mL left')
    fireEvent.change(amount(), { target: { value: '90' } })
    expect(screen.getByTestId('batch-picked').textContent).toContain('90 mL from the batch')
    expect(screen.getByTestId('batch-picked').textContent).toContain('220 mL stays')
    fireEvent.click(save())
    await settle()
    const body = create.mock.calls[0][0] as { amount: number; type: string; tags: string[] }
    expect([body.amount, body.type, body.tags]).toEqual([90, 'fortified breast milk', ['kcal:24']])
    expect(setTakes.mock.calls[0][1]).toEqual([{ bag: 41, amount_ml: 90 }])
  })

  it('what she left in the bottle comes out of the batch too, and is not counted as fed', async () => {
    mount({ bag: batch })
    fireEvent.change(screen.getByLabelText('Amount in mL'), { target: { value: '70' } })
    expect(screen.queryByTestId('batch-tossed')).toBeNull()
    fireEvent.click(screen.getByTestId('batch-tossed-link'))
    fireEvent.change(screen.getByLabelText('Left in the bottle and thrown away, in mL'), { target: { value: '20' } })
    expect(screen.getByTestId('batch-picked').textContent).toContain('90 mL from the batch')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect((create.mock.calls[0][0] as { amount: number }).amount).toBe(70)
    expect(setTakes.mock.calls[0][1]).toEqual([{ bag: 41, amount_ml: 90 }])
  })

  it('an edited bottle opens on what it threw away, and a new amount moves only the difference', async () => {
    const use = { id: 5, bag: 41, feeding_id: 21, amount_ml: 50, kind: 'bottle' as const, at: '', by_user: null }
    forFeeding = () => Promise.resolve({ bag: batch, use, takes: [{ bag: batch, use }], total_ml: 50 })
    mount({ editing: { ...bottle, type: 'fortified breast milk', tags: ['kcal:24'] } as unknown as Feeding })
    await settle()
    // saved as 30 mL drunk out of 50 mL poured: 20 mL was thrown away
    expect((screen.getByLabelText('Left in the bottle and thrown away, in mL') as HTMLInputElement).value).toBe('20')
    fireEvent.change(screen.getByLabelText('Amount in mL'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(setTakes.mock.calls[0][1]).toEqual([{ bag: 41, amount_ml: 60 }])
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
