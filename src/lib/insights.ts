import type { EventSets } from './events'
import { parseDate, parseDuration } from './time'
import { ageWakeWindow } from './nap-window'
import { DEVELOPMENT, EXPECTING, MINIPLANS, type Insight, type Miniplan } from './insights-content'

export { MINIPLANS, type Insight, type InsightCategory, type Miniplan } from './insights-content'

const DAY_MS = 86_400_000
const MAX_INSIGHTS = 8
const MIN_INSIGHTS = 4

/** Age-appropriate night sleep norms (hours), lower bound of typical range. */
function nightSleepNorm(ageMonths: number): number {
  if (ageMonths < 3) return 8
  if (ageMonths < 12) return 9.5
  return 10
}

function dayKey(d: Date): string {
  return d.toDateString()
}

interface Ctx {
  ageMonths: number
  events: EventSets
  now: Date
  childName: string
}

function patternInsights({ ageMonths, events, now, childName }: Ctx): Insight[] {
  const out: Insight[] = []
  const weekAgo = now.getTime() - 7 * DAY_MS
  const recent = events.sleep.filter((s) => s.end && parseDate(s.end).getTime() >= weekAgo)
  const naps = recent.filter((s) => s.nap)
  const nights = recent.filter((s) => !s.nap)

  // First nap of the day per day.
  const firstNapByDay = new Map<string, Date>()
  for (const n of naps) {
    const st = parseDate(n.start)
    if (st.getHours() < 12) {
      const key = dayKey(st)
      const cur = firstNapByDay.get(key)
      if (!cur || st < cur) firstNapByDay.set(key, st)
    }
  }
  const earlyFirstNaps = [...firstNapByDay.values()].filter((d) => d.getHours() * 60 + d.getMinutes() < 8 * 60 + 30).length
  if (ageMonths >= 4 && earlyFirstNaps >= 4) {
    out.push({
      id: 'pattern-early-first-nap',
      category: 'sleep',
      badge: 'pattern',
      title: 'First nap is landing early',
      body: `${childName}'s first nap started before 8:30 AM on ${earlyFirstNaps} of the last 7 days. When the first nap of the day is too early, it can act as an extension of the night and reinforce waking before 6 AM.`,
      steps: ['Push the first nap 15 minutes later every 2–3 days', 'Keep the room dark until your chosen wake time', 'Get bright light and a feed right at wake-up'],
    })
  }

  // Bedtime per evening and last nap end.
  const bedtimes = new Map<string, Date>()
  for (const n of nights) {
    const st = parseDate(n.start)
    const h = st.getHours()
    if (h >= 17 || h < 5) {
      // A bedtime after midnight belongs to the previous evening.
      const anchor = h < 5 ? new Date(st.getFullYear(), st.getMonth(), st.getDate() - 1, 12) : st
      const key = dayKey(anchor)
      const cur = bedtimes.get(key)
      if (!cur || st < cur) bedtimes.set(key, st)
    }
  }
  const lastNapEnd = new Map<string, Date>()
  for (const n of naps) {
    const en = parseDate(n.end)
    const key = dayKey(en)
    const cur = lastNapEnd.get(key)
    if (!cur || en > cur) lastNapEnd.set(key, en)
  }
  let tightGaps = 0
  for (const [key, bed] of bedtimes) {
    const lastNap = lastNapEnd.get(key)
    if (lastNap && bed.getTime() - lastNap.getTime() < 2 * 3600_000 && bed > lastNap) tightGaps++
  }
  if (ageMonths >= 6 && tightGaps >= 3) {
    out.push({
      id: 'pattern-late-last-nap',
      category: 'sleep',
      badge: 'pattern',
      title: 'Last nap is running close to bedtime',
      body: `On ${tightGaps} recent days the last nap ended less than 2 hours before bedtime. A short final wake window usually means a long time to fall asleep at night.`,
      steps: ['Cap the last nap so it ends 2.5–3 hours before bedtime', 'If the nap runs late, push bedtime 20–30 minutes'],
    })
  }

  // Bedtime drift: compare first half vs second half of the week. A bedtime after midnight is late in the
  // evening it belongs to (00:30 is 24:30), never the earliest one.
  const bedList = [...bedtimes.entries()]
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([, d]) => d.getHours() * 60 + d.getMinutes() + (d.getHours() < 5 ? 24 * 60 : 0))
  if (bedList.length >= 5) {
    const half = Math.floor(bedList.length / 2)
    const early = bedList.slice(0, half).reduce((a, b) => a + b, 0) / half
    const late = bedList.slice(-half).reduce((a, b) => a + b, 0) / half
    if (late - early >= 30) {
      out.push({
        id: 'pattern-bedtime-drift',
        category: 'sleep',
        badge: 'pattern',
        title: 'Bedtime is drifting later',
        body: `Bedtime moved about ${Math.round(late - early)} minutes later across the week. Drift usually creeps in from long afternoon naps or a routine that starts late.`,
        steps: ['Pick a target bedtime and start the routine 30 minutes before', 'Wake from the last nap by a set time'],
      })
    }
  }

  // Nap totals dropping: this 3 days vs previous 3 days.
  // Today is not over: one short morning nap is not a day of naps.
  const napMinutesByDay = new Map<string, number>()
  const todayKey = dayKey(now)
  for (const n of naps) {
    const key = dayKey(parseDate(n.start))
    if (key === todayKey) continue
    napMinutesByDay.set(key, (napMinutesByDay.get(key) ?? 0) + parseDuration(n.duration) / 60)
  }
  const days = [...napMinutesByDay.entries()].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()).map(([, m]) => m)
  if (days.length >= 6) {
    const prev = days.slice(-6, -3).reduce((a, b) => a + b, 0) / 3
    const cur = days.slice(-3).reduce((a, b) => a + b, 0) / 3
    if (prev > 0 && cur < prev * 0.7) {
      out.push({
        id: 'pattern-nap-drop',
        category: 'sleep',
        badge: 'pattern',
        title: 'Daytime sleep dropped this week',
        body: `Nap totals fell from about ${Math.round(prev)} to ${Math.round(cur)} minutes a day. That can mean a nap transition is starting, or a stretch of overtiredness.`,
        steps: ['Move bedtime 30 minutes earlier while naps are short', 'See the "Dropping a nap" guide if it lasts more than a week'],
      })
    }
  }

  // Night sleep average vs norm.
  const nightByDay = new Map<string, number>()
  for (const n of nights) {
    const key = dayKey(parseDate(n.end))
    nightByDay.set(key, (nightByDay.get(key) ?? 0) + parseDuration(n.duration) / 3600)
  }
  const nightVals = [...nightByDay.values()]
  if (nightVals.length >= 3) {
    const avgNight = nightVals.reduce((a, b) => a + b, 0) / nightVals.length
    const norm = nightSleepNorm(ageMonths)
    if (avgNight < norm) {
      out.push({
        id: 'pattern-short-nights',
        category: 'sleep',
        badge: 'pattern',
        title: 'Nights are shorter than typical',
        body: `${childName} averaged ${avgNight.toFixed(1)} hours of night sleep over the last week; most children this age get ${norm}+ hours. Often the fix is an earlier bedtime, not a later one.`,
        steps: ['Try bedtime 20–30 minutes earlier for 5 nights', 'Keep the room dark until morning'],
      })
    }
  }

  // Diaper count today (infants).
  if (ageMonths >= 0 && ageMonths < 12 && now.getHours() >= 17) {
    const todayWet = events.changes.filter((c) => c.wet && dayKey(parseDate(c.time)) === dayKey(now)).length
    const anyToday = events.changes.some((c) => dayKey(parseDate(c.time)) === dayKey(now))
    if (anyToday && todayWet < 4) {
      out.push({
        id: 'pattern-few-wet-diapers',
        category: 'diaper',
        badge: 'pattern',
        title: 'Fewer wet diapers than usual today',
        body: `Only ${todayWet} wet diaper${todayWet === 1 ? '' : 's'} logged so far today. Babies typically have 6+ wet diapers a day once feeding is established; fewer can be a sign of not enough intake.`,
        steps: ['Offer an extra feed this evening', 'Watch for dark urine, dry mouth, or unusual sleepiness and call your provider if you see them'],
      })
    }
  }

  // Feeding gaps > 4h in the daytime for under 6 months.
  if (ageMonths < 6 && ageMonths >= 0) {
    const feeds = events.feedings
      .filter((f) => parseDate(f.start).getTime() >= now.getTime() - 2 * DAY_MS && f.type !== 'solid food')
      .map((f) => parseDate(f.start))
      .sort((a, b) => a.getTime() - b.getTime())
    let longGaps = 0
    for (let i = 1; i < feeds.length; i++) {
      const gapH = (feeds[i].getTime() - feeds[i - 1].getTime()) / 3600_000
      if (gapH > 4 && feeds[i - 1].getHours() >= 7 && feeds[i - 1].getHours() < 19) longGaps++
    }
    if (longGaps >= 2) {
      out.push({
        id: 'pattern-feeding-gaps',
        category: 'feeding',
        badge: 'pattern',
        title: 'Some long daytime gaps between feeds',
        body: `There were ${longGaps} daytime gaps over 4 hours in the last two days. Under 6 months, feeding every 2–3 hours during the day tends to support longer stretches at night.`,
        steps: ['Offer a feed at least every 3 hours while awake', 'Try a "dream feed" before your own bedtime'],
      })
    }
  }

  return out
}

