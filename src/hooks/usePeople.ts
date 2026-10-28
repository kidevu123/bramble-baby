import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { companion, type PeopleListing, type Person, type Role, type Screen, type SimpleAction } from '../lib/api/companion'
import { tokenStore } from '../lib/api/client'
import { labelsFor } from '../lib/people'

export const PEOPLE_KEY = ['people'] as const

/**
 * The household's people as the companion knows them: who is signed in as what, and the label the
 * timeline shows for each login. One query for the whole app (Home, Reports, Stash and Settings all read
 * it), refreshed after every change made from the People sheet.
 */
export function usePeople() {
  const qc = useQueryClient()
  const query = useQuery<PeopleListing>({
    queryKey: PEOPLE_KEY,
    queryFn: () => companion.people.list(),
    enabled: Boolean(tokenStore.get()),
    staleTime: 60_000,
    retry: false,
  })
  const people = query.data?.people
  // Username → "Mom": what Timeline and the duplicate warning need. Stable between fetches.
  const names = useMemo(() => (people ? labelsFor(people) : undefined), [people])

  const put = (person: Person) =>
    qc.setQueryData<PeopleListing>(PEOPLE_KEY, (old) => {
      if (!old) return old
      const rest = old.people.filter((p) => p.username.toLowerCase() !== person.username.toLowerCase())
      return { ...old, people: [...rest, person] }
    })
  const refresh = () => void qc.invalidateQueries({ queryKey: PEOPLE_KEY })
  /** The People sheet opening: ask the server to look at Baby Buddy's users again, not its cached list. */
  const refreshFresh = () => qc.fetchQuery({ queryKey: PEOPLE_KEY, queryFn: () => companion.people.list(true), staleTime: 0 }).catch(() => undefined)

  const add = useMutation({ mutationFn: (body: { username: string; password: string; role: Role; name: string }) => companion.people.add(body), onSuccess: put, onSettled: refresh })
  const update = useMutation({ mutationFn: (v: { username: string; body: { role?: Role; name?: string; password?: string; active?: boolean; screen?: Screen; simpleActions?: SimpleAction[] } }) => companion.people.update(v.username, v.body), onSuccess: put, onSettled: refresh })
  const remove = useMutation({ mutationFn: (username: string) => companion.people.remove(username), onSuccess: put, onSettled: refresh })

  return { listing: query.data, people, names, isLoading: query.isLoading, error: query.error, refetch: query.refetch, refreshFresh, add, update, remove }
}
