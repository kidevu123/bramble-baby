import { CDC_IDEAS } from './play-data'

/**
 * Play: things to do with the child at their age (the Play tab).
 *
 * From 2 months on, every idea is one of CDC's own "What you can do" tips for that age ("Learn the Signs. Act Early.",
 * public domain), in CDC's words: only the child's pronouns were made neutral. Which tips are play (something done
 * with the child, or set up for them) and which are care advice (feeding, sleep, safety, behaviour, screens) was
 * decided once, tip by tip; the care advice is left to the guide. CDC has no list before 2 months, so the first weeks
 * are a short set written from the NHS's pages for babies from birth and the AAP's page on tummy time, each idea naming
 * its pages. Nothing here is from memory, a commercial app or a "leaps" calendar, and nothing is offered before the age
 * its source gives.
 *
 * The tab describes and counts; it never scores the child or the parents.
 */

export type PlayArea = 'social' | 'language' | 'thinking' | 'movement'

/** CDC's four areas, named as the milestone checklist names them. */
export const PLAY_AREAS: { id: PlayArea; label: string; about: string }[] = [
  { id: 'social', label: 'Social', about: 'Feelings, closeness and playing with people' },
  { id: 'language', label: 'Language', about: 'Sounds, words and taking turns to talk' },
  { id: 'thinking', label: 'Thinking', about: 'Looking, exploring and working things out' },
  { id: 'movement', label: 'Movement', about: 'Muscles, balance, hands and fingers' },
]

export const areaLabel = (area: PlayArea) => PLAY_AREAS.find((a) => a.id === area)?.label ?? area

export interface PlaySource {
  label: string
  url: string
}

const CDC = 'https://www.cdc.gov/act-early/milestones'
export const PLAY_SOURCES = {
  'cdc-2mo': { label: "CDC: what you can do for your 2-month-old", url: `${CDC}/2-months.html` },
  'cdc-4mo': { label: "CDC: what you can do for your 4-month-old", url: `${CDC}/4-months.html` },
  'cdc-6mo': { label: "CDC: what you can do for your 6-month-old", url: `${CDC}/6-months.html` },
  'cdc-9mo': { label: "CDC: what you can do for your 9-month-old", url: `${CDC}/9-months.html` },
  'cdc-12mo': { label: "CDC: what you can do for your 1-year-old", url: `${CDC}/1-year.html` },
  'cdc-15mo': { label: "CDC: what you can do for your 15-month-old", url: `${CDC}/15-months.html` },
  'cdc-18mo': { label: "CDC: what you can do for your 18-month-old", url: `${CDC}/18-months.html` },
  'cdc-2y': { label: "CDC: what you can do for your 2-year-old", url: `${CDC}/2-years.html` },
  'cdc-30mo': { label: "CDC: what you can do for your 30-month-old", url: `${CDC}/30-months.html` },
  'cdc-3y': { label: "CDC: what you can do for your 3-year-old", url: `${CDC}/3-years.html` },
  'cdc-4y': { label: "CDC: what you can do for your 4-year-old", url: `${CDC}/4-years.html` },
  'cdc-5y': { label: "CDC: what you can do for your 5-year-old", url: `${CDC}/5-years.html` },
  'nhs-talk-0-6': { label: 'NHS Start for Life: first sounds, 0 to 6 months', url: 'https://www.nhs.uk/start-for-life/baby/learning-to-talk/learning-to-talk-0-to-6-months/' },
  'nhs-moves': { label: 'NHS Start for Life: baby moves (play and tummy time)', url: 'https://www.nhs.uk/start-for-life/baby/baby-moves/' },
  'aap-tummy': { label: 'AAP: Back to sleep, tummy to play', url: 'https://www.healthychildren.org/English/ages-stages/baby/sleep/Pages/back-to-sleep-tummy-to-play.aspx' },
} satisfies Record<string, PlaySource>

export type PlaySourceId = keyof typeof PLAY_SOURCES

export interface PlayIdea {
  /** Stable: what a done idea is tagged with (`idea:<id>`). Never reused for another idea. */
  id: string
  title: string
  /** What to do, in the source's words (CDC) or written from the named pages (the first weeks). */
  text: string
  /** What the source says it helps; empty when it gives no reason. */
  why: string
  area: PlayArea
  src: PlaySourceId[]
}

export interface PlayStage {
  id: string
  /** Months of age (corrected for a baby born early) the stage runs from and to; `to` null for the last. */
  from: number
  to: number | null
  /** "2 to 4 months" */
  label: string
  /** Where the ideas are from, in a few words: "CDC's tips for a 2-month-old". */
  from_list: string
  ideas: PlayIdea[]
}

const first = (id: string, title: string, area: PlayArea, text: string, why: string, ...src: PlaySourceId[]): PlayIdea => ({ id: `m0-${id}`, title, area, text, why, src })

