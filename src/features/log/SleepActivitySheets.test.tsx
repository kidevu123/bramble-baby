import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHILD_SETTINGS } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { ActivitySheet } from './ActivitySheet'
import { ReminderSheet } from './ReminderSheet'
import { SleepSheet } from './SleepSheet'

const sleepCreate = vi.fn((b: Record<string, unknown>) => Promise.resolve({ id: 1, ...b }))
const tummyCreate = vi.fn((b: Record<string, unknown>) => Promise.resolve({ id: 1, ...b }))
const reminderCreate = vi.fn((b: Record<string, unknown>) => Promise.resolve({ id: 1, ...b }))

vi.mock('../../hooks/useChildSettings', () => ({ useChildSettings: () => ({ settings: DEFAULT_CHILD_SETTINGS, update: () => undefined }) }))
vi.mock('../../hooks/useEvents', async (orig) => {
  const mod = await orig<typeof import('../../hooks/useEvents')>()
  return { ...mod, useTimers: () => ({ data: [] }) }
})
vi.mock('../notifications/NotificationStatus', () => ({ NotificationStatus: () => null }))
vi.mock('../../lib/api/endpoints', async (orig) => {
  const mod = await orig<typeof import('../../lib/api/endpoints')>()
  return { ...mod, sleep: { ...mod.sleep, create: (b: Record<string, unknown>) => sleepCreate(b) }, tummyTimes: { ...mod.tummyTimes, create: (b: Record<string, unknown>) => tummyCreate(b) } }
})
vi.mock('../../lib/api/companion', async (orig) => {
  const mod = await orig<typeof import('../../lib/api/companion')>()
  return { ...mod, companion: { ...mod.companion, reminders: { ...mod.companion.reminders, list: () => Promise.resolve([]), create: (b: Record<string, unknown>) => reminderCreate(b) } } }
})

const child = { id: 1, first_name: 'Ivy', birth_date: '2026-09-01' } as unknown as Child
const wrap = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)))
const at = (h: number, m = 0, daysBack = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  d.setHours(h, m, 0, 0)
  return d
}

describe('SleepSheet', () => {
  beforeEach(() => sleepCreate.mockClear())

  it('a Type it wake time still to come is capped at now, and said so', async () => {
    wrap(<SleepSheet child={child} editing={null} prefill={{ kind: 'sleep', start: new Date(Date.now() - 3600_000), end: new Date(Date.now() + 3600_000) }} onClose={() => undefined} />)
    expect(screen.getByText(/That wake time was still to come · set to now/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(new Date(sleepCreate.mock.calls[0][0].end as string).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('a night typed in by hand is saved as night sleep, not a nap', async () => {
    wrap(<SleepSheet child={child} editing={null} prefill={{ kind: 'sleep', start: at(22, 0, 1), end: at(0, 30) }} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(sleepCreate.mock.calls[0][0].nap).toBe(false)
  })

  it('a kind picked by hand wins over the start time', async () => {
    wrap(<SleepSheet child={child} editing={null} prefill={{ kind: 'sleep', start: at(22, 0, 1), end: at(0, 30) }} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Nap' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    expect(sleepCreate.mock.calls[0][0].nap).toBe(true)
  })
})

describe('ActivitySheet (tummy time)', () => {
  it('"Just now" ends the session now and keeps its length: Baby Buddy refuses an end in the future', async () => {
    wrap(<ActivitySheet child={child} editing={null} tummyPrefill={{ kind: 'tummy', minutes: 10 }} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Just now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()
    const body = tummyCreate.mock.calls[0][0] as { start: string; end: string }
    expect(new Date(body.end).getTime()).toBeLessThanOrEqual(Date.now())
    expect(new Date(body.end).getTime() - new Date(body.start).getTime()).toBe(10 * 60_000)
  })
})

describe('ReminderSheet', () => {
  it('a second tap cannot schedule the same reminder twice', async () => {
    wrap(<ReminderSheet child={child} kind="diaper" />)
    fireEvent.click(screen.getByRole('button', { name: '1 h' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }))
    await settle()
    expect(reminderCreate).toHaveBeenCalledTimes(1)
    const done = screen.getByRole('button', { name: 'Reminder set' }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    expect(screen.getByText(/Reminder set for/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2 h' }))
    expect((screen.getByRole('button', { name: 'Set reminder' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
