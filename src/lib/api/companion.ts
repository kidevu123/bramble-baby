/**
 * Client for the Bramble companion service (server/ in this repo), mounted at /bramble/ by nginx.
 * It stores what Baby Buddy has no model for (contractions, activities, milestones, shared child
 * settings, reminders) and delivers Web Push notifications. Auth reuses the Baby Buddy API token.
 */
import type { NicuStay } from '../preterm'
import type { PumpSpec } from '../pumps'
import type { UnitPrefs } from '../units'
import { api } from './client'
import type { Id } from './types'

export const COMPANION = '/bramble'

export type ActivityType = 'bath' | 'story' | 'screen' | 'skin' | 'play' | 'outdoors' | 'massage' | 'other'
export type MilestoneCategory = 'motor' | 'social' | 'language' | 'cognitive' | 'feeding' | 'other'

export interface Contraction {
  id: Id
  child: Id
  start: string
  end: string | null
  intensity: number | null
  notes: string
}

export interface Activity {
  id: Id
  child: Id
  type: ActivityType
  start: string
  end: string | null
  notes: string
  /** Who logged it (`caregiver:<username>`), like Baby Buddy entries; absent on a companion older than 1.24.0. */
  tags?: string[]
}

export interface Milestone {
  id: Id
  child: Id
  title: string
  date: string
  category: MilestoneCategory
  notes: string
}

export interface Reminder {
  id: Id
  child: Id
  at: string
  title: string
  body: string
  tag: string
  sent: boolean
}

export interface NapSettings {
  notify: boolean
  leadMinutes: number
  wakeWindowAdjustMinutes: number
  napsPerDayOverride: number | null
}

export interface ChildSettings {
  dayStart: string
  dayEnd: string
  /** Nap window settings (stored under the feature's old name, so phones keep what they set). */
  sweetSpot: NapSettings
  homeTiles: string[]
  customFoods: string[]
  reportFilters: Record<string, boolean>
  reportDayStart: 'day' | 'midnight'
  /** Sleep-plan questionnaire answers (shared so any caregiver sees the same plan). */
  sleepPlanAnswers?: Record<string, string | string[] | number>
  /** Needed for WHO growth percentiles; Baby Buddy has no field for it. */
  sex?: 'male' | 'female' | null
  /** The household's breast pumps (Settings › Pumps); a pumping entry names one in a `pump:<name>` tag. */
  pumps?: PumpSpec[]
  /** Set once the pump list was decided (by `PumpsSeeder` or saved in Settings › Pumps); see `PUMPS_DECIDED`. */
  pumpsDecided?: number
  /** The household's milk storage windows (Settings › Milk labels & printer): they date every bag on the server and
   *  print on every sticker, so they are shared; each phone keeps a copy in its label prefs (`MilkWindowsSync`). */
  milkWindows?: MilkWindows
  /** Grams a day the pediatrician asked for (Child tab); Reports › Growth measures the gain against it. */
  weightGoalGPerDay?: number | null
  /** The day the pediatrician gave that goal (yyyy-MM-dd); the gain is counted from then (weeks in the NICU do not count). */
  weightGoalSince?: string | null
  /** Days of bottles to have banked in the stash (Settings › Pumps); the Stash tab measures progress against it. */
  stashGoalDays?: number | null
  /** Settings › Born early: weeks + days of pregnancy at birth, in days (25 wk 3 d = 178), for a baby born before
   *  37 weeks; every age-typical figure then counts from the due date (`src/lib/preterm.ts`). */
  bornAtDays?: number | null
  /** Settings › Born early: the NICU stay (yyyy-MM-dd); while it lasts nothing judges feeds, sleep or diapers by age. */
  nicu?: NicuStay | null
  /**
   * The units the numbers in Baby Buddy are stored in for this child. Written once (StorageUnitsSeeder)
   * and never changed; every phone converts between these and its own display units at the API boundary.
   */
  storageUnits?: UnitPrefs
  /** Legacy (one interim build): the household's shared display units. Only used to seed `storageUnits`. */
  units?: UnitPrefs
}

