import { BackButton } from '../../components/nav/BackButton'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellIcon, BottleIcon, ChartIcon, ChevronRightIcon, FaceIcon, GearIcon, HeartIcon, MoonIcon, PumpIcon, ScaleIcon, SlidersIcon, SunIcon, TagIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { Segmented } from '../../components/ui/Segmented'
import { Sheet } from '../../components/ui/Sheet'
import { useChildren } from '../../hooks/useChildren'
import { useGoBack } from '../../hooks/useGoBack'
import { useHatch } from '../../hooks/useHatch'
import { rangeDays, useChildEvents, useGrowth } from '../../hooks/useEvents'
import { usePrinterStatus } from '../../hooks/useMilk'
import { usePeople } from '../../hooks/usePeople'
import { usePrefs } from '../../hooks/usePrefs'
import { fetchProfile, logout } from '../../lib/api/auth'
import { companion, type NudgeKind, type NudgeSettings as NudgeSettingsValue, type PrinterStatus } from '../../lib/api/companion'
import { qk } from '../../lib/api/keys'
import { downloadText, timelineToCsv } from '../../lib/csv'
import { buildTimeline } from '../../lib/events'
import foodCredits from '../../lib/food-credits.json'
import { hatchRowSummary } from '../../lib/hatch'
import { labelSize } from '../../lib/labels'
import { capitalise, peopleSummary } from '../../lib/people'
import type { Theme } from '../../lib/prefs'
import { volumeLabel } from '../../lib/units'
import { applyUpdate, BUILD, onUpdateReady } from '../../lib/update'
import { releasesUpTo } from '../../lib/whats-new'
import { WhatsNewSheet } from '../whats-new/WhatsNew'
import { NotificationStatus } from '../notifications/NotificationStatus'
import { PushContact } from '../notifications/PushContact'
import { TimeZoneLine } from '../notifications/TimeZoneLine'
import { NudgeSettings } from '../notifications/NudgeSettings'
import { useNotifications, type PushState } from '../notifications/useNotifications'
import { useNudges } from '../notifications/useNudges'
import { clockLabel } from '../../lib/nudges'
import { HatchSheet } from './HatchSheet'
import { LabelSettingsSheet } from './LabelSettingsSheet'
import { PeopleSheet } from './PeopleSheet'
import { PretermSheet } from './PretermSheet'
import { CaloriesSheet } from './CaloriesSheet'
import { powderOf } from '../../lib/fortify'
import { calorieTracking, type CalorieTracking } from '../../lib/calories'
import { PumpsSheet } from './PumpsSheet'
import { useChildSettings } from '../../hooks/useChildSettings'
import { ageBasis, pretermState } from '../../lib/preterm'
import { DEFAULT_PUMPS } from '../../lib/pumps'
import './more.css'

type Section = 'units' | 'notifications' | 'labels' | 'hatch' | 'people' | 'export' | 'pumps' | 'preterm' | 'calories'

/**
 * Settings: every configuration the app has, grouped, each row opening a focused sheet. A daily-use
 * screen that needs one of these sheets renders the same shared sheet in place (the milk label sheet
 * opens LabelSettingsSheet) instead of carrying its own settings or sending the user here.
 *
 * A header that stays put: Back, the person's name, and two round buttons on the other side (Appearance,
 * Sign out). Under it flat rows at full size grouped by what they touch (what Bramble tracks, the
 * household, this phone), each with its state in a few words, and the version line under the list. The
 * list slides in from the right (settings-in); the header does not move.
 */
