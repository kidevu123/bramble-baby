import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (props: P): P => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...props,
})

export const MoonIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor" stroke="none" />
  </svg>
)
export const DropIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3s6 6.3 6 10.5A6 6 0 0 1 6 13.5C6 9.3 12 3 12 3Z" />
  </svg>
)
export const BottleIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 2h4v3h-4z" />
    <path d="M9 5h6l1 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l1-3Z" />
    <path d="M8 13h8" />
  </svg>
)
export const PooIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 20h10a3 3 0 0 0 .8-5.9A3 3 0 0 0 16 9.5a3 3 0 0 0-2.4-4C13 4 12 3 12 3s-1.5 2-1 4a3 3 0 0 0-3 2.6A3 3 0 0 0 6.2 14 3 3 0 0 0 7 20Z" />
  </svg>
)
export const PumpIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 9a6 6 0 0 1 12 0v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V9Z" />
    <path d="M12 3v3" />
    <path d="M9 13h6" />
  </svg>
)
export const SpoonIcon = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="7" rx="4.5" ry="5" />
    <path d="M12 12v9" />
  </svg>
)
export const TummyIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="10" r="2.5" />
    <path d="M8.5 11c3 2 7 2 10.5 0" />
    <path d="M9 13.5v4.5M15 13.5V18" />
    <path d="M3 20h18" />
  </svg>
)
export const RulerIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17 17 3l4 4L7 21l-4-4Z" />
    <path d="m7 13 1.5 1.5M10 10l1.5 1.5M13 7l1.5 1.5" />
  </svg>
)
export const ThermoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a3.5 3.5 0 1 1-4 0Z" />
    <path d="M12 10v6" />
  </svg>
)
export const PillIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-45 12 12.5)" />
    <path d="m8.5 8.5 7 7" />
  </svg>
)
export const NoteIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M9 12h6M9 16h6" />
  </svg>
)
export const PlayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5v14l11-7L8 5Z" fill="currentColor" stroke="none" />
  </svg>
)
export const PauseIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
  </svg>
)
export const StopIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
  </svg>
)
export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const PlusCircleIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </svg>
)
export const ChartIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
  </svg>
)
export const SunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
export const FaceIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="13" r="8" />
    <path d="M9 13h.01M15 13h.01" strokeWidth="3" />
    <path d="M9.5 16.5c1.5 1 3.5 1 5 0" />
    <path d="M12 5c0-1.5 1-2.5 2-3" />
  </svg>
)
export const DotsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" />
  </svg>
)
export const InfoIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="7.75" r="1" fill="currentColor" stroke="none" />
  </svg>
)
/** Arrows out to the corners: zoom in, spread the data over the chart. */
export const ExpandIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" />
  </svg>
)
/** Arrows in from the corners: back to the whole chart. */
export const CollapseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 10h-6V4M4 14h6v6M14 10l6-6M10 14l-6 6" />
  </svg>
)
export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)
export const ChevronRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)
export const ChevronLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
)
export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12 5 5L20 7" />
  </svg>
)
export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
)
export const SettingsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
)
export const SparkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7L12 2Z" fill="currentColor" stroke="none" />
  </svg>
)
export const DryIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3s6 6.3 6 10.5A6 6 0 0 1 6 13.5C6 9.3 12 3 12 3Z" strokeDasharray="3 3" />
  </svg>
)
export const MixedIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 19h8a2.5 2.5 0 0 0 .6-4.9A2.5 2.5 0 0 0 12 10a2.5 2.5 0 0 0-2-3.3c.3-1.3-.5-2.7-1-3.2 0 0-1 1.6-.7 3.2A2.5 2.5 0 0 0 5.7 9.4 2.5 2.5 0 0 0 4.4 14 2.5 2.5 0 0 0 5 19Z" />
    <path d="M18 11s3 3.3 3 5.5a3 3 0 0 1-6 0c0-2.2 3-5.5 3-5.5Z" />
  </svg>
)

/** Bramble logo: a sprout with a berry, in brand teal + green. */
export const Logo = (p: P) => (
  <svg viewBox="0 0 32 32" aria-hidden {...p}>
    <path d="M16 30V17" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M16 20c-6 0-8-4-8-9 5 0 8 3 8 9Z" fill="var(--green)" />
    <path d="M16 20c6 0 8-4 8-9-5 0-8 3-8 9Z" fill="var(--green-dark)" />
    <circle cx="16" cy="8" r="5.5" fill="var(--teal)" />
    <circle cx="14" cy="6.5" r="1.4" fill="#fff" opacity=".8" />
  </svg>
)

