import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentSubscription, disablePush, enablePush, pushProvider, pushSupport, requestPermission, syncSubscription, type PushSupport } from '../../lib/push'
import { companion, type CompanionHealth, type PushTestResult } from '../../lib/api/companion'

const KEY = ['push-state'] as const

export interface PushState {
  support: PushSupport
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  /** Which push service this device talks to (Apple, Google, …). */
  provider: string | null
  endpoint: string | null
  /** The companion service answered /health. */
  serverReachable: boolean
  /** Server can sign and send pushes (keys + library). */
  serverPush: boolean | null
  /** This device's subscription exists in the server database. */
  registered: boolean | null
  health: CompanionHealth | null
}

export function useNotifications(child: number | null) {
  const qc = useQueryClient()
  const state = useQuery<PushState>({
    queryKey: [...KEY, child],
    queryFn: async () => {
      const support = pushSupport()
      const permission: PushState['permission'] = 'Notification' in window ? Notification.permission : 'unsupported'
      const sub = await currentSubscription().catch(() => null)
      const health = await companion.health().catch(() => null)
      let registered: boolean | null = null
      if (sub && health) {
        // Heal a reset server DB / rotated subscription silently, then confirm registration.
        await syncSubscription(child)
        registered = await companion.push
          .status(sub.endpoint)
          .then((r) => r.registered)
          .catch(() => null)
      }
      return {
        support,
        permission,
        subscribed: Boolean(sub),
        provider: sub ? pushProvider(sub.endpoint) : null,
        endpoint: sub?.endpoint ?? null,
        serverReachable: health !== null,
        serverPush: health ? health.push : null,
        registered,
        health,
      }
    },
    staleTime: 30_000,
  })
  const enable = useMutation({
    mutationFn: () => enablePush(child),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
  const disable = useMutation({
    mutationFn: () => disablePush(),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
  const test = useMutation<PushTestResult, Error>({
    mutationFn: async () => {
      const sub = await currentSubscription().catch(() => null)
      return companion.push.test(sub?.endpoint ?? null)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
  return {
    state: state.data,
    enable,
    disable,
    test,
    /** Call from a tap handler: asks permission inside the gesture, then subscribes. */
    enableFromTap: () => {
      void requestPermission().then(() => enable.mutate())
    },
    refresh: () => qc.invalidateQueries({ queryKey: KEY }),
  }
}