export function MorePage() {
  const { prefs, update } = usePrefs()
  const { child } = useChildren()
  const navigate = useNavigate()
  const goBack = useGoBack()
  const [open, setOpen] = useState<Section | null>(null)
  const [news, setNews] = useState(false)

  const profile = useQuery({ queryKey: qk.profile, queryFn: fetchProfile, staleTime: Infinity })
  const username = profile.data?.user.username ?? null
  const people = usePeople()
  // The heading: who this phone is signed in as, the way the household knows them (their name, else
  // their role, else the login), so the page reads as theirs.
  const me = people.people?.find((p) => p.you) ?? null
  const heading = me?.name.trim() || me?.label || (username ? capitalise(username) : 'Settings')

  const notifications = useNotifications(child?.id ?? null)
  const nudges = useNudges(child?.id ?? null, open === 'notifications')
  const printer = usePrinterStatus()
  const hatch = useHatch(false)
  const { settings: childSettings } = useChildSettings(child?.id ?? null)
  const pumpNames = (childSettings.pumps ?? DEFAULT_PUMPS).map((p) => p.name)
  const health = useQuery({ queryKey: ['companion-health'], queryFn: () => companion.health().catch(() => null), staleTime: 60_000 })
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => onUpdateReady(setUpdateReady), [])

  const [exportDays, setExportDays] = useState<'30' | '90' | '365'>('90')
  const exportRange = rangeDays(Number(exportDays))
  const events = useChildEvents(open === 'export' && child ? child.id : null, exportRange)
  const growth = useGrowth(open === 'export' && child ? child.id : null)
  // Everything means everything: weights, heights and head sizes ride along, and a list that failed to
  // load stops the download rather than handing over a file with a hole in it.
  const exportLoading = events.isLoading || growth.isLoading
  const exportFailed = events.isError || growth.isError
  function doExport() {
    if (!child || exportLoading || exportFailed) return
    const from = exportRange.from.getTime()
    const items = buildTimeline({ ...events, growth: growth.data }, prefs.units).filter((t) => t.at.getTime() >= from)
    downloadText(`${child.first_name.toLowerCase()}-bramble-${new Date().toISOString().slice(0, 10)}.csv`, timelineToCsv(items, child))
  }

  const units = prefs.units
  const setUnit = <K extends keyof typeof units>(k: K, v: (typeof units)[K]) => update({ units: { ...units, [k]: v } })
  const unitSummary = `${volumeLabel(units.volume)} · ${units.weight} · °${units.temp.toUpperCase()} · ${units.length}`
  const goalDays = childSettings.stashGoalDays ?? null
  const pretermSummary = child ? pretermState(ageBasis(child, childSettings)) : 'Off'
  const pumpSummary = pumpNames.length ? `${pumpNames.join(', ')}${goalDays ? ` · goal ${goalDays} days` : ''}` : 'Add your pumps to compare them'

  // Sign out is a round button in the header beside Appearance; a stray tap must not end the session,
  // so it asks once in a small card under the header.
  const [confirmOut, setConfirmOut] = useState(false)
  function signOut() {
    logout()
    // The sign-in page clears the cache when it mounts, after Settings has gone (its queries would refetch with no token).
    navigate('/signin', { replace: true })
  }
  const adminUrl = `${location.protocol}//${location.hostname}:8000/`
  const close = () => setOpen(null)

  // Appearance is one round button: each tap moves Auto -> Light -> Dark -> Auto. The icon shows the
  // current mode; a short line under it says what it is now and what the next tap does.
  const theme = prefs.theme
  const nextTheme = THEME_NEXT[theme]
  const [themeNote, setThemeNote] = useState(0)
  useEffect(() => {
    if (!themeNote) return
    const t = window.setTimeout(() => setThemeNote(0), 2000)
    return () => window.clearTimeout(t)
  }, [themeNote])
  function cycleTheme() {
    update({ theme: nextTheme })
    setConfirmOut(false)
    setThemeNote((n) => n + 1)
  }

  // The header stays at the top with the page's own background (Back, Appearance and Sign out always in
  // reach); a hairline appears under it once the list scrolls beneath it. Being opaque also keeps iOS from
  // drawing its soft blurred edge over the name, which it does to page content under the status bar.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 2)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // "Dad" fits between Back and the two buttons at full size; "Grandma Josephine" does not, and squeezing
  // it there broke it mid-word. A name wider than that gap gets its own line under the buttons instead.
  const headRef = useRef<HTMLElement>(null)
  const nameRef = useRef<HTMLHeadingElement>(null)
  const [longName, setLongName] = useState(false)
  useLayoutEffect(() => {
    const head = headRef.current
    const name = nameRef.current
    if (!head || !name) return
    const measure = () => setLongName(nameTooWide(head, name))
    measure()
    void document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [heading])
  const headClass = ['settings-head', scrolled ? 'scrolled' : '', longName ? 'long' : ''].filter(Boolean).join(' ')

  return (
    <>
      <main className="page settings-page">
        <header ref={headRef} className={headClass}>
          <BackButton onClick={goBack} />
          <span className="settings-head-text">
            <h1 ref={nameRef} className="settings-name">
              {heading}
            </h1>
            <span className="small muted">Settings</span>
          </span>
          <span className="settings-head-actions">
            <button type="button" className="settings-head-btn" onClick={cycleTheme} aria-label={`Appearance: ${THEME_NAME[theme]}. Tap for ${THEME_NAME[nextTheme]}`}>
              {theme === 'light' ? <SunIcon /> : theme === 'dark' ? <MoonIcon /> : <ThemeIcon />}
            </button>
            <button type="button" className={confirmOut ? 'settings-head-btn on' : 'settings-head-btn'} onClick={() => { setThemeNote(0); setConfirmOut((v) => !v) }} aria-label="Sign out" aria-expanded={confirmOut}>
              <SignOutIcon />
            </button>
          </span>
          {themeNote ? (
            <span key={themeNote} className="settings-pop settings-theme-note" role="status">
              <span className="strong">{THEME_NAME[theme]}</span> · tap again for {THEME_NAME[nextTheme]}
            </span>
          ) : null}
          {confirmOut ? <SignOutConfirm username={username} onCancel={() => setConfirmOut(false)} onConfirm={signOut} /> : null}
        </header>

        <SettingsGroup title="Tracking">
          <SettingsRow icon={<BellIcon />} title="Notifications" value={notificationSummary(notifications.state, nudges.settings)} onClick={() => setOpen('notifications')} />
          <SettingsRow icon={<TagIcon />} title="Milk labels & printer" value={labelSummary(labelSize(prefs.labels.size).label, printer.data, prefs.labels.autoPrint)} onClick={() => setOpen('labels')} />
          <SettingsRow icon={<PumpIcon />} title="Pumps" value={pumpSummary} onClick={() => setOpen('pumps')} />
          <SettingsRow icon={<BottleIcon />} title="Calories & fortifying" value={calorieSummary(calorieTracking(childSettings))} onClick={() => setOpen('calories')} />
          <SettingsRow icon={<ScaleIcon />} title="Hatch scale" value={hatchRowSummary(hatch.status)} onClick={() => setOpen('hatch')} />
          <SettingsRow icon={<HeartIcon />} title="Born early" value={pretermSummary === 'Off' ? 'Corrected age and the NICU stay' : pretermSummary} onClick={() => setOpen('preterm')} />
        </SettingsGroup>

        <SettingsGroup title="Household">
          <SettingsRow icon={<FaceIcon />} title="People" value={peopleSummary(people.people)} onClick={() => setOpen('people')} />
          <SettingsRow icon={<ChartIcon />} title="Export CSV" value={`Everything logged for ${child?.first_name ?? 'your child'}`} onClick={() => setOpen('export')} />
          <SettingsRow icon={<GearIcon />} title="Baby Buddy admin" value="Raw data, children, site settings" href={adminUrl} />
        </SettingsGroup>

        <SettingsGroup title="This phone">
          <SettingsRow icon={<SlidersIcon />} title="Units" value={unitSummary} onClick={() => setOpen('units')} />
        </SettingsGroup>

        <footer className="settings-foot">
          <p className="xs muted version-line" data-testid="version">
            App {BUILD.version} · build {BUILD.sha} ({BUILD.date}) · server {health.data?.version ?? '…'}
            {updateReady ? (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={() => void applyUpdate()}>
                  update ready — tap to install
                </button>
              </>
            ) : null}
          </p>
          <button type="button" className="settings-news" onClick={() => setNews(true)}>
            What’s new in {BUILD.version}
          </button>
          <details className="credits">
            <summary>About · photo credits</summary>
            <p className="xs muted">Bramble · self-hosted · no subscriptions, no ads, no upsells.</p>
            <p className="xs muted">Food photos are public domain / CC0 from rawpixel and Wikimedia Commons via Openverse.</p>
            <ul className="credits-list">
              {Object.entries(foodCredits as unknown as Record<string, { title: string | null; creator: string | null; license: string; source: string; url: string }>).map(([id, c]) => (
                <li key={id} className="xs muted">
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {id}
                  </a>
                  {c.creator ? ` · ${c.creator}` : ''} · {c.license} · {c.source}
                </li>
              ))}
            </ul>
          </details>
        </footer>
      </main>

      <Sheet open={open === 'units'} title="Units" onClose={close}>
        <div className="stack">
          <p className="small muted">Your choice for this phone. Every entry is converted on the fly, so switching never changes what was logged, and each caregiver can pick their own.</p>
          <div className="unit-row">
            <span>Volume</span>
            <Segmented label="Volume unit" options={[{ value: 'oz', label: 'oz' }, { value: 'ml', label: 'mL' }]} value={units.volume} onChange={(v) => setUnit('volume', v)} />
          </div>
          <div className="unit-row">
            <span>Weight</span>
            <Segmented label="Weight unit" options={[{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }]} value={units.weight} onChange={(v) => setUnit('weight', v)} />
          </div>
          <div className="unit-row">
            <span>Temperature</span>
            <Segmented label="Temperature unit" options={[{ value: 'f', label: '°F' }, { value: 'c', label: '°C' }]} value={units.temp} onChange={(v) => setUnit('temp', v)} />
          </div>
          <div className="unit-row">
            <span>Length</span>
            <Segmented label="Length unit" options={[{ value: 'in', label: 'in' }, { value: 'cm', label: 'cm' }]} value={units.length} onChange={(v) => setUnit('length', v)} />
          </div>
        </div>
      </Sheet>

      <Sheet open={open === 'notifications'} title="Notifications" onClose={close}>
        <div className="stack notif-sheet">
          <NotificationStatus child={child?.id ?? null} />
          <PushContact />
          <TimeZoneLine />
          <NudgeSettings child={child?.id ?? null} childName={child?.first_name ?? 'your child'} />
        </div>
      </Sheet>

      <LabelSettingsSheet open={open === 'labels'} onClose={close} />

      <HatchSheet open={open === 'hatch'} onClose={close} />

      <PeopleSheet open={open === 'people'} onClose={close} />
      <PumpsSheet open={open === 'pumps'} onClose={close} />
      <PretermSheet open={open === 'preterm'} onClose={close} />
      <CaloriesSheet open={open === 'calories'} onClose={close} />
      <WhatsNewSheet open={news} releases={releasesUpTo(BUILD.version)} onClose={() => setNews(false)} />

      <Sheet open={open === 'export'} title="Export CSV" onClose={close}>
        <div className="stack">
          <p className="small muted">
            Your data is yours. One CSV for {child?.first_name ?? 'your child'}: sleep, feeds, diapers, pumping, tummy time and activities, temperatures, medicine, notes, milestones, and weights, heights and head sizes.
          </p>
          <Segmented label="Export range" options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }]} value={exportDays} onChange={setExportDays} />
          {exportFailed ? (
            <p className="small log-error" role="alert">
              Part of the log did not load, so the file would be missing entries. Check the connection to Baby Buddy and try again.
            </p>
          ) : null}
          <Button variant="primary" block onClick={doExport} disabled={exportLoading || exportFailed || !child} loading={exportLoading}>
            Download CSV
          </Button>
        </div>
      </Sheet>
    </>
  )
}

