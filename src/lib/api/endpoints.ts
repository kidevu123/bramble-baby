import { disableCaregiverTags, withCaregiverTag } from '../caregiver'
import { api, ApiError } from './client'
import type {
  Child,
  DiaperChange,
  Feeding,
  HeadCircumference,
  Height,
  Id,
  Medication,
  Note,
  Page,
  Pumping,
  Sleep,
  Temperature,
  Timer,
  TummyTime,
  Weight,
} from './types'

const PAGE_LIMIT = 500

async function listAll<T>(path: string, query: Record<string, string | number | undefined>): Promise<T[]> {
  const first = await api<Page<T>>(path, { query: { ...query, limit: PAGE_LIMIT } })
  const results = [...first.results]
  let next = first.next
  let guard = 0
  // 40 pages × 500 = 20k rows per type: a year of a heavy logger fits with room to spare.
  while (next && guard < 40) {
    const page = await api<Page<T>>(new URL(next, location.origin).pathname + new URL(next, location.origin).search)
    results.push(...page.results)
    next = page.next
    guard++
  }
  return results
}

export interface Range {
  from: Date
  to: Date
}

const startEndQuery = (child: Id, range?: Range) => ({
  child,
  start_min: range?.from.toISOString(),
  start_max: range?.to.toISOString(),
})
const timeQuery = (child: Id, range?: Range) => ({
  child,
  date_min: range?.from.toISOString(),
  date_max: range?.to.toISOString(),
})

export const children = {
  list: () => listAll<Child>('/api/children/', {}),
  create: (body: Partial<Child>) => api<Child>('/api/children/', { method: 'POST', body: JSON.stringify(body) }),
  update: (slug: string, body: Partial<Child>) =>
    api<Child>(`/api/children/${slug}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (slug: string) => api<void>(`/api/children/${slug}/`, { method: 'DELETE' }),
}

function crud<T extends { id: Id }>(path: string) {
  return {
    create: async (body: Record<string, unknown>) => {
      const tagged = withCaregiverTag(body)
      try {
        return await api<T>(path, { method: 'POST', body: JSON.stringify(tagged) })
      } catch (err) {
        // Baby Buddy can refuse tag creation for accounts without the tag permission. Attribution is
        // nice-to-have; the entry itself is not. Retry untagged and stop tagging for this session.
        if (tagged !== body && err instanceof ApiError && (err.status === 403 || (err.status === 400 && err.body && typeof err.body === 'object' && 'tags' in err.body))) {
          disableCaregiverTags()
          return api<T>(path, { method: 'POST', body: JSON.stringify(body) })
        }
        throw err
      }
    },
    update: (id: Id, body: Record<string, unknown>) =>
      api<T>(`${path}${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: Id) => api<void>(`${path}${id}/`, { method: 'DELETE' }),
  }
}

export const sleep = {
  list: (child: Id, range?: Range) => listAll<Sleep>('/api/sleep/', startEndQuery(child, range)),
  ...crud<Sleep>('/api/sleep/'),
}
export const feedings = {
  list: (child: Id, range?: Range) => listAll<Feeding>('/api/feedings/', startEndQuery(child, range)),
  ...crud<Feeding>('/api/feedings/'),
}
export const changes = {
  list: (child: Id, range?: Range) => listAll<DiaperChange>('/api/changes/', timeQuery(child, range)),
  ...crud<DiaperChange>('/api/changes/'),
}
export const pumping = {
  list: (child: Id, range?: Range) => listAll<Pumping>('/api/pumping/', startEndQuery(child, range)),
  ...crud<Pumping>('/api/pumping/'),
}
export const tummyTimes = {
  list: (child: Id, range?: Range) => listAll<TummyTime>('/api/tummy-times/', startEndQuery(child, range)),
  ...crud<TummyTime>('/api/tummy-times/'),
}
export const temperature = {
  list: (child: Id, range?: Range) => listAll<Temperature>('/api/temperature/', timeQuery(child, range)),
  ...crud<Temperature>('/api/temperature/'),
}
export const medication = {
  list: (child: Id, range?: Range) => listAll<Medication>('/api/medication/', timeQuery(child, range)),
  ...crud<Medication>('/api/medication/'),
}
export const notes = {
  list: (child: Id, range?: Range) => listAll<Note>('/api/notes/', timeQuery(child, range)),
  ...crud<Note>('/api/notes/'),
}
export const weight = { list: (child: Id) => listAll<Weight>('/api/weight/', { child }), ...crud<Weight>('/api/weight/') }
export const height = { list: (child: Id) => listAll<Height>('/api/height/', { child }), ...crud<Height>('/api/height/') }
export const headCircumference = {
  list: (child: Id) => listAll<HeadCircumference>('/api/head-circumference/', { child }),
  ...crud<HeadCircumference>('/api/head-circumference/'),
}

export const timers = {
  list: () => listAll<Timer>('/api/timers/', {}),
  create: (body: { child: Id; name: string; start?: string }) =>
    api<Timer>('/api/timers/', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: Id, body: Partial<Pick<Timer, 'name' | 'start'>>) =>
    api<Timer>(`/api/timers/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: Id) => api<void>(`/api/timers/${id}/`, { method: 'DELETE' }),
}
