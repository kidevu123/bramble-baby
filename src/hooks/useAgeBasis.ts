import { useMemo } from 'react'
import type { Child } from '../lib/api/types'
import { ageBasis, type AgeBasis } from '../lib/preterm'
import { useChildSettings } from './useChildSettings'

/** The child's age basis (Settings › Born early): what every age-typical figure counts from. */
export function useAgeBasis(child: Child): AgeBasis {
  const { settings } = useChildSettings(child.id)
  const { bornAtDays, nicu } = settings
  return useMemo(() => ageBasis(child, { bornAtDays, nicu }), [child.birth_date, bornAtDays, nicu?.since, nicu?.home]) // eslint-disable-line react-hooks/exhaustive-deps
}
