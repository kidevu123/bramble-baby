/**
 * The developmental milestone checklists of CDC's "Learn the Signs. Act Early." program, as revised with the
 * American Academy of Pediatrics in 2022 (Zubler et al., Pediatrics 2022;149(3):e2021052138): for each
 * well-child age, what most children (75 % or more) do by then.
 *
 * The items are CDC's own, copied from its checklist document (cdc.gov/act-early, "Your baby at 2 months" …
 * "Your child at 5 years", read 2026-11-10) and reworded only to drop "he/she" (CDC alternates them). Never add,
 * move or re-age an item from memory or from another site: change this file only against CDC's lists.
 * `text` is the milestone (and the title a logged one carries), `eg` the example CDC gives with it.
 *
 * The lists are for noticing and for the conversation with the doctor ("developmental surveillance"); they are
 * not a screening test and never a diagnosis. CDC's advice for a missed item is to tell the doctor, not to wait.
 */
import { addMonths, differenceInCalendarDays, format } from 'date-fns'
import type { Milestone, MilestoneCategory } from './api/companion'
import { asBasis, inNicuOn, normsFrom, type AgeFrom } from './preterm'
import { parseDate } from './time'

export type MilestoneDomain = 'social' | 'language' | 'cognitive' | 'motor'

export const DOMAINS: { key: MilestoneDomain; label: string }[] = [
  { key: 'social', label: 'Social' },
  { key: 'language', label: 'Language' },
  { key: 'cognitive', label: 'Thinking' },
  { key: 'motor', label: 'Movement' },
]

export interface ChecklistItem {
  domain: MilestoneDomain
  text: string
  eg?: string
  /** Titles the log sheet offered before 1.56 (and everyday names) that mean this item, so older entries count. */
  aliases?: string[]
}

/** The screening the American Academy of Pediatrics asks for at this visit, as CDC's checklist says it. */
export type Screening = 'general' | 'general-autism' | 'autism'

export interface Checkpoint {
  /** The age the list is for, in months. */
  months: number
  /** "2 months", "1 year". */
  label: string
  /** "2-month". */
  adjective: string
  screening?: Screening
  items: ChecklistItem[]
}

type Row = [string, string?, string[]?]
const list = (social: Row[], language: Row[], cognitive: Row[], motor: Row[]): ChecklistItem[] =>
  ([['social', social], ['language', language], ['cognitive', cognitive], ['motor', motor]] as [MilestoneDomain, Row[]][]).flatMap(([domain, rows]) =>
    rows.map(([text, eg, aliases]) => ({ domain, text, ...(eg ? { eg } : {}), ...(aliases ? { aliases } : {}) })),
  )

