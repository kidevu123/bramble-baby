import { useNavigate } from 'react-router-dom'
import { useChildren } from '../../hooks/useChildren'
import { ChevronDownIcon, GearIcon, LightbulbIcon, Logo, MailIcon } from '../icons'
import { Avatar } from '../ui/Avatar'
import { BackButton } from './BackButton'
import './nav.css'

interface Props {
  title?: string
  /**
   * 'settings' ends the bar with the same two icons on every tab, lightbulb then gear, in the same place;
   * anything page-specific (rightSlot, then Home's inbox) sits to their left. 'custom' shows only rightSlot.
   */
  right?: 'settings' | 'none' | 'custom'
  rightSlot?: React.ReactNode
  onInbox?: () => void
  inboxCount?: number
  /** Pages reached from the top bar or a band (not a tab) show Back instead of the child switcher. */
  back?: boolean
}

/** Child switcher (or Back) left, logo centered, actions right (customize + settings). */
export function TopBar({ title, right = 'settings', rightSlot, onInbox, inboxCount = 0, back = false }: Props) {
  const { child, children, select } = useChildren()
  const navigate = useNavigate()

  return (
    <header className={back && right === 'none' ? 'topbar topbar-wide' : 'topbar'}>
      <div className="topbar-left">
        {back ? (
          <BackButton />
        ) : child ? (
          children.length > 1 ? (
            <label className="child-switch">
              <Avatar child={child} size={30} />
              <span className="child-switch-name truncate">{child.first_name}</span>
              <ChevronDownIcon className="child-switch-chev" />
              <select aria-label="Switch child" value={child.id} onChange={(e) => select(Number(e.target.value))}>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            // One child: nothing to switch to, so the name is a label, not a second way into the Child tab.
            <span className="child-switch static">
              <Avatar child={child} size={30} />
              <span className="child-switch-name truncate">{child.first_name}</span>
            </span>
          )
        ) : null}
      </div>
      <div className="topbar-center">{title ? <span className="topbar-title">{title}</span> : <Logo className="topbar-logo" />}</div>
      <div className="topbar-right">
        {right !== 'none' ? rightSlot : null}
        {right === 'settings' ? (
          <>
            {onInbox ? (
              <button type="button" className="topbar-icon" aria-label="Notifications" onClick={onInbox}>
                <MailIcon />
                {inboxCount ? <span className="topbar-badge">{inboxCount}</span> : null}
              </button>
            ) : null}
            <button type="button" className="topbar-icon" aria-label="Insights" onClick={() => navigate('/insights')}>
              <LightbulbIcon />
            </button>
            <button type="button" className="topbar-icon" aria-label="Settings" onClick={() => navigate('/settings')}>
              <GearIcon />
            </button>
          </>
        ) : null}
      </div>
    </header>
  )
}