export const DEFAULT_HOME_TILES = [
  'contractions',
  'sleep',
  'nursing',
  'bottle',
  'solids',
  'diaper',
  'potty',
  'pumping',
  'milestones',
  'medicine',
  'activity',
  'growth',
  'temperature',
]

export const DEFAULT_CHILD_SETTINGS: ChildSettings = {
  dayStart: '08:00',
  dayEnd: '18:00',
  sweetSpot: { notify: true, leadMinutes: 10, wakeWindowAdjustMinutes: 0, napsPerDayOverride: null },
  homeTiles: DEFAULT_HOME_TILES,
  customFoods: [],
  reportFilters: {},
  reportDayStart: 'day',
  // No `pumps` here: a household that never chose its pumps must read as undecided (`PumpsSeeder`), not as an empty
  // list. Readers use `settings.pumps ?? DEFAULT_PUMPS`. 1.34–1.38 filled it in, so the seeder never ran.
}

export interface PushScheduleItem {
  tag: string
  at: string
  title: string
  body: string
}

export interface CompanionHealth {
  ok: boolean
  printer?: PrinterStatus
  /** Keys present and the push library installed: the server can send. */
  push: boolean
  /** pywebpush importable on the server. */
  webpush?: boolean
  /** VAPID key pair present. */
  vapid?: boolean
  problem?: string | null
  subscriptions?: number
  lastPushError?: string | null
  lastPushErrorAt?: string | null
  /** Can this server create Baby Buddy logins (Settings › People), and if not, what to set. No names. */
  people?: PeopleManagement
  version?: string
}

// ---- People (companion `people.py`): one Baby Buddy login per caregiver, with a role for the timeline

export type Role = 'mom' | 'dad' | 'grandma' | 'grandpa' | 'nanny' | 'other'

/** One person in the household: a Baby Buddy login plus what the timeline calls them. */
export interface Person {
  username: string
  /** Null for a login Bramble has not been told about yet (it exists in Baby Buddy, nobody set a role). */
  role: Role | null
  /** Their own name ("Sara"); the timeline shows it when the role is Other. */
  name: string
  user_id: Id | null
  /** False once removed: the login is deactivated and can be brought back. */
  active: boolean
  /** Baby Buddy staff: can manage people (and reach Baby Buddy's own admin pages). */
  staff: boolean
  /** What the timeline shows: the role, the name for Other, or the username. Computed by the server. */
  label: string
  you: boolean
  /** What a phone signed in as this person shows: the full app, or the simple screen (big buttons, time "now").
   *  Grandparents get the simple one unless an admin chose otherwise. Computed by the server. */
  screen: Screen
  /** The simple screen's buttons. */
  simpleActions: SimpleAction[]
}

export type Screen = 'full' | 'simple'
export type SimpleAction = 'bottle' | 'diaper'
export const SIMPLE_ACTIONS: SimpleAction[] = ['bottle', 'diaper']

export interface PeopleManagement {
  /** The companion can run Baby Buddy's Django (add a person, change a password, remove). */
  available: boolean
  /** Plain language naming exactly what to set on the server when it cannot. */
  problem: string | null
}

export interface PeopleListing {
  people: Person[]
  you: string
  canManage: boolean
  management: PeopleManagement
}

export type MilkLocation = 'room' | 'fridge' | 'freezer'
export type MilkStatus = 'stored' | 'used' | 'discarded'

