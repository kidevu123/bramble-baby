import { useEffect } from 'react'
import { FULL_APP, myScreen, readCachedScreen, writeCachedScreen, type ScreenChoice } from '../lib/simple-screen'
import { usePeople } from './usePeople'

/**
 * Which screen this phone shows: the People listing's answer for the signed-in person, else the last answer
 * kept on the phone (a grandparent's phone stays on the simple screen when the companion is slow or down),
 * else the full app once the listing has failed. 'loading' only on a first launch with nothing kept yet.
 */
export function useMyScreen(username: string): ScreenChoice | 'loading' {
  const { people, error } = usePeople()
  const live = myScreen(people)
  const liveKey = live ? `${live.screen}:${live.actions.join(',')}` : null
  useEffect(() => {
    if (live) writeCachedScreen(username, live)
    // liveKey stands for live: the listing hands out a new object on every fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, liveKey])
  if (live) return live
  const cached = readCachedScreen(username)
  if (cached) return cached
  return error ? FULL_APP : 'loading'
}