/* ---- Home tile icons ---- */
export const StopwatchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="14" r="7" />
    <path d="M12 14V10M9 3h6M12 3v4M18 7l1.5-1.5" />
  </svg>
)
export const SleepZIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 15.5A8 8 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5Z" />
    <path d="M14 4h4l-4 4h4" />
    <path d="M19 9h2.5L19 11.5h2.5" />
  </svg>
)
export const NursingIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3s6 6.3 6 10.5A6 6 0 0 1 6 13.5C6 9.3 12 3 12 3Z" />
    <path d="M9.5 14.5a2.5 2.5 0 0 0 5 0" />
  </svg>
)
export const BottleTiltIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m13 4 3-1 2 2-1 3" />
    <path d="M9 8l5-2 5 5-2 5-9 5a2 2 0 0 1-2.8-.2L4 19.6a2 2 0 0 1 .2-2.8L9 8Z" />
    <path d="M7.5 12.5l4 4" />
    <path d="M19 3l1-1M21 6l1-.5" />
  </svg>
)
export const BowlIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12h18a9 9 0 0 1-18 0Z" />
    <path d="M7 12c0-3 2-5 5-5s5 2 5 5" />
    <path d="M12 7V4" />
  </svg>
)
export const DiaperIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7h18v3a9 9 0 0 1-6 8.5h-6A9 9 0 0 1 3 10V7Z" />
    <path d="M3 10h4a5 5 0 0 1 5 5v3M21 10h-4a5 5 0 0 0-5 5" />
  </svg>
)
export const PottyIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3h8v8H6z" />
    <path d="M4 11h16a8 8 0 0 1-6 7.7V21H10v-2.3A8 8 0 0 1 4 11Z" />
  </svg>
)
export const MilestoneIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
    <circle cx="17" cy="17" r="3" />
  </svg>
)
export const BathIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3Z" />
    <path d="M6 12V6a2 2 0 0 1 4 0" />
    <path d="M7 19v2M17 19v2" />
  </svg>
)
export const BookIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 6c-2-1.5-5-1.5-8-.5v13c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5v-13c-3-1-6-1-8 .5Z" />
    <path d="M12 6v13" />
  </svg>
)
export const ScreenIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
    <circle cx="12" cy="10" r="3" />
    <path d="M12 8.5V10l1 1" />
  </svg>
)
export const SkinIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 15c3 0 4 2 7 2h5a2 2 0 0 0 0-4h-4" />
    <path d="M3 19c3 0 4 2 7 2h8" />
    <path d="M14 3.5c1.5-1.5 4 0 3 2.5-1 2-3 3-3 3s-2-1-3-3c-1-2.5 1.5-4 3-2.5Z" />
  </svg>
)
export const PlayBlocksIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="12" width="7" height="7" rx="1" />
    <rect x="13" y="12" width="7" height="7" rx="1" />
    <rect x="8.5" y="4" width="7" height="7" rx="1" />
  </svg>
)
export const TreeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 6 11h3l-4 6h14l-4-6h3L12 3Z" />
    <path d="M12 17v4" />
  </svg>
)
export const MailIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)
export const GearIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
)
export const AlarmPlusIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="13" r="7" />
    <path d="M12 10v6M9 13h6" />
    <path d="M5 4 3 6M19 4l2 2" />
  </svg>
)
export const BellIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
)
export const HeartIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" />
  </svg>
)
export const CalendarClockIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <circle cx="15" cy="16" r="3" />
    <path d="M15 14.5V16l1 1" />
  </svg>
)
export const LightbulbIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1.3-1 2.5H9c0-1.2-.3-1.9-1-2.5A6 6 0 0 1 12 3Z" />
  </svg>
)
export const ClipboardIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V2h6v2M9 11l2 2 4-4M9 17h6" />
  </svg>
)
export const SlidersIcon = SettingsIcon
export const TagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
    <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)
export const PrinterIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" />
  </svg>
)

export const CameraIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

export const QrIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <path d="M14 14h3v3h-3zM20 14v3M17 20h3M14 20h1" />
  </svg>
)

export const SnowflakeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5l-14.2 11" />
    <path d="M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5" />
  </svg>
)

/** The sticker's fridge, drawn the same way: a tall box with the freezer line and two handles. */
export const FridgeIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="2.2" width="14" height="19.6" rx="2.5" />
    <path d="M5 9.5h14M8.5 5v2M8.5 12.5V16" />
  </svg>
)
/** Day milk, as on the sticker: a solid sun with eight short rays. */
export const DayIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <circle cx="12" cy="12" r="5.2" fill="currentColor" stroke="none" />
    <path d="M20 12h2.8M17.66 17.66l1.98 1.98M12 20v2.8M6.34 17.66l-1.98 1.98M4 12H1.2M6.34 6.34 4.36 4.36M12 4V1.2M17.66 6.34l1.98-1.98" />
  </svg>
)
/** Night milk, as on the sticker: a fat crescent opening to the upper right with a star in the opening. */
export const NightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.46 3.4A9.6 9.6 0 1 0 19.51 15.34A7.6 7.6 0 0 1 10.46 3.4Z" fill="currentColor" stroke="none" />
    <path d="M18.7 0.8 19.99 4.12 23.55 4.32 20.79 6.58 21.7 10.03 18.7 8.1 15.7 10.03 16.61 6.58 13.85 4.32 17.41 4.12Z" fill="currentColor" stroke="none" />
  </svg>
)

export const MilkBagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 3h10l1 3H6l1-3z" />
    <path d="M6 6h12v12a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6z" />
    <path d="M12 11c-1.6 1.8-2.4 3-2.4 4a2.4 2.4 0 0 0 4.8 0c0-1-.8-2.2-2.4-4z" />
  </svg>
)

/** A baby scale: weighing tray on a body with a dial (Settings › Hatch scale). */
export const ScaleIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4.5h16" />
    <path d="M12 4.5V8" />
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M8.5 15.5a3.5 3.5 0 0 1 7 0" />
    <path d="M12 15.5l1.9-2.3" />
  </svg>
)
export const MonitorIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="3" width="16" height="13" rx="3" />
    <circle cx="12" cy="9.5" r="3" />
    <circle cx="12" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
    <path d="M9 21h6" />
    <path d="M12 16v5" />
  </svg>
)
