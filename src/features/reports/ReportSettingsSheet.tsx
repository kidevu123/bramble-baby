import { Button } from '../../components/ui/Button'
import { Segmented } from '../../components/ui/Segmented'
import { Sheet } from '../../components/ui/Sheet'
import { Toggle } from '../../components/ui/Toggle'
import { useChildSettings } from '../../hooks/useChildSettings'
import type { Child } from '../../lib/api/types'
import { clock12 } from './format'
import '../home/customize.css'

export const REPORT_CATEGORIES: { key: string; label: string }[] = [
  { key: 'contractions', label: 'Contractions' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'feeding', label: 'Nursing & Bottle' },
  { key: 'solids', label: 'Solids' },
  { key: 'diaper', label: 'Diapers & Potty' },
  { key: 'pumping', label: 'Pumping' },
  { key: 'activity', label: 'Activities' },
  { key: 'medicine', label: 'Medicine' },
  { key: 'growth', label: 'Growth' },
  { key: 'temperature', label: 'Temperature' },
]

/**
 * Report settings: the day view's start and which categories show. The range is not here: Summary's
 * 7D…1Y pills are the one control for it.
 */
export function ReportSettingsSheet({ open, child, onClose }: { open: boolean; child: Child; onClose: () => void }) {
  const { settings, update } = useChildSettings(child.id)
  const filters = settings.reportFilters
  const setFilter = (k: string, v: boolean) => update((latest) => ({ reportFilters: { ...(latest.reportFilters ?? {}), [k]: v } }))
  return (
    <Sheet
      open={open}
      title="Report settings"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => update({ reportFilters: {}, reportDayStart: 'day' })}>
            Reset
          </Button>
          <Button onClick={onClose}>Apply</Button>
        </>
      }
    >
      <section className="stack">
        <h3>Day-view display</h3>
        <p className="small muted">Day start time is {clock12(settings.dayStart)}, set on the Child tab.</p>
        <Segmented label="Day view start" options={[{ value: 'day', label: 'Day start time' }, { value: 'midnight', label: 'Midnight' }]} value={settings.reportDayStart} onChange={(v) => update({ reportDayStart: v })} />
      </section>
      <ul className="customize-list">
        {REPORT_CATEGORIES.map((c) => (
          <li key={c.key} className="customize-row">
            <span>{c.label}</span>
            <Toggle checked={filters[c.key] !== false} onChange={(v) => setFilter(c.key, v)} label={`Show ${c.label}`} />
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