export const CHECKPOINTS: Checkpoint[] = [
  {
    months: 2,
    label: '2 months',
    adjective: '2-month',
    items: list(
      [['Calms down when spoken to or picked up', undefined, ['Calms when spoken to']], ['Looks at your face', undefined, ['Follows faces']], ['Seems happy to see you when you walk up'], ['Smiles when you talk or smile', undefined, ['First smile']]],
      [['Makes sounds other than crying'], ['Reacts to loud sounds']],
      [['Watches you as you move'], ['Looks at a toy for several seconds']],
      [['Holds head up when on tummy', undefined, ['Lifts head briefly']], ['Moves both arms and both legs'], ['Opens hands briefly']],
    ),
  },
  {
    months: 4,
    label: '4 months',
    adjective: '4-month',
    items: list(
      [['Smiles on their own to get your attention'], ['Chuckles when you try to make them laugh', 'not yet a full laugh'], ['Looks at you, moves, or makes sounds to get or keep your attention']],
      [['Makes cooing sounds', '"oooo", "aahh"', ['Coos']], ['Makes sounds back when you talk'], ['Turns head towards the sound of your voice']],
      [['If hungry, opens mouth at the breast or bottle'], ['Looks at their hands with interest']],
      [
        ['Holds head steady without support when held', undefined, ['Holds head steady']],
        ['Holds a toy when you put it in their hand'],
        ['Uses an arm to swing at toys', undefined, ['Reaches for toys']],
        ['Brings hands to mouth'],
        ['Pushes up onto elbows or forearms when on tummy', undefined, ['Pushes up on arms']],
      ],
    ),
  },
  {
    months: 6,
    label: '6 months',
    adjective: '6-month',
    items: list(
      [['Knows familiar people'], ['Likes to look at self in a mirror'], ['Laughs']],
      [['Takes turns making sounds with you'], ['Blows raspberries', 'sticks tongue out and blows'], ['Makes squealing noises']],
      [['Puts things in their mouth to explore them'], ['Reaches to grab a toy they want'], ['Closes lips to show they don’t want more food']],
      [['Rolls from tummy to back', undefined, ['Rolls tummy to back']], ['Pushes up with straight arms when on tummy'], ['Leans on hands for support when sitting', undefined, ['Sits with support']]],
    ),
  },
  {
    months: 9,
    label: '9 months',
    adjective: '9-month',
    screening: 'general',
    items: list(
      [
        ['Is shy, clingy, or fearful around strangers'],
        ['Shows several facial expressions', 'happy, sad, angry, surprised'],
        ['Looks when you call their name', undefined, ['Recognizes name']],
        ['Reacts when you leave', 'looks, reaches for you, or cries'],
        ['Smiles or laughs when you play peek-a-boo', undefined, ['Plays peekaboo']],
      ],
      [['Makes a lot of different sounds', '"mamamama", "babababa"', ['Babbles']], ['Lifts arms up to be picked up']],
      [['Looks for objects when dropped out of sight', 'a spoon or a toy'], ['Bangs two things together']],
      [['Gets to a sitting position alone'], ['Moves things from one hand to the other'], ['Uses fingers to "rake" food closer'], ['Sits without support']],
    ),
  },
  {
    months: 12,
    label: '1 year',
    adjective: '12-month',
    items: list(
      [['Plays games with you', 'like pat-a-cake']],
      [['Waves "bye-bye"', undefined, ['Waves bye']], ['Calls a parent "mama" or "dada" or another special name', undefined, ['Says "mama/dada"']], ['Understands "no"', 'pauses briefly or stops when you say it']],
      [['Puts something in a container', 'like a block in a cup'], ['Looks for things they see you hide', 'like a toy under a blanket']],
      [
        ['Pulls up to stand', undefined, ['Pulls to stand']],
        ['Walks, holding on to furniture', undefined, ['Cruises furniture']],
        ['Drinks from a cup without a lid, as you hold it', undefined, ['Drinks from cup']],
        ['Picks things up between thumb and pointer finger', 'like small bits of food', ['Pincer grasp']],
      ],
    ),
  },
  {
    months: 15,
    label: '15 months',
    adjective: '15-month',
    items: list(
      [
        ['Copies other children while playing', 'like taking toys out of a container when another child does'],
        ['Shows you an object they like'],
        ['Claps when excited'],
        ['Hugs a stuffed doll or other toy'],
        ['Shows you affection', 'hugs, cuddles, or kisses you'],
      ],
      [
        ['Tries to say one or two words besides "mama" or "dada"', 'like "ba" for ball or "da" for dog', ['First word']],
        ['Looks at a familiar object when you name it'],
        ['Follows directions given with both a gesture and words', 'gives you a toy when you hold out your hand and say "Give me the toy"'],
        ['Points to ask for something or to get help', undefined, ['Points to ask']],
      ],
      [['Tries to use things the right way', 'like a phone, cup, or book'], ['Stacks at least two small objects', 'like blocks', ['Stacks blocks']]],
      [['Takes a few steps on their own', undefined, ['First steps']], ['Uses fingers to feed themselves some food']],
    ),
  },
  {
    months: 18,
    label: '18 months',
    adjective: '18-month',
    screening: 'general-autism',
    items: list(
      [
        ['Moves away from you, but looks to make sure you are close by'],
        ['Points to show you something interesting'],
        ['Puts hands out for you to wash them'],
        ['Looks at a few pages in a book with you'],
        ['Helps you dress them', 'pushing an arm through a sleeve or lifting up a foot'],
      ],
      [['Tries to say three or more words besides "mama" or "dada"'], ['Follows one-step directions without any gestures', 'gives you the toy when you say "Give it to me"']],
      [['Copies you doing chores', 'like sweeping with a broom'], ['Plays with toys in a simple way', 'like pushing a toy car']],
      [
        ['Walks without holding on to anyone or anything', undefined, ['Walks alone']],
        ['Scribbles'],
        ['Drinks from a cup without a lid and may spill sometimes'],
        ['Feeds themselves with their fingers'],
        ['Tries to use a spoon'],
        ['Climbs on and off a couch or chair without help'],
      ],
    ),
  },
  {
    months: 24,
    label: '2 years',
    adjective: '2-year',
    screening: 'autism',
    items: list(
      [['Notices when others are hurt or upset', 'pausing or looking sad when someone is crying'], ['Looks at your face to see how to react in a new situation']],
      [
        ['Points to things in a book when you ask', 'like "Where is the bear?"'],
        ['Says at least two words together', 'like "More milk"', ['Two-word phrases']],
        ['Points to at least two body parts when you ask'],
        ['Uses more gestures than just waving and pointing', 'like blowing a kiss or nodding yes'],
      ],
      [
        ['Holds something in one hand while using the other hand', 'holding a container and taking the lid off'],
        ['Tries to use switches, knobs, or buttons on a toy'],
        ['Plays with more than one toy at the same time', 'like putting toy food on a toy plate'],
      ],
      [['Kicks a ball'], ['Runs'], ['Walks (not climbs) up a few stairs with or without help'], ['Eats with a spoon', undefined, ['Uses spoon']]],
    ),
  },
  {
    months: 30,
    label: '30 months',
    adjective: '30-month',
    screening: 'general',
    items: list(
      [
        ['Plays next to other children and sometimes plays with them'],
        ['Shows you what they can do by saying "Look at me!"'],
        ['Follows simple routines when told', 'helping to pick up toys when you say "It’s clean-up time"'],
      ],
      [['Says about 50 words'], ['Says two or more words together, with one action word', 'like "Doggie run"'], ['Names things in a book when you point and ask "What is this?"'], ['Says words like "I," "me," or "we"']],
      [
        ['Uses things to pretend', 'like feeding a block to a doll as if it were food', ['Pretend play']],
        ['Shows simple problem-solving skills', 'like standing on a small stool to reach something'],
        ['Follows two-step instructions', 'like "Put the toy down and close the door"', ['Follows two-step directions']],
        ['Shows they know at least one color', 'pointing to a red crayon when you ask "Which one is red?"'],
      ],
      [
        ['Uses hands to twist things', 'like turning doorknobs or unscrewing lids'],
        ['Takes some clothes off alone', 'like loose pants or an open jacket'],
        ['Jumps off the ground with both feet'],
        ['Turns book pages, one at a time, when you read together'],
      ],
    ),
  },
  {
    months: 36,
    label: '3 years',
    adjective: '3-year',
    items: list(
      [['Calms down within 10 minutes after you leave', 'like at a childcare drop off'], ['Notices other children and joins them to play']],
      [
        ['Talks with you in conversation using at least two back-and-forth exchanges'],
        ['Asks "who," "what," "where," or "why" questions', 'like "Where is mommy/daddy?"'],
        ['Says what action is happening in a picture or book when asked', 'like "running," "eating," or "playing"'],
        ['Says first name, when asked'],
        ['Talks well enough for others to understand, most of the time'],
      ],
      [['Draws a circle, when you show them how', undefined, ['Draws a circle']], ['Avoids touching hot objects when you warn them', 'like a stove']],
      [['Strings items together', 'like large beads or macaroni'], ['Puts on some clothes alone', 'like loose pants or a jacket'], ['Uses a fork']],
    ),
  },
  {
    months: 48,
    label: '4 years',
    adjective: '4-year',
    items: list(
      [
        ['Pretends to be something else during play', 'teacher, superhero, dog'],
        ['Asks to go play with children if none are around', 'like "Can I play with Alex?"'],
        ['Comforts others who are hurt or sad', 'like hugging a crying friend'],
        ['Avoids danger', 'like not jumping from tall heights at the playground'],
        ['Likes to be a "helper"'],
        ['Changes behavior based on where they are', 'place of worship, library, playground'],
      ],
      [
        ['Says sentences with four or more words', undefined, ['Full sentences']],
        ['Says some words from a song, story, or nursery rhyme'],
        ['Talks about at least one thing that happened during the day', 'like "I played soccer"'],
        ['Answers simple questions', 'like "What is a coat for?" or "What is a crayon for?"'],
      ],
      [['Names a few colors of items', undefined, ['Knows colors']], ['Tells what comes next in a well-known story'], ['Draws a person with three or more body parts']],
      [['Catches a large ball most of the time'], ['Serves themselves food or pours water, with adult supervision'], ['Unbuttons some buttons'], ['Holds crayon or pencil between fingers and thumb', 'not a fist']],
    ),
  },
  {
    months: 60,
    label: '5 years',
    adjective: '5-year',
    items: list(
      [['Follows rules or takes turns when playing games with other children'], ['Sings, dances, or acts for you'], ['Does simple chores at home', 'like matching socks or clearing the table after eating']],
      [
        ['Tells a story they heard or made up with at least two events', 'a cat was stuck in a tree and a firefighter saved it'],
        ['Answers simple questions about a book or story after you read or tell it'],
        ['Keeps a conversation going with more than three back-and-forth exchanges'],
        ['Uses or recognizes simple rhymes', 'bat-cat, ball-tall'],
      ],
      [
        ['Counts to 10'],
        ['Names some numbers between 1 and 5 when you point to them'],
        ['Uses words about time', 'like "yesterday," "tomorrow," "morning," or "night"'],
        ['Pays attention for 5 to 10 minutes during activities', 'story time or arts and crafts; screen time does not count'],
        ['Writes some letters in their name'],
        ['Names some letters when you point to them'],
      ],
      [['Buttons some buttons'], ['Hops on one foot']],
    ),
  },
]

