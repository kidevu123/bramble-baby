import type { GlanceKey } from '../../lib/reports'

/** The Summary view's categories; Overview first. */
export type Cat = 'overview' | 'sleep' | 'feed' | 'solids' | 'diaper' | 'pump' | 'activity' | 'medicine' | 'growth' | 'temperature' | 'milestones'

/** The glance tiles and overview rows open these categories. */
export const CAT_OF_GLANCE: Record<GlanceKey, Cat> = { sleep: 'sleep', feeds: 'feed', diapers: 'diaper', pumping: 'pump' }
