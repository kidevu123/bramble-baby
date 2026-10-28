import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Child, DiaperChange } from '../../lib/api/types'
import { DiaperSheet } from './DiaperSheet'

const update = vi.fn((_id: number, body: unknown) => Promise.resolve(body))
vi.mock('../../lib/api/endpoints', async (orig) => {
  const mod = await orig<typeof import('../../lib/api/endpoints')>()
  return { ...mod, changes: { ...mod.changes, update: (id: number, body: unknown) => update(id, body) } }
})

const child = { id: 1, first_name: 'Ivy', birth_date: '2026-09-01' } as unknown as Child
const entry = (tags: string[]) => ({ id: 7, child: 1, time: '2026-10-09T10:00:00-04:00', wet: true, solid: false, color: '', amount: null, notes: '', tags }) as unknown as DiaperChange
const mount = (e: DiaperChange) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DiaperSheet child={child} editing={e} onClose={() => undefined} />
    </QueryClientProvider>,
  )
const sentTags = () => (update.mock.calls[0][1] as { tags: string[] }).tags

describe('editing a diaper or potty entry', () => {
  beforeEach(() => update.mockClear())

  it('keeps who logged it (and any other tag) when the diaper changes', async () => {
    mount(entry(['caregiver:mom', 'from-babybuddy']))
    fireEvent.click(screen.getByRole('radio', { name: 'Mixed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => undefined)
    expect(sentTags()).toEqual(['caregiver:mom', 'from-babybuddy'])
  })

  it('sets only potty/accident on a potty entry and keeps the caregiver', async () => {
    mount(entry(['caregiver:dad', 'potty', 'accident']))
    fireEvent.click(screen.getByRole('radio', { name: 'Pee' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => undefined)
    expect(sentTags()).toEqual(['caregiver:dad', 'potty'])
  })
})