/**
 * Firsts a family likes to keep that are on no CDC list. Each is offered only from the age (in months, corrected
 * for a baby born early) at which the AAP or CDC says it starts to happen, so a two-month-old's sheet never
 * suggests crawling: teething typically starts between 4 and 7 months (AAP), solid foods at about 6 months and
 * not before 4 (CDC), crawling is usually mastered between 7 and 10 months (AAP), and most children cannot toilet
 * train until 2 to 3 years (CDC, raised from the 18-month list on). Anything can still be typed by hand.
 */
export const KEEPSAKES: { text: string; category: MilestoneCategory; from: number }[] = [
  { text: 'First tooth', category: 'other', from: 4 },
  { text: 'First solids', category: 'feeding', from: 4 },
  { text: 'Crawls', category: 'motor', from: 6 },
  { text: 'Potty trained', category: 'other', from: 18 },
]

/** Titles compared without case, quotes or punctuation, so "Waves bye-bye" matches 'Waves "bye-bye"'. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‘’“”"'.,!?()]/g, '')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Logged milestones by title key; the earliest entry wins when a title was logged twice. */
export function loggedByTitle(logged: Milestone[]): Map<string, Milestone> {
  const map = new Map<string, Milestone>()
  for (const m of [...logged].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = titleKey(m.title)
    if (key && !map.has(key)) map.set(key, m)
  }
  return map
}

