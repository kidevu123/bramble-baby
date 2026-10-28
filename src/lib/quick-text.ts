/**
 * Quick text logging: one line typed on Home ("60 ml bottle 3pm", "wet diaper", "pump 90", "nap 1:30-2:15",
 * "weight 5 lb 6 oz", "temp 99.1") opens the matching log sheet with its fields filled in. It only prefills:
 * the sheet is where the entry is checked and saved, so a misread never lands in Baby Buddy by itself.
 *
 * Numbers without a unit are in the phone's units (Settings › Units); "ml"/"oz", "lb"/"kg"/"g", "in"/"cm" and
 * "f"/"c" are converted. A clock with no am/pm is read as the most recent such time that is not in the future.
 */
import { addDays, format, isValid, setHours, setMinutes, setSeconds, startOfDay } from 'date-fns'
import type { FeedingType, GrowthKind } from './api/types'
import { displayPrecision } from './storage-units'
import { convertLength, convertTemp, convertVolume, convertWeight, formatLength, formatTemp, formatVolume, formatWeight, roundTo, type UnitPrefs } from './units'

export type QuickPrefill =
  | { kind: 'bottle'; amount?: number; milk?: FeedingType; at?: Date }
  /** Two named sides ("left 10 min right 5 min") come as `side: 'both'` with each side's minutes in `left`/`right`. */
  | { kind: 'nursing'; side?: 'left' | 'right' | 'both'; minutes?: number; left?: number; right?: number; at?: Date }
  | { kind: 'diaper'; what?: 'pee' | 'poo' | 'mixed' | 'dry'; at?: Date }
  | { kind: 'pumping'; amount?: number; minutes?: number; end?: Date }
  | { kind: 'sleep'; start?: Date; end?: Date; nap?: boolean; notes?: string }
  | { kind: 'tummy'; minutes?: number; end?: Date }
  | { kind: 'growth'; growthKind: GrowthKind; value?: number; at?: Date }
  | { kind: 'temperature'; value?: number; at?: Date }
  | { kind: 'note'; text: string; at?: Date }

export interface QuickParse {
  prefill: QuickPrefill
  /** "Bottle · 60 mL · 3:00 PM": what was understood, shown under the field before it opens. */
  summary: string
}

