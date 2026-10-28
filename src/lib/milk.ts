import { differenceInCalendarDays, format } from 'date-fns'
import type { MilkBag, MilkLocation, MilkUse, MilkWindows } from './api/companion'
import { convertVolume, formatVolume, roundTo, type VolumeUnit } from './units'
import { formatDurationShort, HOUR, MINUTE, parseDate } from './time'

/** What the QR code on a milk label contains. Short and self-describing, never a URL (no Safari detour). */
const QR_PREFIX = 'bramble:milk:'

export const qrPayload = (code: string): string => `${QR_PREFIX}${code.toUpperCase()}`

/** The bag code inside a scanned QR (or a code typed by hand), or null when it is not one of ours. */
export function parseQrPayload(text: string): string | null {
  const t = text.trim()
  const raw = t.toLowerCase().startsWith(QR_PREFIX) ? t.slice(QR_PREFIX.length) : t
  return /^[2-9A-HJ-NP-Z]{6}$/i.test(raw) ? raw.toUpperCase() : null
}

export type BagState = 'fresh' | 'soon' | 'expired'

/** How much life a stored bag has left, matching the server's reminder thresholds. */
export function bagState(bag: Pick<MilkBag, 'expires_at' | 'location'>, now: Date = new Date()): BagState {
  // Milliseconds, not whole minutes: differenceInMinutes truncates, which called a bag with 30 s left "expired".
  const msLeft = parseDate(bag.expires_at).getTime() - now.getTime()
  if (msLeft <= 0) return 'expired'
  const leadMs = (bag.location === 'freezer' ? 7 * 24 * 60 : bag.location === 'fridge' ? 12 * 60 : 60) * 60_000
  return msLeft <= leadMs ? 'soon' : 'fresh'
}

export const LOCATION_LABEL: Record<MilkLocation, string> = { room: 'Room temp', fridge: 'Fridge', freezer: 'Freezer' }

/** A millilitre figure in the phone unit. Bags are stored in mL, so oz comes out as 3.04 / 15.81; one decimal reads like what people pour. */
export function formatMl(ml: number, unit: VolumeUnit): string {
  const v = convertVolume(ml, 'ml', unit)
  return formatVolume(unit === 'oz' ? roundTo(v, 1) : v, unit)
}

/** The bag's label volume (what the physical bag says), in the phone unit. */
export function bagVolume(bag: Pick<MilkBag, 'volume_ml'>, unit: VolumeUnit): string {
  return formatMl(bag.volume_ml, unit)
}

/** Under this much left, a bag is empty (mirrors EMPTY_ML in server/milk.py). */
export const EMPTY_ML = 1
/** A bottle this much bigger than the balance (oz typed for a mL bag) takes the balance instead of being refused (OVER_TOLERANCE_ML on the server). */
const OVER_TOLERANCE_ML = 3

type Balance = Pick<MilkBag, 'volume_ml' | 'remaining_ml' | 'status'>

/** Some of the bag has been poured and some is still in it. A used-up bag is not "partly used", nor is one off by display rounding. */
export function isPartlyUsed(bag: Balance): boolean {
  return bag.remaining_ml >= EMPTY_ML && bag.remaining_ml < bag.volume_ml - 0.5
}

/** "80 of 120 mL" for a part-used bag; "120 mL" for a full one, or for a used-up one (that is what it held). */
export function bagLeft(bag: Balance, unit: VolumeUnit): string {
  if (!isPartlyUsed(bag)) return formatMl(bag.volume_ml, unit)
  const left = formatMl(bag.remaining_ml, unit)
  return `${left.slice(0, left.lastIndexOf(' '))} of ${formatMl(bag.volume_ml, unit)}`
}

const amountIn = (ml: number, unit: VolumeUnit): number => (unit === 'ml' ? Math.round(convertVolume(ml, 'ml', unit)) : roundTo(convertVolume(ml, 'ml', unit), 2))

/** Display-unit amount to prefill a bottle from a bag: what is left in it (rounded like the feeding slider expects). */
/** Millilitres to the hundredth, the server's precision. */
export function roundMl(ml: number): number {
  return roundTo(ml, 2)
}

export function bagAmountIn(bag: Pick<MilkBag, 'remaining_ml'>, unit: VolumeUnit): number {
  return amountIn(bag.remaining_ml, unit)
}

/** Display-unit amount the label prints: what the bag held, whatever has been poured since (it is the physical bag). */
export function labelAmountIn(bag: Pick<MilkBag, 'volume_ml'>, unit: VolumeUnit): number {
  return amountIn(bag.volume_ml, unit)
}