/** The entry that marks this item as seen (its own title, or one of the names it used to be offered under). */
export function seenEntry(item: ChecklistItem, byTitle: Map<string, Milestone>): Milestone | null {
  for (const name of [item.text, ...(item.aliases ?? [])]) {
    const hit = byTitle.get(titleKey(name))
    if (hit) return hit
  }
  return null
}

export interface Progress {
  seen: number
  total: number
  missing: ChecklistItem[]
}

export function checkpointProgress(cp: Checkpoint, byTitle: Map<string, Milestone>): Progress {
  const missing = cp.items.filter((i) => !seenEntry(i, byTitle))
  return { seen: cp.items.length - missing.length, total: cp.items.length, missing }
}

export interface Checklists {
  /** The latest list whose age has been reached: what most children do by now. Null before 2 months. */
  due: Checkpoint | null
  /** The list for the next age. Null after 5 years. */
  next: Checkpoint | null
  /** Lists before `due`, newest first. */
  earlier: Checkpoint[]
}

/** The lists for a child of `months` (corrected for a baby born early: pass `judgedMonths`). */
export function checklistsFor(months: number): Checklists {
  const reached = CHECKPOINTS.filter((c) => c.months <= months)
  return {
    due: reached[reached.length - 1] ?? null,
    next: CHECKPOINTS.find((c) => c.months > months) ?? null,
    earlier: reached.slice(0, -1).reverse(),
  }
}

/** The day the child reaches a list's age, counted like every age-typical figure (from the due date when born early). */
export function checkpointDate(cp: Checkpoint, from: AgeFrom, now: Date): Date {
  return addMonths(parseDate(normsFrom(from, now)), cp.months)
}

