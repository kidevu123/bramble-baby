import { useState, type ReactNode } from 'react'
import { ScaleIcon } from '../../components/icons'
import { Sheet } from '../../components/ui/Sheet'
import type { IntegrationId } from '../../hooks/useIntegrations'
import type { IntegrationItem } from '../../lib/integrations'
import { HatchSheet } from './HatchSheet'
import { SettingsRow } from './SettingsRow'

const ICONS: Record<IntegrationId, ReactNode> = {
  hatch: <ScaleIcon />,
}

/**
 * Settings › Integrations: the devices and accounts Bramble reads from, one row each with where it stands.
 * A row opens that integration's own sheet on top of this one, so closing it comes back to the list.
 */
export function IntegrationsSheet({ open, items, onClose }: { open: boolean; items: IntegrationItem<IntegrationId>[]; onClose: () => void }) {
  const [shown, setShown] = useState<IntegrationId | null>(null)
  const back = () => setShown(null)
  return (
    <Sheet open={open} title="Integrations" onClose={onClose}>
      <div className="stack">
        <p className="small muted">Devices and accounts Bramble reads from. Each one signs in once and then keeps itself up to date.</p>
        <div className="settings-list integrations-list">
          {items.map((item) => (
            <SettingsRow key={item.id} icon={ICONS[item.id]} title={item.title} value={item.value} onClick={() => setShown(item.id)} />
          ))}
        </div>
        <HatchSheet open={shown === 'hatch'} onClose={back} />
      </div>
    </Sheet>
  )
}