export function toMl(amount: number, unit: VolumeUnit): number {
  return roundTo(convertVolume(amount, unit, 'ml'), 2)
}

/** What a bottle of `amount` (phone unit) does to the bag: the server applies the same rules (`MilkStore.use`). */
export interface UsePlan {
  takeMl: number
  leftMl: number
  /** The bag leaves the stash as used. */
  empties: boolean
  /** More than the balance by more than rounding: the server refuses it. */
  over: boolean
}

export function planUse(bag: Pick<MilkBag, 'remaining_ml'>, amount: number, unit: VolumeUnit): UsePlan {
  const wanted = toMl(Math.max(0, amount || 0), unit)
  const takeMl = Math.min(wanted, bag.remaining_ml)
  const left = roundTo(bag.remaining_ml - takeMl, 2)
  const empties = takeMl > 0 && left < EMPTY_ML
  return { takeMl, leftMl: empties ? 0 : left, empties, over: wanted > bag.remaining_ml + OVER_TOLERANCE_ML }
}

/** One bag's share of a bottle poured from several bags. */
export interface TakePlan {
  bag: MilkBag
  /** What the bottle can draw on from this bag: what is in it, plus what this same bottle already took from it. */
  availableMl: number
  takeMl: number
  leftMl: number
  empties: boolean
}

export interface TakesPlan {
  takes: TakePlan[]
  /** Millilitres the picked bags cannot cover (0 when they can). */
  shortMl: number
  wantedMl: number
}

/**
 * A bottle of `amount` (the phone's unit) from the picked bags, filled in the order given: each bag gives all
 * it can before the next is touched, so the oldest picked bag empties first and the last one keeps the rest.
 * `available` lets an edited bottle count what it already took from a bag as still available to it.
 */
export function planTakes(bags: MilkBag[], amount: number, unit: VolumeUnit, available: (bag: MilkBag) => number = (b) => b.remaining_ml): TakesPlan {
  const wantedMl = toMl(Math.max(0, amount || 0), unit)
  let left = wantedMl
  const takes: TakePlan[] = bags.map((bag) => {
    const availableMl = roundTo(Math.max(0, available(bag)), 2)
    // A premade bottle a baby fed from is finished: what she did not drink is thrown away, so it is taken whole
    // (the feeding keeps the amount she drank).
    // Only when the bottle is needed at all: bags picked before it may already cover the feed.
    const takeMl = isNightBottle(bag) ? (left > 0 ? availableMl : 0) : roundTo(Math.min(left, availableMl), 2)
    left = roundTo(Math.max(0, left - takeMl), 2)
    const leftMl = roundTo(availableMl - takeMl, 2)
    const empties = takeMl > 0 && leftMl < EMPTY_ML
    return { bag, availableMl, takeMl, leftMl: empties ? 0 : leftMl, empties }
  })
  return { takes, shortMl: left > OVER_TOLERANCE_ML ? left : 0, wantedMl }
}

/** The bottle sheet's save line for several bags: each bag's share, what stays, or what is still missing. */
export function takesCopy(plan: TakesPlan, unit: VolumeUnit): string {
  if (plan.shortMl > 0) {
    const have = roundTo(plan.wantedMl - plan.shortMl, 2)
    return `The picked bags hold ${formatMl(have, unit)}, ${formatMl(plan.shortMl, unit)} short. Add another bag, make the bottle smaller, or set what is left in a bag from the Stash tab.`
  }
  const parts = plan.takes
    .filter((t) => t.takeMl > 0)
    .map((t) =>
      isNightBottle(t.bag)
        ? `premade bottle ${t.bag.spot} (${formatMl(t.takeMl, unit)}) · what she does not finish is thrown away`
        : t.empties
          ? `all ${formatMl(t.takeMl, unit)} from bag ${t.bag.code}`
          : `${formatMl(t.takeMl, unit)} from bag ${t.bag.code} (${formatMl(t.leftMl, unit)} stays)`,
    )
  if (!parts.length) return 'Set the amount to take from the stash'
  const leaving = plan.takes.filter((t) => t.empties && !isNightBottle(t.bag)).length
  return `${parts.join(' · ')}${leaving ? ` · ${leaving === 1 ? 'that bag leaves' : `${leaving} bags leave`} the stash` : ''}`
}

