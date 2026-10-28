import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { Toggle } from '../../components/ui/Toggle'
import { useChildSettings } from '../../hooks/useChildSettings'
import { DEFAULT_HOME_TILES } from '../../lib/api/companion'
import type { Child } from '../../lib/api/types'
import { KIND_LABEL } from '../../lib/events'
import type { EventKind } from '../../lib/api/types'
import './customize.css'

/** The Customize sheet: one toggle per home tile, shared with every caregiver. */
export function CustomizeSheet({ open, child, onClose }: { open: boolean; child: Child; onClose: () => void }) {
  const { settings, update } = useChildSettings(child.id)
  const on = new Set(settings.homeTiles)
  const toggle = (tile: string) => {
    const next = on.has(tile) ? settings.homeTiles.filter((t) => t !== tile) : DEFAULT_HOME_TILES.filter((t) => t === tile || on.has(t))
    if (next.length === 0) return
    update({ homeTiles: next })
  }
  return (
    <Sheet
      open={open}
      title="Customize"
      onClose={onClose}
      footer={
        <Button size="lg" block onClick={onClose}>
          Save
        </Button>
      }
    >
      <ul className="customize-list">
        {DEFAULT_HOME_TILES.map((tile) => (
          <li key={tile} className="customize-row">
            <span>{KIND_LABEL[tile as EventKind] ?? tile}</span>
            <Toggle checked={on.has(tile)} onChange={() => toggle(tile)} label={`Show ${KIND_LABEL[tile as EventKind] ?? tile}`} />
          </li>
        ))}
      </ul>
      <p className="xs muted">Turn off what you don't track. Contractions shows automatically while you're expecting.</p>
    </Sheet>
  )
}
