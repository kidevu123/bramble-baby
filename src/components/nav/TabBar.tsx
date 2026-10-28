import type { MouseEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChartIcon, ClipboardIcon, FaceIcon, MilkBagIcon, PlusCircleIcon } from '../icons'
import { sheetJustClosed } from '../ui/sheet-state'
import './nav.css'

const tabs = [
  { to: '/', label: 'Home', icon: PlusCircleIcon },
  { to: '/reports', label: 'Reports', icon: ChartIcon },
  { to: '/plans', label: 'Sleep Plans', icon: ClipboardIcon },
  { to: '/milk', label: 'Stash', icon: MilkBagIcon },
  { to: '/child', label: 'Child', icon: FaceIcon },
]

/** Pages that belong to one tab: the doctor report is part of Reports, nap window opens from Home's band. */
const OWNER: Record<string, string> = { '/report': '/reports', '/nap': '/' }

/** The tab the user was last on, so a page opened from the top bar (Settings, Insights) keeps it lit. */
let lastTab: string | null = null

/** Which tab is lit: the page's own tab, the tab a sub-page belongs to, or the tab it was opened from. */
function activeTab(pathname: string): string | null {
  const own = tabs.find((t) => t.to === pathname)?.to
  if (own) {
    lastTab = own
    return own
  }
  return OWNER[pathname] ?? lastTab
}

export function TabBar() {
  const { pathname } = useLocation()
  const lit = activeTab(pathname)
  const guard = (e: MouseEvent) => {
    // The second half of a double tap on a sheet's Save must not switch tabs.
    if (sheetJustClosed()) e.preventDefault()
  }
  return (
    <nav className="tabbar" aria-label="Main navigation">
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end onClick={guard} className={to === lit ? 'tab active' : 'tab'}>
          <Icon className="tab-icon" />
          <span className="tab-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