/** The bottle sheet's save line: what will be taken from the bag and what stays, or why it cannot be saved. */
export function takeCopy(bag: Pick<MilkBag, 'remaining_ml' | 'code'>, amount: number, unit: VolumeUnit): string {
  const plan = planUse(bag, amount, unit)
  if (plan.over) return `Only ${formatMl(bag.remaining_ml, unit)} is left in bag ${bag.code}. Make the bottle smaller, or set what is left in the bag from the Stash tab.`
  if (plan.takeMl <= 0) return `Set the amount to take from bag ${bag.code}`
  if (plan.empties) return `All ${formatMl(bag.remaining_ml, unit)} from bag ${bag.code} · the bag leaves the stash`
  return `${formatMl(plan.takeMl, unit)} from bag ${bag.code} · ${formatMl(plan.leftMl, unit)} stays in the stash`
}

/** A bottle leaving the bag it took from (moved to another bag, or no bag after all): "Bag 6SZTHB gets 40 mL back". */
export function giveBackCopy(bag: Pick<MilkBag, 'code'>, use: Pick<MilkUse, 'amount_ml'>, unit: VolumeUnit): string {
  return `Bag ${bag.code} gets ${formatMl(use.amount_ml, unit)} back`
}

/** When a bag was pumped, the way the bottle sheet says it: "today", "yesterday", "Tue" inside a week, else "Sep 28". */
export function pumpedWhen(pumped: Date, now: Date = new Date()): string {
  const days = differenceInCalendarDays(now, pumped)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return format(pumped, 'EEE')
  return format(pumped, 'MMM d')
}

/** One line of a bag's history: "40 mL bottle", "80 mL used without a bottle", "30 mL less, set by hand". */
export function describeUse(use: MilkUse, unit: VolumeUnit): string {
  const amount = formatMl(Math.abs(use.amount_ml), unit)
  if (use.kind === 'bottle') return `${amount} bottle`
  if (use.kind === 'elsewhere') return `${amount} used without a bottle`
  if (use.kind === 'combined') return `${amount} into a premade bottle`
  if (use.kind === 'nicu') return `${amount} taken to the NICU`
  return `${amount} ${use.amount_ml < 0 ? 'more' : 'less'}, set by hand`
}

export interface StashSummary {
  count: number
  totalMl: number
  byLocation: Record<MilkLocation, { count: number; ml: number }>
  /** The stored bag to use first: earliest expiry, excluding expired ones and premade bottles (they have spots). */
  useFirst: MilkBag | null
  /** Premade bottles ready in their spots (stored, not expired), spot 1 first. */
  bottles: MilkBag[]
  expiringSoon: number
  expired: number
}

export function summarizeStash(bags: MilkBag[], now: Date = new Date()): StashSummary {
  const stored = bags.filter((b) => b.status === 'stored')
  const byLocation: StashSummary['byLocation'] = { room: { count: 0, ml: 0 }, fridge: { count: 0, ml: 0 }, freezer: { count: 0, ml: 0 } }
  let expiringSoon = 0
  let expired = 0
  for (const b of stored) {
    byLocation[b.location].count++
    byLocation[b.location].ml += b.remaining_ml
    const state = bagState(b, now)
    if (state === 'soon') expiringSoon++
    if (state === 'expired') expired++
  }
  const usable = stored.filter((b) => bagState(b, now) !== 'expired').sort((a, b) => a.expires_at.localeCompare(b.expires_at) || a.pumped_at.localeCompare(b.pumped_at))
  const bottles = usable.filter(isNightBottle).sort((a, b) => (a.spot ?? 0) - (b.spot ?? 0))
  return { count: stored.length, totalMl: stored.reduce((s, b) => s + b.remaining_ml, 0), byLocation, useFirst: usable.find((b) => !isNightBottle(b)) ?? null, bottles, expiringSoon, expired }
}

/**
 * The bottle sheet's "Use milk from the stash" card, under its title: "3 bags · use first: 80 mL from Tue".
 * Null when there is no usable bag (empty stash, or only expired milk): the card then has nothing to say.
 */
export function stashHint(summary: Pick<StashSummary, 'count' | 'useFirst'> & { bottles?: MilkBag[] }, unit: VolumeUnit, now: Date = new Date()): string | null {
  if (!summary.useFirst) return null
  const count = summary.count - (summary.bottles?.length ?? 0)
  const bags = `${count} bag${count === 1 ? '' : 's'}`
  return `${bags} · use first: ${formatMl(summary.useFirst.remaining_ml, unit)} from ${pumpedWhen(parseDate(summary.useFirst.pumped_at), now)}`
}