/** One labelled bag or bottle of expressed milk in the household stash (companion `milk_bags`). */
export interface MilkBag {
  id: Id
  child: Id
  /** Six characters, printed in the label's QR code and under it. */
  code: string
  pumped_at: string
  /** What the label says the bag held, always millilitres on the wire; phones convert to their display unit. */
  volume_ml: number
  /** What is still in it. Equal to `volume_ml` until a bottle takes some; 0 once the bag is used up. */
  remaining_ml: number
  location: MilkLocation
  thawed: boolean
  expires_at: string
  status: MilkStatus
  pumping_id: Id | null
  /** The most recent bottle feeding poured from this bag; each take is in `uses`. */
  feeding_id: Id | null
  notes: string
  created: string
  created_by: Id | null
  used_at: string | null
  used_by: Id | null
  /** When thawed milk came out of the freezer; its expiry counts from here. Null for milk that was never thawed. */
  thawed_at?: string | null
  /** Everything that changed the balance, oldest first: bottles, milk used without a bottle, hand corrections. */
  uses: MilkUse[]
  /**
   * 'bottle': a premade bottle poured ahead of time from stash bags into a numbered fridge spot (`spot`, 1–5),
   * dated from its oldest milk; 'bag' (or absent, from an older server): pumped milk with a label.
   */
  kind?: 'bag' | 'bottle'
  spot?: number | null
}

/** This Bramble's own setup. `source`: set in the app ('settings'), on the host's environment ('server'), or not at all. */
export interface ServerConfig {
  /** The caller is an admin (Baby Buddy staff) and may change it. */
  admin: boolean
  /** The printer address (`zebra://192.0.2.2:9100` …), any token shown as ••••. */
  printer: { spec: string | null; source: 'settings' | 'server' | 'none'; kinds: string[] }
  pushContact: { value: string | null; source: 'settings' | 'server' | 'none' }
  /** The zone every clock in a notification is written in: set from a phone ('settings'), else the server's own. */
  timeZone?: { value: string; source: 'settings' | 'server'; server: string }
}

/** A travel sticker: a QR code printed ahead (the printer stays home) that becomes a bag's code once its pumping is logged. */
export interface TravelSticker {
  code: string
  child: Id
  bag_id: Id | null
  created: string
  assigned_at: string | null
  status: 'unused' | 'assigned'
}

/** One change to a bag's balance (companion `milk_uses`). Undo on the Stash tab reverses the last one. */
export interface FeedingTakes {
  bag: MilkBag | null
  use: MilkUse | null
  takes: { bag: MilkBag; use: MilkUse }[]
  total_ml: number
}

export interface MilkUse {
  id: Id
  bag: Id
  /** The bottle feeding this milk went into; null for milk used without a bottle or a hand correction. */
  feeding_id: Id | null
  /** Taken out of the bag; negative on a correction that put milk back. */
  amount_ml: number
  /** 'combined': poured into a premade bottle (`into_bag`). */
  /** … or `nicu`: the whole bag taken to the NICU (Stash › Take to the NICU). */
  kind: 'bottle' | 'elsewhere' | 'adjust' | 'combined' | 'nicu'
  at: string
  by_user: Id | null
  into_bag?: Id | null
}

/** Household storage windows (Settings → Milk labels) sent along so the server computes the same expiry the label prints. */
export interface MilkWindows {
  roomHours: number
  fridgeDays: number
  freezerMonths: number
}

export interface PrinterStatus {
  configured: boolean
  kind: string | null
  detail: string | null
  target?: string
}

/**
 * What became of one print request. `state` starts as `sent`; on a Zebra the companion then listens for the
 * printer's own answer and moves it to `busy` (it has the label), `ready` (nothing left to print), a problem
 * (`paper_out`, `head_open`, `paused`, `temperature`) or `no_answer`. Other backends stay `sent`, final.
 * While `checking` is true the answer is still to come, so the phone polls `print.job` for a few seconds.
 */
export interface PrintJob {
  id: number
  backend: string | null
  bag: string | null
  state: 'sent' | 'busy' | 'ready' | 'paper_out' | 'head_open' | 'paused' | 'temperature' | 'no_answer'
  checking: boolean
  /** Plain language for the caregiver, written by the server. */
  detail: string
  sent_at: string
  checked_at: string | null
}

export interface PushTestResult {
  sent: number
  subscriptions: number
  push: boolean
  errors: string[]
}

// ---- Hatch Grow scale (companion `hatch.py`): weights pulled from the owner's Hatch account into Baby Buddy