export const QUICK_EXAMPLES = ['60 ml bottle 3pm', 'wet diaper', 'pump 90', 'nap 1:30-2:15', 'weight 5 lb 6 oz', 'temp 99.1']

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`
/** Words after a number that make it an amount or a length, never a clock ("pump 2 to 3 oz"). */
const UNIT_AFTER = String.raw`(?!\s*(?:ml|mls|milliliters?|millilitres?|oz|ounces?|lb|lbs|pounds?|kg|kgs|g|gr|grams?|cm|in|inch|inches|m|min|mins|minutes?|h|hr|hrs|hours?)\b)`
const RANGE = new RegExp(String.raw`\b${CLOCK}\s*(?:-|–|—|to|until|till)\s*${CLOCK}\b${UNIT_AFTER}`, 'i')
const CLOCK_AMPM = new RegExp(String.raw`\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])`, 'i')
const CLOCK_24 = /\b(\d{1,2}):(\d{2})\b/
const CLOCK_AT = /\bat\s+(\d{1,2})\b(?!\s*(?:ml|oz|min|m\b|h\b|lb|kg|g\b|cm|in\b|f\b|c\b))/i
const AGO = new RegExp(String.raw`(?<![\d.,])\b(?:${NUM}\s*(?:h|hr|hrs|hour|hours)\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes)\s*)?ago\b`, 'i')
const AGO_WORDS: [RegExp, number][] = [
  [/\bhalf an hour ago\b/i, 30],
  [/\ban hour ago\b/i, 60],
  [/\ba minute ago\b/i, 1],
]
const DURATION = new RegExp(String.raw`(?<![\d.,])\b(?:for\s+)?(?:(\d+)\s*(?:h|hr|hrs|hour|hours)\s*)?(\d+)\s*(?:m|min|mins|minute|minutes)\b(?!\s*ago)`, 'gi')
/** "1 h", "1.5 hours"; not "1 h 30" (minutes with no unit) but yes "1 h 90 ml" (the number after it is an amount). */
const DURATION_H = new RegExp(
  String.raw`(?<![\d.,])\b(?:for\s+)?(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)\b(?!\s*ago)(?!\s*\d+(?:[.,]\d+)?(?![\d.,])(?!\s*(?:ml|mls|milliliters?|millilitres?|oz|ounces?)\b))`,
  'i',
)
const VOLUME = new RegExp(String.raw`\b${NUM}\s*(ml|mls|milliliters?|millilitres?|oz|ounces?)\b`, 'i')
const WEIGHT_LB = new RegExp(String.raw`\b${NUM}\s*(?:lb|lbs|pounds?)(?![a-z])(?:\s*(?:and\s+)?${NUM}\s*(?:oz|ounces?)\b)?`, 'i')
const WEIGHT_OZ_ONLY = new RegExp(String.raw`\b${NUM}\s*(?:oz|ounces?)\b`, 'i')
const WEIGHT_KG = new RegExp(String.raw`\b${NUM}\s*(?:kg|kgs|kilos?|kilograms?)\b`, 'i')
const WEIGHT_G = new RegExp(String.raw`\b${NUM}\s*(?:g|gr|grams?)\b`, 'i')
const LENGTH = new RegExp(String.raw`\b${NUM}\s*(in|inch|inches|"|cm|centimeters?|centimetres?)(?![a-z])`, 'i')
const TEMP = new RegExp(String.raw`\b${NUM}\s*(?:°\s*)?([fc])?\b`, 'i')
const BARE = new RegExp(String.raw`(?<![\d:.])${NUM}(?![\d:]|\s*(?:am|pm|a\.m\.|p\.m\.))`, 'i')

/** Anything typed is a finite number below a million: a runaway "99999999999 h ago" never reaches a Date. */
const MAX_NUMBER = 1_000_000
const num = (s: string) => {
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? Math.min(n, MAX_NUMBER) : MAX_NUMBER
}
/** "ago" reaches back a week at most; a length is a day at most. */
const MAX_AGO_MIN = 7 * 24 * 60
const MAX_LENGTH_MIN = 24 * 60
const HOUR = 3_600_000

/** Every moment with this wall-clock time on `day` and the day before (no am/pm: h and h+12; "0:30" or a
 *  leading zero is a 24-hour clock and means only that hour). */
function clockCandidates(raw: string, m: number, meridiem: string | undefined, day: Date): Date[] {
  const h = Number(raw)
  if (h > 23 || m > 59) return []
  let hours: number[]
  if (meridiem) {
    const pm = meridiem.toLowerCase().startsWith('p')
    if (h > 12 || h === 0) return []
    hours = [pm ? (h % 12) + 12 : h % 12]
  } else {
    hours = h <= 12 && !raw.startsWith('0') ? [h % 12, (h % 12) + 12] : [h]
  }
  const today = startOfDay(day)
  return hours.flatMap((hh) => [setSeconds(setMinutes(setHours(today, hh), m), 0), setSeconds(setMinutes(setHours(addDays(today, -1), hh), m), 0)])
}

/** The most recent moment with this wall-clock time on `day` or the day before that is not after `notAfter`. */
function clockToday(raw: string, m: number, meridiem: string | undefined, day: Date, notAfter: Date): Date | null {
  const options = clockCandidates(raw, m, meridiem, day)
  const past = options.filter((d) => d.getTime() <= notAfter.getTime()).sort((a, b) => b.getTime() - a.getTime())
  return past[0] ?? options.sort((a, b) => a.getTime() - b.getTime())[0] ?? null
}

/** A range read as one span: the latest end that has already happened whose start comes before it by less
 *  than 16 h (24 h when both sides say am/pm, 12 h when neither does). "11pm-6" at 7 PM is last night, not
 *  11 PM–6 PM; an empty span ("1:30-1:30") is no range. */
function clockRange(range: RegExpExecArray, day: Date, now: Date): { start: Date; end: Date } | null {
  const [, h1, m1, mer1, h2, m2, mer2] = range
  const ends = clockCandidates(h2, Number(m2 ?? 0), mer2, day)
    .filter((d) => d.getTime() <= now.getTime())
    .sort((a, b) => b.getTime() - a.getTime())
  const maxSpan = (mer1 && mer2 ? 24 : mer1 || mer2 ? 16 : 12) * HOUR
  for (const end of ends) {
    const starts = [...clockCandidates(h1, Number(m1 ?? 0), mer1, end), ...clockCandidates(h1, Number(m1 ?? 0), mer1, addDays(end, 1))]
      .map((s) => ({ s, span: end.getTime() - s.getTime() }))
      .filter(({ span }) => span > 0 && span < maxSpan)
      .sort((a, b) => a.span - b.span)
    if (starts.length) return { start: starts[0].s, end }
  }
  return null
}

interface Times {
  at?: Date
  start?: Date
  end?: Date
  rest: string
}

/** Pull the time expressions out of the text. */
function takeTimes(text: string, now: Date): Times {
  let rest = text
  const yesterday = /\byesterday\b/i.test(rest)
  rest = rest.replace(/\byesterday\b/i, ' ')
  const base = yesterday ? addDays(now, -1) : now
  const out: Times = { rest }
  const range = RANGE.exec(rest)
  if (range) {
    const span = clockRange(range, base, now)
    out.rest = rest.replace(range[0], ' ')
    if (span) {
      out.start = span.start
      out.end = span.end
    }
    return out
  }
  for (const [re, minutes] of AGO_WORDS) {
    if (re.test(rest)) {
      out.at = new Date(base.getTime() - minutes * 60_000)
      out.rest = rest.replace(re, ' ')
      return out
    }
  }
  const ago = AGO.exec(rest)
  if (ago && (ago[1] || ago[2])) {
    const minutes = Math.min(Math.round((ago[1] ? num(ago[1]) : 0) * 60 + (ago[2] ? num(ago[2]) : 0)), MAX_AGO_MIN)
    out.at = new Date(base.getTime() - minutes * 60_000)
    out.rest = rest.replace(ago[0], ' ')
    return out
  }
  const ampm = CLOCK_AMPM.exec(rest)
  if (ampm) {
    const at = clockToday(ampm[1], Number(ampm[2] ?? 0), ampm[3], base, now)
    if (at) {
      out.at = at
      out.rest = rest.replace(ampm[0], ' ')
      return out
    }
  }
  const c24 = CLOCK_24.exec(rest)
  if (c24) {
    const at = clockToday(c24[1], Number(c24[2]), undefined, base, now)
    if (at) {
      out.at = at
      out.rest = rest.replace(c24[0], ' ')
      return out
    }
  }
  const atH = CLOCK_AT.exec(rest)
  if (atH) {
    const at = clockToday(atH[1], 0, undefined, base, now)
    if (at) {
      out.at = at
      out.rest = rest.replace(atH[0], ' ')
      return out
    }
  }
  if (yesterday) out.at = base
  return out
}

interface Duration {
  minutes?: number
  /** Each "N min" in the order typed, for two-sided nursing ("left 10 min right 5 min"). */
  parts: { minutes: number; index: number }[]
  rest: string
}

function takeDuration(text: string): Duration {
  const clamp = (n: number) => Math.min(Math.round(n), MAX_LENGTH_MIN)
  const all = [...text.matchAll(DURATION)]
  if (all.length) {
    const parts = all.map((m) => ({ minutes: clamp(num(m[1] ?? '0') * 60 + num(m[2])), index: m.index ?? 0 }))
    let rest = text
    for (const m of all) rest = rest.replace(m[0], ' ')
    return { minutes: clamp(parts.reduce((a, p) => a + p.minutes, 0)), parts, rest }
  }
  const h = DURATION_H.exec(text)
  if (h) return { minutes: clamp(num(h[1]) * 60), parts: [{ minutes: clamp(num(h[1]) * 60), index: h.index }], rest: text.replace(h[0], ' ') }
  return { parts: [], rest: text }
}

type Kind = QuickPrefill['kind']

/** The first kind the words name. Order matters: "pumped 90 ml" is pumping, not a bottle. */
function kindOf(text: string): Kind | null {
  const t = ` ${text.toLowerCase()} `
  const has = (re: RegExp) => re.test(t)
  if (/^note\b/i.test(text)) return 'note'
  if (has(/\bpump(ed|ing|s)?\b/)) return 'pumping'
  if (has(/\btummy\b/)) return 'tummy'
  // "diaper both" is a mixed diaper and "dirty diaper bm" a bowel movement, not a side or breast milk.
  const diaperWord = has(DIAPER_WORDS)
  if (has(/\b(nurs(e|ed|ing)|breastf(ed|eed|eeding)|boob|latch(ed)?)\b/) || (has(/\b(left|right|both)\b/) && !diaperWord && !has(/\b(bottle|formula)\b/))) return 'nursing'
  if (has(/\b(bottle|formula|fed|feed|feeding|ate|drank|ebm)\b/) || has(/\bbreast milk\b/) || (has(/\bbm\b/) && !diaperWord)) return 'bottle'
  if (diaperWord) return 'diaper'
  if (has(/\b(nap|napped|sleep|sleeping|slept|asleep|woke|bedtime|bed|night)\b/)) return 'sleep'
  if (has(/\b(weight|weigh|weighs|weighed|lb|lbs|pounds?|kg|kilos?|grams?)\b/)) return 'growth'
  if (has(/\b(height|length|long|tall)\b/)) return 'growth'
  if (has(/\bhead\b/)) return 'growth'
  if (has(/\b(temp|temperature|fever)\b/) || /°/.test(t)) return 'temperature'
  if (has(/\bnote\b/)) return 'note'
  if (VOLUME.test(text)) return 'bottle'
  if (has(/\b\d{1,2}\s*(in|inch|inches|cm)\b/)) return 'growth'
  return null
}

const DIAPER_WORDS = /\b(diaper|nappy|wet|dirty|poo|poop|pooped|pee|peed|dry)\b/
const DIRTY = /\b(dirty|poo|poop|pooped|soiled|stool|bm)\b/i
const WET = /\b(wet|pee|peed)\b/i

function diaperWhat(text: string): 'pee' | 'poo' | 'mixed' | 'dry' | undefined {
  if (/\b(both|mixed)\b/i.test(text) || (DIRTY.test(text) && WET.test(text))) return 'mixed'
  if (DIRTY.test(text)) return 'poo'
  if (WET.test(text)) return 'pee'
  if (/\bdry\b/i.test(text)) return 'dry'
  return undefined
}

const clockText = (d: Date, now: Date) =>
  isValid(d) ? `${format(d, 'h:mm a')}${startOfDay(d).getTime() !== startOfDay(now).getTime() ? ` ${format(d, 'MMM d')}` : ''}` : ''
const whenText = (d: Date | undefined, now: Date, label = '') => (d ? `${label}${clockText(d, now)}` : 'just now')

export function parseQuickText(input: string, units: UnitPrefs, now: Date = new Date()): QuickParse | null {
  const text = input.trim().replace(/\s+/g, ' ')
  if (!text) return null
  const kind = kindOf(text)
  if (!kind) return null
  if (kind === 'note') return parseNote(text, now)
  const times = takeTimes(text, now)
  // Amounts are rounded the way the sheets show them (whole mL, hundredths of an oz).
  const volumePlaces = displayPrecision('feeding', units)
  const volume = (s: string): number | undefined => {
    const m = VOLUME.exec(s)
    if (m) return roundTo(convertVolume(num(m[1]), m[2].toLowerCase().startsWith('ml') || m[2].toLowerCase().startsWith('mil') ? 'ml' : 'oz', units.volume), volumePlaces)
    const bare = BARE.exec(s)
    if (!bare) return undefined
    // A bare number is in the phone's unit while it is plausible for it: "pump 90" on an oz phone is 90 mL.
    const n = num(bare[1])
    const given = units.volume === 'oz' && n > MAX_BARE_OZ ? 'ml' : units.volume
    return roundTo(convertVolume(n, given, units.volume), volumePlaces)
  }

  if (kind === 'bottle') {
    const rest = times.rest
    const amount = volume(rest)
    const milk: FeedingType | undefined = /\bformula\b/i.test(rest) ? 'formula' : /\bfortified\b/i.test(rest) ? 'fortified breast milk' : /\b(breast milk|ebm|bm)\b/i.test(rest) ? 'breast milk' : undefined
    const at = times.at ?? times.start
    const parts = ['Bottle', amount !== undefined ? `${formatVolume(amount, units.volume)}${milk ? ` ${milk}` : ''}` : milk, whenText(at, now)].filter(Boolean)
    return { prefill: { kind, amount, milk, at }, summary: parts.join(' · ') }
  }
  if (kind === 'nursing') {
    const dur = takeDuration(times.rest)
    const sides = nursingSides(times.rest, dur)
    const side = sides ? 'both' : /\bboth\b/i.test(dur.rest) ? 'both' : /\bleft\b/i.test(dur.rest) ? 'left' : /\bright\b/i.test(dur.rest) ? 'right' : undefined
    let minutes = dur.minutes
    if (minutes === undefined && times.start && times.end) minutes = Math.round((times.end.getTime() - times.start.getTime()) / 60_000)
    const at = times.at ?? times.start
    const sideText = sides ? `left ${sides.left} min, right ${sides.right} min` : [side, minutes !== undefined ? `${minutes} min` : undefined].filter(Boolean).join(' · ')
    const parts = ['Nursing', sideText || undefined, whenText(at, now)].filter(Boolean)
    return { prefill: sides ? { kind, side, minutes, left: sides.left, right: sides.right, at } : { kind, side, minutes, at }, summary: parts.join(' · ') }
  }
  if (kind === 'diaper') {
    const what = diaperWhat(times.rest)
    const at = times.at ?? times.start
    const words = { pee: 'wet', poo: 'dirty', mixed: 'wet and dirty', dry: 'dry' }
    return { prefill: { kind, what, at }, summary: ['Diaper', what ? words[what] : undefined, whenText(at, now)].filter(Boolean).join(' · ') }
  }
  if (kind === 'pumping') {
    const dur = takeDuration(times.rest)
    const amount = volume(dur.rest)
    let minutes = dur.minutes
    const end = times.end ?? times.at
    if (minutes === undefined && times.start && times.end) minutes = Math.round((times.end.getTime() - times.start.getTime()) / 60_000)
    const parts = ['Pumping', amount !== undefined ? formatVolume(amount, units.volume) : undefined, minutes !== undefined ? `${minutes} min` : undefined, `finished ${whenText(end, now)}`].filter(Boolean)
    return { prefill: { kind, amount, minutes, end }, summary: parts.join(' · ') }
  }
  if (kind === 'sleep') {
    const dur = takeDuration(times.rest)
    const nap = /\bnap(ped)?\b/i.test(dur.rest) ? true : /\b(night|bed|bedtime)\b/i.test(dur.rest) ? false : undefined
    let start = times.start
    let end = times.end
    if (!end && times.at) {
      // "woke 7am" names the end; "slept at 1pm" / "asleep 1pm" names the start.
      if (/\b(woke|up)\b/i.test(dur.rest) || !/\b(slept|asleep|down|went)\b/i.test(dur.rest)) end = times.at
      else start = times.at
    }
    if (dur.minutes !== undefined) {
      if (start && !end) {
        end = new Date(start.getTime() + dur.minutes * 60_000)
        // "slept 10pm for 8 h" typed at 3 AM: the start is the latest 10 PM, so the end stops at now, never
        // a moment still to come (the sheet shows 10 PM–3 AM to correct).
        if (end.getTime() > now.getTime()) end = now
      } else if (!start) {
        end = end ?? now
        start = new Date(end.getTime() - dur.minutes * 60_000)
      }
    }
    const label = nap === true ? 'Nap' : nap === false ? 'Night sleep' : 'Sleep'
    const span = start && end ? `${clockText(start, now)}–${clockText(end, now)}` : end ? `woke ${clockText(end, now)}` : start ? `from ${clockText(start, now)}` : dur.minutes !== undefined ? `${dur.minutes} min` : undefined
    return { prefill: { kind, start, end, nap }, summary: [label, span].filter(Boolean).join(' · ') }
  }
  if (kind === 'tummy') {
    const dur = takeDuration(times.rest)
    let minutes = dur.minutes
    const end = times.end ?? times.at
    if (minutes === undefined && times.start && times.end) minutes = Math.round((times.end.getTime() - times.start.getTime()) / 60_000)
    return { prefill: { kind, minutes, end }, summary: ['Tummy time', minutes !== undefined ? `${minutes} min` : undefined, `finished ${whenText(end, now)}`].filter(Boolean).join(' · ') }
  }
  if (kind === 'growth') {
    const rest = times.rest
    const growthKind: GrowthKind = /\bhead\b/i.test(rest) ? 'head' : /\b(height|length|long|tall|in|inch|inches|cm)\b/i.test(rest) && !/\b(weight|weigh|lb|lbs|kg|grams?)\b/i.test(rest) ? 'height' : 'weight'
    let value: number | undefined
    if (growthKind === 'weight') {
      const lb = WEIGHT_LB.exec(rest)
      const kg = WEIGHT_KG.exec(rest)
      const g = WEIGHT_G.exec(rest)
      const oz = WEIGHT_OZ_ONLY.exec(rest)
      if (lb) value = convertWeight(num(lb[1]) + (lb[2] ? num(lb[2]) / 16 : 0), 'lb', units.weight)
      else if (kg) value = convertWeight(num(kg[1]), 'kg', units.weight)
      else if (g) value = convertWeight(num(g[1]) / 1000, 'kg', units.weight)
      else if (oz) value = convertWeight(num(oz[1]) / 16, 'lb', units.weight)
      else {
        const bare = BARE.exec(rest)
        // A bare weight over 100 is grams ("weight 3400"): no baby weighs 100 lb or kg.
        if (bare) value = num(bare[1]) > MAX_BARE_WEIGHT ? convertWeight(num(bare[1]) / 1000, 'kg', units.weight) : num(bare[1])
      }
      if (value !== undefined) value = roundTo(value, 3)
    } else {
      const len = LENGTH.exec(rest)
      if (len) value = convertLength(num(len[1]), /^(in|")/i.test(len[2]) ? 'in' : 'cm', units.length)
      else {
        const bare = BARE.exec(rest)
        if (bare) value = num(bare[1])
      }
      if (value !== undefined) value = roundTo(value, displayPrecision('height', units))
    }
    const label = growthKind === 'weight' ? 'Weight' : growthKind === 'height' ? 'Height' : 'Head'
    const shown = value === undefined ? undefined : growthKind === 'weight' ? formatWeight(value, units.weight) : formatLength(value, units.length)
    return { prefill: { kind, growthKind, value, at: times.at }, summary: [label, shown, times.at ? clockText(times.at, now) : undefined].filter(Boolean).join(' · ') }
  }
  if (kind === 'temperature') {
    const rest = times.rest.replace(/\b(temp|temperature|fever)\b/i, ' ')
    const m = TEMP.exec(rest)
    let value: number | undefined
    if (m) {
      const raw = num(m[1])
      const given = m[2]?.toLowerCase() === 'c' ? 'c' : m[2]?.toLowerCase() === 'f' ? 'f' : raw >= 50 ? 'f' : 'c'
      value = roundTo(convertTemp(raw, given, units.temp), 1)
    }
    return { prefill: { kind, value, at: times.at }, summary: ['Temperature', value !== undefined ? formatTemp(value, units.temp) : undefined, whenText(times.at, now)].filter(Boolean).join(' · ') }
  }
  return parseNote(text, now)
}

const MAX_BARE_OZ = 16
const MAX_BARE_WEIGHT = 100

/** Two sides named with their own minutes ("left 10 min right 5 min", "5 min right, 10 min left"): the
 *  lengths go to the sides in the order both were typed. */
function nursingSides(text: string, dur: Duration): { left: number; right: number } | null {
  if (dur.parts.length !== 2) return null
  const left = /\bleft\b/i.exec(text)
  const right = /\bright\b/i.exec(text)
  if (!left || !right) return null
  const [a, b] = dur.parts
  return left.index < right.index ? { left: a.minutes, right: b.minutes } : { left: b.minutes, right: a.minutes }
}

/** A note keeps its words as typed, times included ("Spit up after the 3pm bottle"). Only a time at the very
 *  start or end of it is also read as when the note was made. */
function parseNote(text: string, now: Date): QuickParse {
  const body = text.replace(/^\s*note:?\s*/i, '').trim()
  const times = takeTimes(body, now)
  const left = times.rest.replace(/\s+/g, ' ').trim()
  const found = times.at ?? times.start
  const atEdge = found && left !== body && (left === '' || body.startsWith(left) || body.endsWith(left))
  const at = atEdge ? found : undefined
  return { prefill: { kind: 'note', text: body, at }, summary: ['Note', body || undefined, whenText(at, now)].filter(Boolean).join(' · ') }
}
