import { hatchRowSummary, hatchState } from '../lib/hatch'
import type { IntegrationItem } from '../lib/integrations'
import { useHatch } from './useHatch'

export type IntegrationId = 'hatch'

/**
 * Every device and account Bramble can read from, in the order the list shows them, each with its own
 * line and where it stands. The Settings page sums them up in one row; Settings › Integrations lists them.
 * A new integration is added here and gets its sheet in IntegrationsSheet.
 */
export function useIntegrations(): IntegrationItem<IntegrationId>[] {
  const hatch = useHatch(false)
  return [{ id: 'hatch', title: 'Hatch scale', value: hatchRowSummary(hatch.status), state: hatchState(hatch.status) }]
}