/** "10:00 PM" -> "10 PM": the row has room for a few words, not for zeros. */
const shortClock = (hhmm: string) => clockLabel(hhmm).replace(':00', '')

const NUDGE_KINDS: NudgeKind[] = ['feed', 'pump', 'diaper', 'summary', 'weight', 'supply', 'activity']

/** The Notifications row: whether this phone gets them, and if so how many reminders and the quiet hours. */
function notificationSummary(state: PushState | undefined, nudges: NudgeSettingsValue): string {
  if (!state) return 'Checking…'
  if (state.permission === 'denied') return 'Blocked in the iPhone’s Settings'
  if (state.support === 'ios-needs-install') return 'Off · needs the Home Screen app'
  if (state.support !== 'ok') return 'Not available in this browser'
  if (!state.subscribed || state.permission !== 'granted') return 'Off on this phone'
  if (state.serverReachable === false || state.serverPush === false || state.registered === false) return 'On · needs attention'
  const on = NUDGE_KINDS.filter((k) => nudges[k]).length + (nudges.milk ? 1 : 0)
  return `On · ${on} reminder${on === 1 ? '' : 's'} · quiet ${shortClock(nudges.quietStart)}–${shortClock(nudges.quietEnd)}`
}

const PRINTER_NAMES: Record<string, string> = { zebra: 'Zebra', brother_ql: 'Brother QL', niimbot: 'Niimbot', bridge: 'Bluetooth printer', file: 'File printer' }