/**
 * Birth to 2 months. CDC's lists start at 2 months, so these are written from the NHS's page for 0 to 6 months
 * ("first sounds"), its play and tummy time page (which says what newborns enjoy and that tummy time can start from
 * birth), and the AAP's tummy time page (how long, how often). Each says only what its pages say.
 */
const FIRST_WEEKS: PlayIdea[] = [
  first('feed-talk', 'Talk and sing during feeds', 'language', 'While feeding, talk or sing to your baby, letting your voice go up and down more than usual.', 'A baby loves your voice and watches your face; the sing-song helps them follow how your mouth moves, an early step towards speech.', 'nhs-talk-0-6'),
  first('change-words', 'Say what you are doing', 'language', 'At a diaper change, say what is happening in a few words, like "socks off" or "legs up", and use the same words each time.', 'Hearing the same words with the same actions is how a baby starts to learn them.', 'nhs-talk-0-6'),
  first('same-songs', 'The same songs again', 'language', 'Sing the same songs and rhymes over and over, with actions, like "Row, row, row your boat".', 'Babies need a lot of repetition to learn words, so repeating yourself is the point.', 'nhs-talk-0-6'),
  first('answer', 'Answer their noises', 'language', 'When your baby makes a sound or pulls a face at something, answer with words and a movement of your own, as if it were a chat.', 'Showing you noticed is the start of having conversations together.', 'nhs-talk-0-6'),
  first('read', 'Read to your baby', 'language', 'Read to your baby, any book, for as long as they are content.', '', 'nhs-talk-0-6'),
  first('face', 'Face to face', 'social', 'Hold your baby close enough to see your face while you talk to them.', 'Seeing your face as you talk helps a baby understand how sounds are made, so they can start making them too.', 'nhs-talk-0-6'),
  first('fingers-toes', 'Fingers and toes', 'social', 'Gently tickle their face, or count their fingers and toes out loud.', 'Newborns love it.', 'nhs-moves'),
  first('dance', 'Dance in your arms', 'social', 'Put some music on and sway or dance with your baby in your arms.', 'Most babies love the gentle rocking and being close to you; it is good for bonding.', 'nhs-moves'),
  first('copy-me', 'Can they copy you?', 'thinking', 'With your faces close, stick out your tongue or blink slowly, wait, and see if your baby copies you.', '', 'nhs-talk-0-6'),
  first('point-name', 'Point and name', 'thinking', 'Out and about, watch your baby’s face for what catches their eye, then point to it and say what it is. Their attention moves on quickly, and that is fine.', '', 'nhs-talk-0-6'),
  first('textures', 'A book to feel', 'thinking', 'Share a fabric book with different textures and talk about how each one feels.', '', 'nhs-talk-0-6'),
  first('tummy-chest', 'Tummy time on your chest', 'movement', 'Lie your baby tummy-down on your chest while you are wide awake, or on the floor for 3 to 5 minutes, 2 or 3 times a day. Only when they are awake and you are watching.', 'Tummy time strengthens the back, neck and shoulders. It can start from the first day home.', 'nhs-moves', 'aap-tummy'),
  first('tummy-help', 'If they dislike the floor', 'movement', 'A baby who fusses on the floor can do tummy time on your chest or lap, with a toy in easy reach, while you talk and sing, or propped a little on a small rolled-up towel under the arms.', 'Not liking it at first is very normal; a little every day builds it up.', 'nhs-moves', 'aap-tummy'),
]

const cdcStage = (id: string, from: number, to: number | null, label: string, who: string, src: PlaySourceId): PlayStage => ({
  id,
  from,
  to,
  label,
  from_list: `CDC’s tips for a ${who}`,
  ideas: (CDC_IDEAS[id] ?? []).map((i) => ({ ...i, src: [src] })),
})

/** The stages in order. A CDC list is used from its own age until the next list's age. */
export const PLAY_STAGES: PlayStage[] = [
  { id: 'm0', from: 0, to: 2, label: 'Birth to 2 months', from_list: 'The NHS and the AAP, for babies from birth', ideas: FIRST_WEEKS },
  cdcStage('m2', 2, 4, '2 to 4 months', '2-month-old', 'cdc-2mo'),
  cdcStage('m4', 4, 6, '4 to 6 months', '4-month-old', 'cdc-4mo'),
  cdcStage('m6', 6, 9, '6 to 9 months', '6-month-old', 'cdc-6mo'),
  cdcStage('m9', 9, 12, '9 to 12 months', '9-month-old', 'cdc-9mo'),
  cdcStage('m12', 12, 15, '12 to 15 months', '1-year-old', 'cdc-12mo'),
  cdcStage('m15', 15, 18, '15 to 18 months', '15-month-old', 'cdc-15mo'),
  cdcStage('m18', 18, 24, '18 months to 2 years', '18-month-old', 'cdc-18mo'),
  cdcStage('m24', 24, 30, '2 to 2½ years', '2-year-old', 'cdc-2y'),
  cdcStage('m30', 30, 36, '2½ to 3 years', '30-month-old', 'cdc-30mo'),
  cdcStage('m36', 36, 48, '3 to 4 years', '3-year-old', 'cdc-3y'),
  cdcStage('m48', 48, 60, '4 to 5 years', '4-year-old', 'cdc-4y'),
  cdcStage('m60', 60, null, '5 years', '5-year-old', 'cdc-5y'),
]