/** "Nov 22", with the year when it is not this one. */
export function checkpointDay(cp: Checkpoint, from: AgeFrom, now: Date): string {
  const d = checkpointDate(cp, from, now)
  return format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}

/**
 * The one line under the tiles: what to do about the list whose age has been reached. Null while nothing is due,
 * and while ages are not judged (`held`: in the NICU or before the due date).
 */
export function checklistLine(cp: Checkpoint | null, progress: Progress | null, name: string, held: boolean): { text: string; tone: 'ok' | 'ask' } | null {
  if (!cp || !progress || held) return null
  if (progress.missing.length === 0) return { text: `Everything on the ${cp.adjective} list is marked.`, tone: 'ok' }
  const n = progress.missing.length
  return {
    text: `${n} on the ${cp.adjective} list ${n === 1 ? 'is' : 'are'} not marked. Mark what you have seen. If ${name} is not doing ${n === 1 ? 'it' : 'one of them'} yet, tell the doctor at the next visit; CDC’s advice is not to wait.`,
    tone: 'ask',
  }
}

/** What CDC's checklist says about screening at this visit, in the family's words. */
export function screeningLine(cp: Checkpoint): string | null {
  if (!cp.screening) return null
  const what = cp.screening === 'general' ? 'a developmental screening' : cp.screening === 'autism' ? 'an autism screening' : 'a developmental screening and an autism screening'
  return `The ${cp.adjective} visit is due for ${what}: a short questionnaire every child should get (American Academy of Pediatrics). Ask the doctor for it.`
}

/** Days in the NICU that make the stay a hearing risk factor in itself (JCIH 2019). */
export const NICU_HEARING_DAYS = 5
/** The age by which that follow-up hearing test is due. */
export const HEARING_BY_MONTHS = 9
export const HEARING_TITLE = 'Hearing follow-up done'

/**
 * A NICU stay of 5 days or more calls for a follow-up hearing test by 9 months, even after a passed newborn
 * screen (Joint Committee on Infant Hearing, 2019 position statement and its 2024 FAQ). Returns the stay's
 * length when that applies and the child is still under 3 years (the test is done in infancy; the row then goes).
 */
export function hearingFollowUp(from: AgeFrom, months: number, now: Date): { days: number; ongoing: boolean } | null {
  const basis = asBasis(from)
  if (!basis.nicu || months >= 36) return null
  const ongoing = inNicuOn(basis, now)
  const end = basis.nicu.home ? parseDate(basis.nicu.home) : now
  const days = differenceInCalendarDays(end, parseDate(basis.nicu.since))
  return days >= NICU_HEARING_DAYS ? { days, ongoing } : null
}

export interface Suggestion {
  text: string
  category: MilestoneCategory
}

/**
 * The milestone sheet's chips: what is not marked yet on the list that is due and the next one (`items`, under
 * `label`, which names CDC's list), and apart from them the keepsakes this age has reached (`firsts`).
 */
export function milestoneSuggestions(months: number, logged: Milestone[], limit = 8): { label: string; items: Suggestion[]; firsts: Suggestion[] } {
  const byTitle = loggedByTitle(logged)
  const { due, next } = checklistsFor(months)
  const lists = [due, next].filter((c): c is Checkpoint => c !== null)
  const open = lists.flatMap((c) => c.items.filter((i) => !seenEntry(i, byTitle))).map((i) => ({ text: i.text, category: i.domain as MilestoneCategory }))
  const firsts = KEEPSAKES.filter((k) => months >= k.from && !byTitle.has(titleKey(k.text))).map((k) => ({ text: k.text, category: k.category }))
  const label = due && checkpointProgress(due, byTitle).missing.length ? `On the ${due.adjective} list` : next ? `Coming up by ${next.label}` : 'Milestones'
  return { label, items: open.slice(0, limit), firsts }
}

/** The item a title stands for, with its list (for the sheet: a typed or tapped title picks its category). */
export function itemForTitle(title: string): { item: ChecklistItem; checkpoint: Checkpoint } | null {
  const key = titleKey(title)
  if (!key) return null
  for (const checkpoint of CHECKPOINTS) {
    const item = checkpoint.items.find((i) => [i.text, ...(i.aliases ?? [])].some((n) => titleKey(n) === key))
    if (item) return { item, checkpoint }
  }
  return null
}