/** One baby in the Hatch account. `child` is the Bramble child it feeds: null = not chosen yet, 0 = not imported. */
export interface HatchBaby {
  id: number
  name: string
  child: Id | null
  imported: number
  /** Hatch weighings left alone because that weight was already typed into Bramble by hand. */
  matched: number
  pending: number
}

export type HatchProblemCode = 'needs_login' | 'rate_limited' | 'hatch_unreachable' | 'shape' | 'no_route' | 'hatch_refused' | 'units' | 'babybuddy_auth' | 'babybuddy'

export interface HatchStatus {
  connected: boolean
  email: string | null
  /** Hatch ended the session: the owner signs in again; nothing else is lost. */
  needsLogin: boolean
  syncing: boolean
  babies: HatchBaby[]
  imported: number
  matched: number
  pending: number
  lastSync: string | null
  lastSuccess: string | null
  sessionExpires: string | null
  pollMinutes: number
  problem: { code: HatchProblemCode; message: string; at: string } | null
  /** Plain text for whoever maintains Bramble: routes, status codes and key names. Never a token or a value. */
  report: string | null
}

// ---- Nudges (companion `nudges.py`): reminders computed from what was logged, replaced on every poll

export type NudgeKind = 'feed' | 'pump' | 'diaper' | 'summary' | 'weight' | 'supply' | 'activity'

/** Settings › Notifications: which nudges this household wants, shared by every phone (the server reads them). */
export interface NudgeSettings {
  feed: boolean
  pump: boolean
  /** Minutes between pump nudges; null = measured from the last sessions. */
  pumpEveryMinutes: number | null
  /** The milk expiry reminders milk.py schedules. */
  milk: boolean
  /** The "no wet diaper in N h" safety check; ignores quiet hours. */
  diaper: boolean
  summary: boolean
  /** "HH:MM" local. */
  summaryAt: string
  weight: boolean
  /** Pumping down: each of the last three full days under 85% of the eleven before. */
  supply: boolean
  /** Pings to the other caregivers' phones when someone logs something; off by default. */
  activity: boolean
  quietStart: string
  quietEnd: string
  /** The units the push text uses; the phone that last saved Settings sets them. Null = the child's storage units. */
  units: { volume: 'ml' | 'oz'; weight: 'lb' | 'kg' } | null
}

/** One line per nudge: when the server plans to send it next, or in plain words why not. */
export interface NudgePlan {
  at: string | null
  note: string
  title?: string
  body?: string
}

export interface NudgeStatus {
  settings: NudgeSettings
  /** The server holds a caregiver's Baby Buddy token and can read what was logged. */
  armed: boolean
  problem: { code: 'needs_login' | 'babybuddy'; message: string } | null
  lastRun: string | null
  subscriptions: number
  next: Partial<Record<NudgeKind, NudgePlan>>
  /** "10:00 PM to 7:00 AM" */
  quiet: string
}