/** Stored bags in the order they should be used: expired last (so they can be discarded), then soonest expiry first. */
/** Soonest deadline first, expired last: the top bag is the one to use first. "Expiring soon" is not a rank of its
 *  own, because its lead differs by place (12 h fridge, 1 h room): a fridge bag good until 10 PM must not sit above a
 *  room-temperature bag that has to be used by 8 PM. */
export function stashOrder(bags: MilkBag[], now: Date = new Date()): MilkBag[] {
  const expired = (b: MilkBag) => (bagState(b, now) === 'expired' ? 1 : 0)
  const at = (b: MilkBag) => parseDate(b.expires_at).getTime()
  return bags.filter((b) => b.status === 'stored').sort((a, b) => expired(a) - expired(b) || at(a) - at(b) || a.id - b.id)
}

export type StashSectionKey = MilkLocation | 'expired' | 'bottles'
export interface StashSection {
  key: StashSectionKey
  title: string
  bags: MilkBag[]
  /** What is still in this section's bags, in mL. */
  ml: number
}

/**
 * The Stash list in places: milk out at room temperature first (it has hours), then the fridge, the freezer, and
 * expired milk last (to discard). Inside each, soonest deadline first, like `stashOrder`. Empty places are left out.
 */
export function stashSections(bags: MilkBag[], now: Date = new Date()): StashSection[] {
  // Premade bottles have their own block (spots 1–5) on the Stash tab; an expired one joins the expired list.
  const order: StashSectionKey[] = ['room', 'fridge', 'freezer', 'expired']
  const groups = new Map<StashSectionKey, MilkBag[]>(order.map((k) => [k, []]))
  for (const b of stashOrder(bags, now)) {
    const expired = bagState(b, now) === 'expired'
    if (isNightBottle(b) && !expired) continue
    groups.get(expired ? 'expired' : b.location)!.push(b)
  }
  return order
    .filter((k) => groups.get(k)!.length)
    .map((k) => {
      const list = groups.get(k)!
      return { key: k, title: k === 'expired' ? 'Expired' : LOCATION_LABEL[k as MilkLocation], bags: list, ml: list.reduce((s, b) => s + b.remaining_ml, 0) }
    })
}

// ---- premade bottles: poured ahead of time into numbered fridge spots (stickers 1–5) -------------------------

/** The numbered spots in the fridge (mirrors SPOTS in server/milk.py). */
export const NIGHT_SPOTS = 5

export const isNightBottle = (bag: Pick<MilkBag, 'kind'>): boolean => bag.kind === 'bottle'

/** "Premade bottle 3" for a bottle, "Bag K7M2QP" for a bag: how a stash item is named in titles and lists. */
export const stashItemName = (bag: Pick<MilkBag, 'kind' | 'spot' | 'code'>): string => (isNightBottle(bag) ? `Premade bottle ${bag.spot}` : `Bag ${bag.code}`)

/** Spots without a bottle in them (an expired bottle still holds its spot until it is discarded). */
export function freeSpots(bags: MilkBag[]): number[] {
  const held = new Set(bags.filter((b) => isNightBottle(b) && b.status === 'stored' && b.spot).map((b) => b.spot))
  return Array.from({ length: NIGHT_SPOTS }, (_, i) => i + 1).filter((n) => !held.has(n))
}

/** Bags a premade bottle can be poured from, soonest deadline first: in the fridge or out, not frozen, not past their window. */
export function nightBottleSources(bags: MilkBag[], now: Date = new Date()): MilkBag[] {
  return stashOrder(bags, now).filter((b) => !isNightBottle(b) && b.location !== 'freezer' && b.remaining_ml >= EMPTY_ML && bagState(b, now) !== 'expired')
}

export interface NightBottlePlan {
  spot: number
  ml: number
  /** Less than the size asked for: the picked bags ran out on this one. */
  short: boolean
  takes: { bag: MilkBag; ml: number }[]
}

/**
 * `count` bottles of `sizeMl` each, into the given spots in order, poured from `sources` in order (soonest deadline
 * first): each bag gives all it can before the next is touched, so the milk that has to go first goes first. When
 * the bags run out the last bottle is smaller (`short`), and bottles with nothing in them are left out.
 */