/** The stage for an age in months (corrected for a baby born early: pass `judgedMonths`). */
export function stageFor(months: number): PlayStage {
  const m = Math.max(0, months)
  return PLAY_STAGES.find((s) => m >= s.from && (s.to === null || m < s.to)) ?? PLAY_STAGES[PLAY_STAGES.length - 1]
}

export const nextStage = (stage: PlayStage): PlayStage | null => PLAY_STAGES[PLAY_STAGES.indexOf(stage) + 1] ?? null

const BY_ID = new Map(PLAY_STAGES.flatMap((s) => s.ideas.map((i) => [i.id, i] as const)))
export const ideaById = (id: string): PlayIdea | null => BY_ID.get(id) ?? null

// ---- done: an idea tried is an ordinary Play activity (the companion's activities), tagged with the idea

const IDEA_TAG = 'idea:'
export const ideaTag = (id: string) => `${IDEA_TAG}${id}`
export const ideaOf = (tags: readonly string[] | null | undefined): string | null => tags?.find((t) => t.startsWith(IDEA_TAG))?.slice(IDEA_TAG.length) ?? null

/** yyyy-MM-dd on the phone's clock. */
export function dayKey(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
}

/** Days since a fixed day, on the phone's calendar: what the daily rotation counts. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** A small deterministic shuffle (mulberry32), so each child sees the ideas in their own steady order. */
function shuffled<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

/**
 * Today's ideas: `count` of them, each from a different area while the stage has that many areas, changing every day
 * and coming round again only after every idea in an area has had its day. `turn` moves on to the next set the same
 * day ("Three others"). The same child, day and turn always give the same ideas, on every phone.
 */
export function todaysIdeas(stage: PlayStage, day: string, seed: number, count = 3, turn = 0): PlayIdea[] {
  const n = dayNumber(day) + turn
  const areas = PLAY_AREAS.map((a) => a.id).filter((a) => stage.ideas.some((i) => i.area === a))
  if (areas.length === 0) return []
  const picked: PlayIdea[] = []
  for (let k = 0; picked.length < Math.min(count, stage.ideas.length) && k < count * 4; k++) {
    // The areas take turns to lead; a later lap through them reaches further down each area's own order.
    const area = areas[(n + k) % areas.length]
    const own = shuffled(stage.ideas.filter((i) => i.area === area), hash(`${stage.id}|${area}`) + seed)
    const lap = Math.floor(k / areas.length)
    const idea = own[(n + lap) % own.length]
    if (!picked.includes(idea)) picked.push(idea)
  }
  return picked
}

export interface DoneEntry {
  id: number
  start: string
  tags?: string[] | null
}

/** The latest time each idea was done on a given day: idea id → the entry (to show the time, and to undo). */
export function doneOn<T extends DoneEntry>(entries: T[], day: string): Map<string, T> {
  const out = new Map<string, T>()
  for (const e of entries) {
    const id = ideaOf(e.tags)
    if (!id || dayKey(new Date(e.start)) !== day) continue
    const had = out.get(id)
    if (!had || had.start < e.start) out.set(id, e)
  }
  return out
}

/** How many ideas were done in each area over the last `days` days (today included), and in all. */
export function areaTally(entries: DoneEntry[], now: Date, days = 7): Record<PlayArea, number> & { total: number } {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime()
  const tally = { social: 0, language: 0, thinking: 0, movement: 0, total: 0 }
  for (const e of entries) {
    const idea = ideaById(ideaOf(e.tags) ?? '')
    const at = new Date(e.start).getTime()
    if (!idea || at < since || at > now.getTime() + 60_000) continue
    tally[idea.area] += 1
    tally.total += 1
  }
  return tally
}

// ---- tummy time (the AAP's page: how long, how often)

/** The tummy time card is shown until this age: by then the stage's own ideas are about sitting, reaching and moving. */
export const TUMMY_UNTIL_MONTHS = 6
/** "Work up to 15 to 30 minutes each day by 7 weeks" (AAP). */
export const TUMMY_FULL_FROM_DAYS = 49

/** What the AAP's tummy time page says for the age, in a line. `days` is the age in days (corrected for a baby born early). */
export function tummyGuide(days: number): string {
  return days < TUMMY_FULL_FROM_DAYS
    ? 'The AAP suggests 2 or 3 short spells a day of 3 to 5 minutes, building up to 15 to 30 minutes a day by about 7 weeks.'
    : 'The AAP suggests 15 to 30 minutes over the day by this age, in short spells.'
}