function developmentInsights(ageMonths: number): Insight[] {
  return DEVELOPMENT.filter((d) => ageMonths >= d.min && ageMonths < d.max).map((d, i) => ({ id: `dev-${Math.round(d.min * 10)}-${i}`, ...d.insight }))
}

function generalTips(ageMonths: number, childName: string): Insight[] {
  const ww = ageWakeWindow(ageMonths)
  const tips: Insight[] = [
    {
      id: 'tip-wake-windows',
      category: 'sleep',
      badge: 'tip',
      title: `${childName}'s wake windows right now`,
      body: `At this age most babies do best awake ${Math.round(ww.minMinutes / 60 * 10) / 10}–${Math.round(ww.maxMinutes / 60 * 10) / 10} hours between sleeps, with about ${ww.napsPerDay} nap${ww.napsPerDay === 1 ? '' : 's'} a day. The nap prediction learns ${childName}'s actual windows as you log.`,
    },
  ]
  if (ageMonths < 4) tips.push({ id: 'tip-day-night', category: 'sleep', badge: 'tip', title: 'Teach day from night', body: 'Bright light and chatter during daytime feeds, dim and quiet at night. Newborns have no body clock yet; you are building it.' })
  if (ageMonths >= 4 && ageMonths < 12) tips.push({ id: 'tip-routine', category: 'sleep', badge: 'tip', title: 'A 20-minute routine beats a 60-minute one', body: 'Short, identical steps every night become the cue. Bath, sleep sack, feed, book, song, down. Same order, same words.' })
  if (ageMonths >= 6 && ageMonths < 12) tips.push({ id: 'tip-solids-iron', category: 'feeding', badge: 'tip', title: 'Iron matters most in first foods', body: 'Iron stores from birth run low around 6 months. Fortified cereals, pureed meats, beans, and lentils are the highest-value first foods.' })
  if (ageMonths >= 12) tips.push({ id: 'tip-toddler-choices', category: 'development', badge: 'tip', title: 'Offer two choices', body: '"Blue cup or green cup?" gives a toddler control without a negotiation. Works at bedtime, meals, and getting dressed.' })
  tips.push({ id: 'tip-tummy-time', category: 'activity', badge: 'tip', title: ageMonths < 6 ? 'Tummy time adds up' : 'Floor time beats containers', body: ageMonths < 6 ? 'Aim for a total of 15–30 minutes a day spread across short sessions. Log them under Tummy time to see the total.' : 'Open floor play builds the core strength for sitting, crawling, and walking. Limit time in bouncers and seats to short stretches.' })
  return tips
}

export function generateInsights(input: { ageMonths: number; events: EventSets; now: Date; expecting: boolean; childName: string; /** In the NICU or before the due date: no comparisons of what was logged. */ held?: boolean }): Insight[] {
  const { ageMonths, events, now, expecting, childName, held = false } = input
  if (expecting || ageMonths < 0) {
    return EXPECTING.map((e, i) => ({ id: `expecting-${i}`, ...e })).slice(0, MAX_INSIGHTS)
  }
  const patterns = held ? [] : patternInsights({ ageMonths, events, now, childName })
  const dev = developmentInsights(ageMonths)
  const tips = generalTips(ageMonths, childName)
  const combined = [...patterns, ...dev, ...tips]
  const seen = new Set<string>()
  const unique = combined.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
  return unique.slice(0, Math.max(MIN_INSIGHTS, Math.min(MAX_INSIGHTS, unique.length)))
}

export function miniplansFor(ageMonths: number): Miniplan[] {
  const age = Math.max(0, ageMonths)
  return MINIPLANS.filter((m) => age >= m.ageMinMonths && age <= m.ageMaxMonths)
}