/** The Milk labels row: the stock size, the printer, and whether a saved pumping prints by itself. */
function labelSummary(size: string, printer: PrinterStatus | undefined, autoPrint: boolean): string {
  if (!printer) return size
  if (!printer.configured) return `${size} · share / AirPrint`
  const name = (printer.kind && PRINTER_NAMES[printer.kind]) || (printer.kind ? capitalise(printer.kind) : 'Server printer')
  return `${size} · ${name}${autoPrint ? ' · prints on save' : ''}`
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group" aria-label={title}>
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-list">{children}</div>
    </section>
  )
}

/**
 * Whether the name, on one line at its full size, is wider than the gap the header leaves it between Back
 * and the two buttons. Measured with the heading's own font, so it holds for any name and screen width.
 */
function nameTooWide(head: HTMLElement, name: HTMLElement): boolean {
  const text = name.textContent ?? ''
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return false
  const cs = getComputedStyle(name)
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const spacing = parseFloat(cs.letterSpacing) || 0
  const need = ctx.measureText(text).width + spacing * text.length
  const hs = getComputedStyle(head)
  const gap = parseFloat(hs.columnGap) || 0
  const fixed = [...head.children].filter((el) => !el.contains(name) && getComputedStyle(el).position !== 'absolute' && getComputedStyle(el).position !== 'fixed')
  const taken = fixed.reduce((sum, el) => sum + (el as HTMLElement).offsetWidth, 0) + gap * fixed.length
  const avail = head.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight) - taken
  return need > avail
}

