import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { BUILD } from '../../lib/update'
import { itemText, readSeen, unseenReleases, writeSeen, type Release } from '../../lib/whats-new'
import './whats-new.css'

/** The release notes, newest first: each version with its date and what changed, in plain words. */
export function WhatsNewSheet({ open, releases, onClose }: { open: boolean; releases: Release[]; onClose: () => void }) {
  const { child } = useChildren()
  return (
    <Sheet
      open={open}
      title="What’s new"
      onClose={onClose}
      footer={
        <Button block onClick={onClose} data-autofocus>
          Got it
        </Button>
      }
    >
      <div className="whats-new" data-testid="whats-new">
        {releases.map((r) => (
          <section key={r.version} className="wn-release">
            <h3 className="wn-head">
              {r.date} <span className="wn-version">· {r.version}</span>
            </h3>
            <ul className="wn-items">
              {r.items.map((item) => (
                <li key={item}>{itemText(item, child?.first_name)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  )
}

/** Once per phone after an update: what changed since the last time this phone was told. */
export function WhatsNewOnLaunch() {
  const [releases] = useState(() => unseenReleases(readSeen(), BUILD.version))
  const [open, setOpen] = useState(releases.length > 0)
  if (!releases.length) return null
  return (
    <WhatsNewSheet
      open={open}
      releases={releases}
      onClose={() => {
        writeSeen(BUILD.version)
        setOpen(false)
      }}
    />
  )
}

