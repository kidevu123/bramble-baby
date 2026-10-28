import type { EventSets } from './events'
import { formatDurationShort, parseDate, parseDuration } from './time'
import { buildSchedule, ageStageLabel, type ScheduleItem } from './schedule'
import { ENVIRONMENT, METHODS, SAFETY, type MethodKey } from './sleepplan-content'

export { QUESTIONNAIRE, type Question } from './sleepplan-content'

export type Answers = Record<string, string | string[] | number>

export interface SleepPlan {
  title: string
  summary: string
  ageStage: string
  schedule: ScheduleItem[]
  steps: { title: string; detail: string }[]
  method: { name: string; description: string; nightWakingProtocol: string[] }
  environment: string[]
  naps: string[]
  expectations: string
  safety: string[]
}

export interface SleepStats {
  avgBedtime: string | null
  avgWake: string | null
  avgNapMinutes: number | null
  nightWakings: number | null
  nights: number
}

const DAY_MS = 86_400_000

function hhmm(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`
}

function hhmmTo12(s: string): string {
  const [h, m] = s.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

/** Real numbers from the last 7 days of logged sleep. */
export function sleepStats(events: EventSets, now: Date): SleepStats {
  const cutoff = now.getTime() - 7 * DAY_MS
  const recent = events.sleep.filter((s) => parseDate(s.end).getTime() >= cutoff && s.end)
  const nights = recent.filter((s) => !s.nap)
  const naps = recent.filter((s) => s.nap)

  // Bedtime: first night sleep starting after 17:00 each evening (a 00:30 bedtime counts for the
  // evening before, as minutes past that evening's midnight, so averages don't land at noon).
  // Wake: last night sleep end before 11:00.
  const byEvening = new Map<string, number>()
  const byMorning = new Map<string, number>()
  for (const n of nights) {
    const start = parseDate(n.start)
    const end = parseDate(n.end)
    const evening = eveningOf(start)
    if (evening) {
      byEvening.set(evening.key, Math.min(byEvening.get(evening.key) ?? Infinity, evening.mins))
    }
    if (end.getHours() < 11) {
      const key = end.toDateString()
      const mins = end.getHours() * 60 + end.getMinutes()
      byMorning.set(key, Math.max(byMorning.get(key) ?? -Infinity, mins))
    }
  }
  const bed = avg([...byEvening.values()])
  const wake = avg([...byMorning.values()])
  // Night wakings: segments of night sleep per night minus one.
  const nightCount = byEvening.size || byMorning.size
  const wakings = nightCount ? Math.max(0, nights.length - nightCount) / nightCount : null
  const napAvg = avg(naps.map((n) => parseDuration(n.duration) / 60))
  return {
    avgBedtime: bed === null ? null : hhmm(bed % 1440),
    avgWake: wake === null ? null : hhmm(wake),
    avgNapMinutes: napAvg === null ? null : Math.round(napAvg),
    nightWakings: wakings === null ? null : Math.round(wakings * 10) / 10,
    nights: nightCount,
  }
}

/** Which evening a bedtime belongs to: 17:00–23:59 today, or 00:00–04:59 counted for yesterday (+24 h). */
export function eveningOf(start: Date): { key: string; mins: number } | null {
  const h = start.getHours()
  if (h >= 17) return { key: start.toDateString(), mins: h * 60 + start.getMinutes() }
  if (h < 5) {
    const prev = new Date(start)
    prev.setDate(prev.getDate() - 1)
    return { key: prev.toDateString(), mins: 1440 + h * 60 + start.getMinutes() }
  }
  return null
}

function asList(v: string | string[] | number | undefined): string[] {
  if (Array.isArray(v)) return v
  if (v === undefined) return []
  return [String(v)]
}

function pickMethod(ageMonths: number, answers: Answers): MethodKey {
  if (ageMonths < 4) return 'soothe'
  const pref = String(answers['method'] ?? 'none')
  if (pref === 'gentle') return 'gentle'
  if (pref === 'chair') return 'chair'
  if (pref === 'check-console') return ageMonths >= 6 ? 'check-console' : 'gentle'
  return ageMonths < 6 ? 'gentle' : 'check-console'
}

function nightFeedingGuidance(ageMonths: number, answers: Answers): string {
  const feeds = asList(answers['waking-response']).includes('feed')
  if (ageMonths < 4) return 'Night feeds are expected and important right now. Keep them calm and dim, and let sleep follow.'
  if (ageMonths < 6) return 'One or two night feeds are still normal. Offer a full feed at the first waking after midnight; try settling without a feed for wakings within 2 hours of the last one.'
  if (ageMonths < 9) {
    return feeds
      ? 'Most babies this age can drop to one night feed. Keep one "protected" feed (often around 2–4 AM) and settle other wakings with your method. Shorten that feed by 1–2 minutes (or 0.5 oz) every few nights if you want to phase it out.'
      : 'Nutrition needs can be met in the day now; treat night wakings as settling moments rather than meals.'
  }
  return 'From 9 months, healthy full-term babies generally do not need night feeds. If you still offer one, move it earlier and shorten gradually over a week, adding a top-up before bed.'
}

function napGuidance(ageMonths: number, answers: Answers, stats: SleepStats): string[] {
  const out: string[] = []
  const trouble = String(answers['nap-trouble'] ?? 'fine')
  if (ageMonths < 4) {
    out.push('Naps are naturally short and irregular before 4 months. Aim for a nap after every wake window rather than a fixed clock.')
    out.push('Watch for the first yawn or glazed look and start the nap routine right away, even if the last nap was short.')
  } else {
    if (trouble === 'short' || (stats.avgNapMinutes !== null && stats.avgNapMinutes < 45)) {
      out.push(
        ageMonths >= 6
          ? 'Try the "crib hour": when a nap ends under 45 minutes, leave your child in the crib (calm, checked in on) until 60 minutes have passed. Many babies link back into a second cycle within a week.'
          : 'Short naps are common until about 5–6 months. If a nap ends early, do a quick re-settle attempt (5 minutes of your soothing step), then move on and shorten the next wake window by 15 minutes.',
      )
    }
    if (trouble === 'fights') out.push('Fighting a nap usually means the wake window is a touch too long or too short. Shift nap time by 15 minutes for 3 days and compare.')
    if (trouble === 'on-the-go') out.push('Anchor one nap a day at home in the crib (usually the first nap, the easiest). Keep other naps flexible while that one becomes reliable.')
    out.push('Use the same short pre-nap routine every time: dark room, white noise, sleep sack, one song, down awake.')
  }
  if (ageMonths >= 12) out.push('Cap total daytime sleep around 2–2.5 hours so it does not steal from nights, and hold the nap no later than 3 PM.')
  if (ageMonths >= 6 && ageMonths < 12) out.push('Protect the last wake window: end the final nap at least 2.5–3 hours before bedtime.')
  return out
}

function stepsFor(ageMonths: number, answers: Answers, method: MethodKey, stats: SleepStats): { title: string; detail: string }[] {
  const steps: { title: string; detail: string }[] = []
  const routine = String(answers['routine'] ?? 'no')
  const fallAsleep = String(answers['fall-asleep'] ?? 'independent')
  const location = String(answers['location'] ?? 'crib-own-room')

  steps.push({
    title: 'Set the stage (nights 1–2)',
    detail: routine === 'yes' ? 'Keep your routine, but trim it to 20–30 minutes and finish in the sleep room with lights low.' : 'Start a 20–30 minute routine tonight: bath or wipe-down, pajamas and sleep sack, feed, one book or song, into the crib. Same order every night.',
  })
  if (location === 'co-sleep' || location === 'varies') {
    steps.push({
      title: 'Pick one sleep space',
      detail: 'Choose one place for all night sleep for the next two weeks (a crib or bassinet is safest). Consistency of place does more than any technique.',
    })
  }
  if (ageMonths < 4) {
    steps.push({ title: 'Build day–night contrast', detail: 'Bright light, talking, and play in the day; dim, quiet, and boring at night. This is how a newborn learns which is which.' })
    steps.push({ title: 'Follow wake windows', detail: 'Offer sleep at the end of each window (see the schedule). Newborns cannot hold out for a clock, so watch cues and the window, not the time.' })
    steps.push({ title: 'Practice one crib attempt a day', detail: 'For the first nap of the day, try laying baby down drowsy after your soothing. If it does not take in 5 minutes, help them to sleep. No pressure, just practice.' })
  } else {
    steps.push({
      title: 'Break the association gently',
      detail:
        fallAsleep === 'fed'
          ? 'Move the feed to the start of the routine (before the book) so it is no longer the last step. Finish with a song, then down awake.'
          : fallAsleep === 'rocked'
            ? 'Rock until calm, not asleep. Count to 10 once they are drowsy, then lay them down. Extend the gap each night.'
            : fallAsleep === 'pacifier'
              ? ageMonths >= 7
                ? 'Scatter 2–3 pacifiers in the crib so your child can find one alone. Practice putting it in their hand at bedtime, not their mouth.'
                : 'Keep the pacifier for now; you can teach self-replacing from about 7 months.'
              : fallAsleep === 'motion'
                ? 'Start all naps at home in the crib for the next 7 days, even if they are shorter. Motion naps can return as the occasional bonus once crib naps work.'
                : 'Keep doing what works: down awake, brief goodbye, out.',
    })
    steps.push({ title: `Night 1–3: ${METHODS[method].name}`, detail: METHODS[method].description })
    steps.push({ title: 'Night 4–7: hold steady', detail: 'Expect a bumpy night 3 or 4 ("extinction burst"). Do not add new help. Most families see the big improvement by night 5–7.' })
    steps.push({ title: 'Week 2: naps', detail: 'Once nights settle, apply the same approach to the first nap of the day, then the rest.' })
  }
  if (stats.avgWake && Number(stats.avgWake.slice(0, 2)) < 6) {
    steps.push({ title: 'Early mornings', detail: 'Treat anything before 6:00 AM as night: no lights, no feed if possible, same night protocol. Make the room pitch-dark and shift bedtime 15 minutes later only if total night sleep is already 11+ hours.' })
  }
  return steps
}

export function generatePlan(input: { ageMonths: number; answers: Answers; events: EventSets; now: Date; childName: string }): SleepPlan {
  const { ageMonths, answers, events, now, childName } = input
  const stats = sleepStats(events, now)
  const method = pickMethod(ageMonths, answers)
  const medical = asList(answers['medical']).filter((m) => m !== 'none')
  const wakeTime = typeof answers['wake-time'] === 'string' && /^\d{1,2}:\d{2}$/.test(answers['wake-time']) ? answers['wake-time'] : stats.avgWake ?? '07:00'
  const schedule = buildSchedule({ ageMonths, wakeTime, includeFeeds: ageMonths < 6 })
  const goal = String(answers['goal'] ?? 'predictable')

  const facts: string[] = []
  if (stats.avgBedtime) facts.push(`bedtime has averaged ${hhmmTo12(stats.avgBedtime)}`)
  if (stats.avgWake) facts.push(`wake-ups around ${hhmmTo12(stats.avgWake)}`)
  if (stats.nightWakings !== null && stats.nights > 0) facts.push(`about ${stats.nightWakings} night waking${stats.nightWakings === 1 ? '' : 's'} logged per night`)
  if (stats.avgNapMinutes !== null) facts.push(`naps averaging ${formatDurationShort(stats.avgNapMinutes * 60)}`)

  const goalText: Record<string, string> = {
    'sleep-through': 'fewer, shorter night wakings and eventually sleeping through',
    'longer-naps': 'longer, more predictable naps',
    'fall-asleep-alone': `${childName} falling asleep independently`,
    'gentler-nights': 'calmer nights with less crying for everyone',
    predictable: 'a predictable daily rhythm',
  }

  const summary = [
    `This plan is for ${childName}, ${ageStageLabel(ageMonths).toLowerCase()}, aiming for ${goalText[goal] ?? goalText.predictable}.`,
    facts.length ? `Over the last 7 days, ${facts.join(', ')}.` : 'Log a week of sleep and this summary will fill in with real numbers.',
    ageMonths < 4
      ? 'At this age we build rhythms rather than train. Expect gradual change over weeks, not nights.'
      : `We will use ${METHODS[method].name.toLowerCase()} over about two weeks, nights first, then naps.`,
  ].join(' ')

  const expectations =
    ageMonths < 4
      ? 'Newborn sleep is meant to be irregular. A "good" week is one where naps start to follow wake windows and the longest stretch of night sleep slowly grows. Growth spurts around 3 and 6 weeks and 3 months can undo progress for a few days; that is normal.'
      : `Nights 1–3 are the hardest, night 3–4 often has a setback, and most families see steady improvement by night 5–7. Naps take another 1–2 weeks. Illness, teething, and travel cause temporary regressions; return to the plan the next calm day.${medical.length ? ` Since ${medical.join(' and ')} is in the picture right now, start when symptoms ease, and pause the plan on rough nights.` : ''}`

  return {
    title: ageMonths < 4 ? `${childName}'s rhythm plan` : `${childName}'s sleep plan`,
    summary,
    ageStage: ageStageLabel(ageMonths),
    schedule,
    steps: stepsFor(ageMonths, answers, method, stats),
    method: { ...METHODS[method], nightWakingProtocol: [...METHODS[method].nightWakingProtocol, nightFeedingGuidance(ageMonths, answers)] },
    environment: [...ENVIRONMENT],
    naps: napGuidance(ageMonths, answers, stats),
    expectations,
    safety: [...SAFETY],
  }
}