const THEME_NAME: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }
const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

/**
 * The one question before signing out, in a small card under the header's Sign out button. Escape or a
 * tap anywhere else closes it; focus starts on Cancel so a second stray tap does nothing.
 */
function SignOutConfirm({ username, onCancel, onConfirm }: { username: string | null; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cancel = useRef(onCancel)
  useEffect(() => {
    cancel.current = onCancel
  })
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel.current()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      {/* A tap outside only closes the card; it never lands on the row underneath. */}
      <div className="settings-scrim" onClick={onCancel} aria-hidden />
      <div ref={ref} className="settings-pop settings-confirm" role="group" aria-label="Sign out of this phone">
        <p className="settings-confirm-text">
          Sign out{username ? <strong> {username}</strong> : null} on this phone?
        </p>
        <div className="settings-confirm-actions">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Sign out
          </Button>
        </div>
      </div>
    </>
  )
}

/** "On · 24 kcal/oz · Similac · goal 120", or Off. */
function calorieSummary(tracking: CalorieTracking | null): string {
  if (!tracking) return 'Off · for babies who need more calories'
  const parts = ['On']
  if (tracking.fortify) parts.push(`${tracking.fortify.kcalPerOz} kcal/oz · ${tracking.fortify.with === 'concentrate' ? 'concentrate' : powderOf(tracking.fortify).name}`)
  if (tracking.goal) parts.push(`goal ${tracking.goal} kcal/kg`)
  return parts.join(' · ')
}

function SettingsRow({ icon, title, value, onClick, href }: { icon: ReactNode; title: string; value: string; onClick?: () => void; href?: string }) {
  const body = (
    <>
      <span className="settings-row-icon" aria-hidden>
        {icon}
      </span>
      <span className="grow settings-row-text">
        <span className="settings-row-title">{title}</span>
        <span className="small muted settings-row-value">{value}</span>
      </span>
      {href ? <ExternalIcon className="chev" /> : <ChevronRightIcon className="chev" aria-hidden />}
    </>
  )
  if (href) {
    return (
      <a className="settings-row" href={href} target="_blank" rel="noreferrer">
        {body}
      </a>
    )
  }
  return (
    <button type="button" className="settings-row" onClick={onClick}>
      {body}
    </button>
  )
}

/* Three small marks only this page uses, drawn like the shared set (24 grid, 1.8 stroke, round caps). */
function Glyph({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}
function ThemeIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </Glyph>
  )
}
function SignOutIcon() {
  return (
    <Glyph>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </Glyph>
  )
}
function ExternalIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />
    </Glyph>
  )
}