export function planNightBottles(sources: MilkBag[], sizeMl: number, count: number, spots: number[]): NightBottlePlan[] {
  const left = sources.map((b) => b.remaining_ml)
  let i = 0
  const out: NightBottlePlan[] = []
  for (const spot of spots.slice(0, Math.max(0, count))) {
    let want = roundTo(Math.max(0, sizeMl), 2)
    const takes: { bag: MilkBag; ml: number }[] = []
    while (want > 0.005 && i < sources.length) {
      const ml = roundTo(Math.min(want, left[i]), 2)
      if (ml > 0) takes.push({ bag: sources[i], ml })
      left[i] = roundTo(left[i] - ml, 2)
      want = roundTo(want - ml, 2)
      if (left[i] < EMPTY_ML) i += 1
    }
    const ml = roundTo(takes.reduce((s, t) => s + t.ml, 0), 2)
    if (ml < EMPTY_ML) break
    out.push({ spot, ml, short: ml < sizeMl - OVER_TOLERANCE_ML, takes })
  }
  return out
}

/**
 * Rows a long section shows before "Show N more". The freezer shows only the next bag to thaw: its milk keeps for
 * months and is not reached for every day. A short section stays whole: one bag behind a button is worse than
 * one more row.
 */
export const SECTION_PREVIEW = 3
export const FREEZER_PREVIEW = 1
export const sectionPreview = (count: number, key?: StashSectionKey): number => {
  const rows = key === 'freezer' ? FREEZER_PREVIEW : SECTION_PREVIEW
  return count <= rows + 1 ? count : rows
}

/**
 * A bag's moment in a list row, short enough for one line at phone width: "today 12:05 PM", "Sat 12:44 PM" within
 * the week either way (pumped is past, good until is future, so the weekday is never ambiguous in its place),
 * "Oct 5, 4:45 PM" further off, or "Apr 6" with `time: false` (a freezer deadline months out needs no clock).
 * `today: ''` leaves today as the bare clock: in a list where other days carry a weekday, a time alone is today.
 */
export function bagStamp(at: Date, now: Date = new Date(), { time = true, today = 'today' }: { time?: boolean; today?: string } = {}): string {
  const days = differenceInCalendarDays(at, now)
  const clock = format(at, 'h:mm a')
  if (days === 0) return today ? `${today} ${clock}` : clock
  if (Math.abs(days) < 7) return `${format(at, 'EEE')} ${clock}`
  return time ? `${format(at, 'MMM d')}, ${clock}` : format(at, 'MMM d')
}

// ---- milk that already exists (added from the Stash tab, no pumping entry) ----------------------------

/** Hours thawed milk keeps, counted from the thaw; it is never refrozen. Mirrors THAWED_WINDOW in server/milk.py. */
export const THAWED_HOURS = { room: 2, fridge: 24 } as const

const DAYS_PER_MONTH = 30.4375 // the server's month, so the phone and the reminders agree to the minute

/**
 * When milk stops being safe, by the same rule the server applies (`expiry_for`): fresh milk counts from
 * the pumped time with the household's storage windows, thawed milk counts from the thaw. Used to show
 * the remaining time before a container is saved; a saved bag carries the server's own `expires_at`.
 */
export function expectedExpiry(milk: { pumpedAt: Date; location: MilkLocation; thawedAt?: Date | null }, windows: MilkWindows): Date {
  if (milk.thawedAt) return new Date(milk.thawedAt.getTime() + (milk.location === 'room' ? THAWED_HOURS.room : THAWED_HOURS.fridge) * HOUR)
  const hours = milk.location === 'room' ? windows.roomHours : milk.location === 'fridge' ? windows.fridgeDays * 24 : windows.freezerMonths * DAYS_PER_MONTH * 24
  return new Date(milk.pumpedAt.getTime() + hours * HOUR)
}

/** Where freshly pumped milk goes when it is saved. Room temp leads (the owner's ask: a bottle kept out for the next
 *  feed is the common case to reach for), while Fridge stays the one picked unless someone taps otherwise. */
export const PLACE_OPTIONS: { value: MilkLocation; label: string }[] = [
  { value: 'room', label: 'Room temp' },
  { value: 'fridge', label: 'Fridge' },
  { value: 'freezer', label: 'Freezer' },
]

/**
 * The line under the place choice. Kept out (a bottle due soon needs no warming): the fridge deadline and when
 * the reminder comes (an hour before, as the companion schedules it), or that the window has already gone.
 */
