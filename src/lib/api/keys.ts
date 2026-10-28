import type { Id } from './types'

export const qk = {
  profile: ['profile'] as const,
  children: ['children'] as const,
  timers: ['timers'] as const,
  events: (child: Id, kind: string, rangeKey: string) => ['events', child, kind, rangeKey] as const,
  eventsForChild: (child: Id) => ['events', child] as const,
  growth: (child: Id) => ['growth', child] as const,
}