export const companion = {
  health: () => api<CompanionHealth>(`${COMPANION}/health`),

  nudges: {
    /** Also arms the server with this phone's token so its poll can read Baby Buddy. */
    status: (child: Id) => api<NudgeStatus>(`${COMPANION}/nudges/${child}`),
    update: (child: Id, patch: Partial<NudgeSettings>) => api<NudgeStatus>(`${COMPANION}/nudges/${child}`, { method: 'PUT', body: JSON.stringify(patch) }),
    /** Recompute now (something was just logged) instead of at the next poll. */
    run: (child: Id) => api<NudgeStatus>(`${COMPANION}/nudges/${child}/run`, { method: 'POST', body: '{}' }),
  },

  settings: {
    get: async (child: Id): Promise<ChildSettings> => {
      const raw = await api<Partial<ChildSettings>>(`${COMPANION}/settings/${child}`)
      return { ...DEFAULT_CHILD_SETTINGS, ...raw, sweetSpot: { ...DEFAULT_CHILD_SETTINGS.sweetSpot, ...(raw.sweetSpot ?? {}) } }
    },
    /** Sends only the keys that changed; the companion merges them over the shared copy (top-level keys),
     *  so two phones changing different settings never undo each other. A whole object still works. */
    put: (child: Id, patch: Partial<ChildSettings>) => api<ChildSettings>(`${COMPANION}/settings/${child}`, { method: 'PUT', body: JSON.stringify(patch) }),
  },

  contractions: {
    list: (child: Id, sinceIso?: string) => api<Contraction[]>(`${COMPANION}/contractions`, { query: { child, since: sinceIso } }),
    create: (body: Omit<Contraction, 'id'>) => api<Contraction>(`${COMPANION}/contractions`, { method: 'POST', body: JSON.stringify(body) }),
    update: (id: Id, body: Partial<Contraction>) => api<Contraction>(`${COMPANION}/contractions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: Id) => api<void>(`${COMPANION}/contractions/${id}`, { method: 'DELETE' }),
  },

  activities: {
    list: (child: Id, sinceIso?: string) => api<Activity[]>(`${COMPANION}/activities`, { query: { child, since: sinceIso } }),
    create: (body: Omit<Activity, 'id'>) => api<Activity>(`${COMPANION}/activities`, { method: 'POST', body: JSON.stringify(body) }),
    update: (id: Id, body: Partial<Activity>) => api<Activity>(`${COMPANION}/activities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: Id) => api<void>(`${COMPANION}/activities/${id}`, { method: 'DELETE' }),
  },

  milestones: {
    list: (child: Id) => api<Milestone[]>(`${COMPANION}/milestones`, { query: { child } }),
    create: (body: Omit<Milestone, 'id'>) => api<Milestone>(`${COMPANION}/milestones`, { method: 'POST', body: JSON.stringify(body) }),
    update: (id: Id, body: Partial<Milestone>) => api<Milestone>(`${COMPANION}/milestones/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: Id) => api<void>(`${COMPANION}/milestones/${id}`, { method: 'DELETE' }),
  },

  reminders: {
    list: (child: Id) => api<Reminder[]>(`${COMPANION}/reminders`, { query: { child } }),
    create: (body: Omit<Reminder, 'id' | 'sent'>) => api<Reminder>(`${COMPANION}/reminders`, { method: 'POST', body: JSON.stringify(body) }),
    remove: (id: Id) => api<void>(`${COMPANION}/reminders/${id}`, { method: 'DELETE' }),
  },

  milk: {
    list: (child: Id, status?: MilkStatus) => api<MilkBag[]>(`${COMPANION}/milk`, { query: { child, status } }),
    get: (id: Id) => api<MilkBag>(`${COMPANION}/milk/${id}`),
    byCode: (code: string) => api<MilkBag>(`${COMPANION}/milk/code/${encodeURIComponent(code.trim().toUpperCase())}`),
    /**
     * The one way a bag is made (the label sheet calls it). Never two bags for one container: with
     * `pumping_id`, printing that entry's label again returns the same bag; milk with no pumping entry
     * sends a `client_key` (one per container), so a retry returns the first bag while a second,
     * identical bottle with its own key is a second bag. Expiry counts from `pumped_at` (or `thawed_at`).
     */
    create: (body: {
      child: Id
      pumped_at: string
      volume_ml: number
      location?: MilkLocation
      pumping_id?: Id | null
      /** Milk that was frozen and has thawed: needs `thawed_at`, and cannot be in the freezer. */
      thawed?: boolean
      thawed_at?: string
      client_key?: string
      notes?: string
      windows?: MilkWindows
      /** A travel sticker printed ahead: the bag takes its code (and an existing bag for this pumping entry is re-coded). */
      travel_code?: string
    }) => api<MilkBag>(`${COMPANION}/milk`, { method: 'POST', body: JSON.stringify(body) }),
    /**
     * `status: 'stored'` on a used or discarded bag is Undo (the last use is reversed); `remaining_ml` sets what
     * is left by hand (0 means used; more than 0 on a used-up bag brings it back into the stash).
     */
    update: (id: Id, body: Partial<Pick<MilkBag, 'location' | 'status' | 'feeding_id' | 'pumping_id' | 'notes' | 'volume_ml' | 'remaining_ml' | 'pumped_at' | 'thawed'>> & { windows?: MilkWindows; /** When the bag really changed place (default now); the server refuses a move after its window ended. */ moved_at?: string; /** The bag's milk went on this travel sticker: the bag takes its code. */ travel_code?: string }) =>
      api<MilkBag>(`${COMPANION}/milk/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    /**
     * Scan out from one bag: the one-bag case of `setTakes` (this bag and no other). Saving the same feeding
     * again does not take the milk twice, a new amount adjusts what it took, and 0 gives the milk back.
     */
    use: (id: Id, body: { amount_ml: number; feeding_id?: Id | null }) => api<MilkBag>(`${COMPANION}/milk/${id}/use`, { method: 'POST', body: JSON.stringify(body) }),
    /** Every bag a bottle feeding was poured from (oldest take first) and the total; `bag`/`use` are the latest take, both null when it was not from the stash. */
    forFeeding: (feedingId: Id) => api<FeedingTakes>(`${COMPANION}/milk/feeding/${feedingId}`),
    /**
     * One bottle from several bags: the feeding's whole allocation at once. A bag of the feeding's not in the
     * list gets its milk back, a listed bag's take is set to the amount, and [] gives everything back (the
     * bottle was deleted or is no longer from the stash). Checked as a whole: a refusal changes nothing.
     */
    setTakes: (feedingId: Id, takes: { bag: Id; amount_ml: number }[]) => api<FeedingTakes>(`${COMPANION}/milk/feeding/${feedingId}`, { method: 'PUT', body: JSON.stringify({ takes }) }),
    remove: (id: Id) => api<void>(`${COMPANION}/milk/${id}`, { method: 'DELETE' }),
    /**
     * Premade bottles poured ahead of time, one per numbered fridge spot: the milk leaves the listed bags now and
     * each bottle becomes a stash item (`kind: 'bottle'`). Checked as a whole (a refusal changes nothing); a
     * bottle sent again with its `client_key` is returned, not made twice.
     */
    /** Travel stickers printed ahead (codes with no milk yet), newest first. */
    travel: (child: Id) => api<TravelSticker[]>(`${COMPANION}/milk/travel`, { query: { child } }),
    /** One travel sticker by its code (a scan); 404 when the code is not one. */
    travelByCode: (code: string) => api<TravelSticker>(`${COMPANION}/milk/travel/${encodeURIComponent(code.trim().toUpperCase())}`),
    /** `count` new travel sticker codes (1–30); the same `client_key` again returns the same codes. */
    reserveTravel: (child: Id, count: number, clientKey: string) => api<TravelSticker[]>(`${COMPANION}/milk/travel`, { method: 'POST', body: JSON.stringify({ child, count, client_key: clientKey }) }),
    /** Undo a premade bottle nobody has fed from: its milk goes back on the bags it was poured from, its spot is free. */
    /** Bags taken to the NICU in one trip: each leaves the home stash whole. */
    toNicu: (child: Id, bags: Id[]) => api<MilkBag[]>(`${COMPANION}/milk/nicu`, { method: 'POST', body: JSON.stringify({ child, bags }) }),
    /** A premade bottle moved to another fridge spot; a bottle already there swaps into its old one. */
    moveBottle: (id: Id, spot: number) => api<MilkBag[]>(`${COMPANION}/milk/${id}/spot`, { method: 'POST', body: JSON.stringify({ spot }) }),
    unmakeBottle: (id: Id) => api<MilkBag[]>(`${COMPANION}/milk/${id}/unmake`, { method: 'POST', body: '{}' }),
    makeBottles: (body: { child: Id; bottles: { spot: number; takes: { bag: Id; amount_ml: number }[]; client_key: string }[]; windows?: MilkWindows }) =>
      api<MilkBag[]>(`${COMPANION}/milk/bottles`, { method: 'POST', body: JSON.stringify(body) }),
  },

  /** This Bramble's own setup (the printer, the push contact); any signed-in person reads it, an admin changes it. */
  config: {
    get: () => api<ServerConfig>(`${COMPANION}/config`),
    update: (body: { printer?: string | null; pushContact?: string | null; timeZone?: string | null }) => api<ServerConfig>(`${COMPANION}/config`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  print: {
    status: () => api<PrinterStatus>(`${COMPANION}/print/status`),
    /** Prints a label PNG on the printer attached to the server; no phone app involved. `code` is the bag's, for the server log. */
    label: (pngBase64: string, code?: string | null) =>
      api<{ ok: boolean; printed: string; job: PrintJob }>(`${COMPANION}/print/label`, { method: 'POST', body: JSON.stringify({ png: pngBase64, code: code ?? undefined }) }),
    /** What became of one print request (see PrintJob); polled while `checking`. */
    job: (id: number) => api<PrintJob>(`${COMPANION}/print/job/${id}`),
  },

  hatch: {
    status: () => api<HatchStatus>(`${COMPANION}/hatch`),
    /** The password is used once by the companion to sign in to Hatch and is not stored anywhere. */
    connect: (email: string, password: string) => api<HatchStatus>(`${COMPANION}/hatch/connect`, { method: 'POST', body: JSON.stringify({ email, password }) }),
    disconnect: () => api<HatchStatus>(`${COMPANION}/hatch/disconnect`, { method: 'POST', body: '{}' }),
    sync: () => api<HatchStatus>(`${COMPANION}/hatch/sync`, { method: 'POST', body: '{}' }),
    /** `child` 0 = do not import this baby. */
    mapBabies: (babies: { id: number; child: Id }[]) => api<HatchStatus>(`${COMPANION}/hatch/babies`, { method: 'PUT', body: JSON.stringify({ babies }) }),
  },

  people: {
    /** `fresh` makes the server ask Baby Buddy's Django for its user list again (the People sheet does this when it opens). */
    list: (fresh = false) => api<PeopleListing>(`${COMPANION}/people`, { query: fresh ? { fresh: 1 } : undefined }),
    /** Admin only. Creates the Baby Buddy login and its API token on the server; the password is used once there. */
    add: (body: { username: string; password: string; role: Role; name: string }) => api<Person>(`${COMPANION}/people`, { method: 'POST', body: JSON.stringify(body) }),
    /** Role and name are Bramble's own; `password` goes to Baby Buddy; `active: false` removes, `true` brings back. */
    update: (username: string, body: { role?: Role; name?: string; password?: string; active?: boolean; screen?: Screen; simpleActions?: SimpleAction[] }) =>
      api<Person>(`${COMPANION}/people/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (username: string) => api<Person>(`${COMPANION}/people/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  },

  push: {
    vapidPublicKey: () => api<{ publicKey: string }>(`${COMPANION}/push/vapid`),
    subscribe: (subscription: PushSubscriptionJSON, child: Id | null) =>
      api<{ ok: boolean }>(`${COMPANION}/push/subscribe`, { method: 'POST', body: JSON.stringify({ subscription, child }) }),
    unsubscribe: (endpoint: string) => api<{ ok: boolean }>(`${COMPANION}/push/unsubscribe`, { method: 'POST', body: JSON.stringify({ endpoint }) }),
    /** Sends a test push. With an endpoint, only to that device, and reports why it failed if it did. */
    test: (endpoint: string | null) => api<PushTestResult>(`${COMPANION}/push/test`, { method: 'POST', body: JSON.stringify(endpoint ? { endpoint } : {}) }),
    /** Is this device's subscription in the server database? */
    status: (endpoint: string) =>
      api<{ registered: boolean; child: Id | null; push: boolean; problem: string | null; subscriptions: number }>(`${COMPANION}/push/status`, { method: 'POST', body: JSON.stringify({ endpoint }) }),
    /** Replace the automatic schedule (nap window etc.) for a child; one entry per tag. */
    schedule: (child: Id, items: PushScheduleItem[]) =>
      api<{ ok: boolean }>(`${COMPANION}/push/schedule`, { method: 'POST', body: JSON.stringify({ child, items }) }),
  },
}