export function placeNote(location: MilkLocation, pumpedAt: Date, windows: MilkWindows, now: Date = new Date()): { text: string; late: boolean } | null {
  if (location === 'freezer') return { text: `Good for ${windows.freezerMonths} months frozen, counted from the pump.`, late: false }
  if (location !== 'room') return null
  const by = expectedExpiry({ pumpedAt, location: 'room' }, windows)
  if (by.getTime() <= now.getTime()) return { text: `Pumped more than ${windows.roomHours} hours ago: too long out for room temperature. Choose Fridge.`, late: true }
  const remind = new Date(by.getTime() - HOUR)
  const when = (d: Date) => format(d, 'h:mm a')
  return { text: `Fridge it or feed it by ${when(by)}. ${remind.getTime() > now.getTime() ? `Bramble reminds you at ${when(remind)}.` : 'Less than an hour left.'}`, late: false }
}

/** The storage window that applies, in words: "4-day fridge window", "24 hours in the fridge after thawing". */
export function windowLabel(location: MilkLocation, thawed: boolean, windows: MilkWindows): string {
  if (thawed) return location === 'room' ? `${THAWED_HOURS.room} hours at room temperature after thawing` : `${THAWED_HOURS.fridge} hours in the fridge after thawing`
  if (location === 'room') return `${windows.roomHours}-hour room temperature window`
  if (location === 'fridge') return `${windows.fridgeDays}-day fridge window`
  return `${windows.freezerMonths}-month freezer window`
}

/** "5h 20m left", "1 day left", "1 day 5h left", "12 days left", "about 4 months left". Rounded up to the minute. */
export function formatTimeLeft(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / MINUTE))
  const days = Math.floor(mins / (24 * 60))
  if (days < 1) return `${formatDurationShort(mins * 60)} left`
  const hours = Math.floor((mins % (24 * 60)) / 60)
  if (days < 3) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours}h` : ''} left`
  if (days < 60) return `${days} days left`
  return `about ${Math.round(days / DAYS_PER_MONTH)} months left`
}

/** One container being added: what the owner has typed so far, plus the key that makes saving it idempotent. */
export interface IntakeDraft {
  /** Sent as `client_key`: one per container, kept across retries, new for the next container. */
  key: string
  amountText: string
  pumpedAt: Date
  location: MilkLocation
  thawed: boolean
  /** When it came out of the freezer. Never defaulted: the thaw clock has to be a real time. */
  thawedAt: Date | null
}

/** A random token for `client_key`. `getRandomValues` (not `randomUUID`) so it also works on plain-http LAN addresses. */
export function newClientKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A blank draft for the next container. After a save, `previous` carries over when it was pumped and where
 * it is kept (a pile of bottles usually shares both); the volume is always typed again and the key is new.
 */
export function nextIntakeDraft(now: Date, previous?: IntakeDraft | null): IntakeDraft {
  const minute = new Date(Math.floor(now.getTime() / MINUTE) * MINUTE)
  return {
    key: newClientKey(),
    amountText: '',
    pumpedAt: previous?.pumpedAt ?? minute,
    location: previous?.location ?? 'fridge',
    thawed: previous?.thawed ?? false,
    thawedAt: previous?.thawedAt ?? null,
  }
}

/** When the container being typed would expire; null while a thawed container still has no thaw time. */
export function intakeExpiry(draft: IntakeDraft, windows: MilkWindows): Date | null {
  if (draft.thawed && !draft.thawedAt) return null
  return expectedExpiry({ pumpedAt: draft.pumpedAt, location: draft.location, thawedAt: draft.thawed ? draft.thawedAt : null }, windows)
}

/** What still stops this container from being saved, in words for the owner; null when it can be saved. */
export function intakeProblem(draft: IntakeDraft, now: Date = new Date()): string | null {
  if (!(Number(draft.amountText) > 0)) return 'Enter how much is in this container.'
  // A minute of slack: "now" on the form is a minute old by the time Save is tapped.
  if (draft.pumpedAt.getTime() > now.getTime() + MINUTE) return 'The pumped time is in the future. Set it to when the milk was pumped.'
  if (!draft.thawed) return null
  if (draft.location === 'freezer') return 'Thawed milk cannot go back in the freezer. Choose Fridge or Room temp.'
  if (!draft.thawedAt) return 'Choose when it was thawed. Thawed milk is counted from that moment.'
  if (draft.thawedAt.getTime() < draft.pumpedAt.getTime()) return 'The thaw time is before the milk was pumped.'
  if (draft.thawedAt.getTime() > now.getTime() + MINUTE) return 'The thaw time is in the future.'
  return null
}
