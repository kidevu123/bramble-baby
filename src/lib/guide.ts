/**
 * What to expect, week by week for the first three months and then by month and by CDC's checklist ages.
 *
 * Every line is a fact read from a named page of the American Academy of Pediatrics' parent site
 * (healthychildren.org), the NHS or CDC (read 2026-11-10) and carries the ids of the pages it rests on (`src`); a test
 * fails on a line without one. Lines are written in ranges ("between 1 and 3 weeks", "around", "by"): babies do
 * not develop on a weekly timetable, and the week a line sits in is when its range begins or centres, not a
 * deadline. Never add a line from memory, from a parenting site without a medical publisher, or from "leaps"
 * calendars: change this file only against the pages in GUIDE_SOURCES (add the page there first).
 *
 * The guide describes; it does not judge. What a child has been seen to do is marked on CDC's checklists
 * (`milestones.ts`), which the guide page shows beside each period.
 */
import { addDays, addMonths, differenceInCalendarDays, differenceInMonths, format, startOfDay } from 'date-fns'
import { normsFrom, type AgeFrom } from './preterm'
import { parseDate } from './time'

export interface GuideSource {
  label: string
  url: string
}

const AAP = 'https://www.healthychildren.org/English'
export const GUIDE_SOURCES = {
  'cdc-milestones': { label: 'CDC, Learn the Signs. Act Early.: milestone checklists and tips', url: 'https://www.cdc.gov/act-early/milestones/' },
  'cdc-bf': { label: 'CDC: How much and how often to breastfeed', url: 'https://www.cdc.gov/infant-toddler-nutrition/breastfeeding/how-much-and-how-often.html' },
  'cdc-formula': { label: 'CDC: How much and how often to feed infant formula', url: 'https://www.cdc.gov/infant-toddler-nutrition/formula-feeding/how-much-and-how-often.html' },
  'cdc-vitd': { label: 'CDC: Vitamin D', url: 'https://www.cdc.gov/infant-toddler-nutrition/vitamins-minerals/vitamin-d.html' },
  'cdc-solids': { label: 'CDC: When, what, and how to introduce solid foods', url: 'https://www.cdc.gov/infant-toddler-nutrition/foods-and-drinks/when-what-and-how-to-introduce-solid-foods.html' },
  'cdc-sleep': { label: 'CDC: Providing care for babies to sleep safely', url: 'https://www.cdc.gov/sudden-infant-death/sleep-safely/index.html' },
  'cdc-crying': { label: 'CDC: About abusive head trauma (the period of increased crying)', url: 'https://www.cdc.gov/child-abuse-neglect/about/about-abusive-head-trauma.html' },
  'aap-first-month': { label: 'AAP: Your Baby’s First Month: Growth & Physical Appearance', url: `${AAP}/ages-stages/baby/Pages/First-Month-Physical-Appearance-and-Growth.aspx` },
  'aap-1mo': { label: 'AAP: Developmental Milestones At 1 Month Old', url: `${AAP}/ages-stages/baby/Pages/Developmental-Milestones-1-Month.aspx` },
  'aap-1-4mo': { label: 'AAP: Developmental Milestones: 1-4 Months Old', url: `${AAP}/ages-stages/baby/Pages/Developmental-Milestones-3-Months.aspx` },
  'aap-move-0-3': { label: 'AAP: Movement Milestones: Birth to 3 Months', url: `${AAP}/ages-stages/baby/Pages/Movement-Birth-to-Three-Months.aspx` },
  'aap-social-0-3': { label: 'AAP: Emotional & Social Development in Babies: Birth Through 3 Months', url: `${AAP}/ages-stages/baby/Pages/Emotional-and-Social-Development-Birth-to-3-Months.aspx` },
  'aap-reflexes': { label: 'AAP: Newborn Reflexes', url: `${AAP}/ages-stages/baby/Pages/Newborn-Reflexes.aspx` },
  'aap-hearing': { label: 'AAP: Hearing & Making Sounds: Your Baby’s Milestones', url: `${AAP}/ages-stages/baby/Pages/Hearing-and-Making-Sounds.aspx` },
  'aap-7mo': { label: 'AAP: Developmental Milestones: 7 Months', url: `${AAP}/ages-stages/baby/Pages/Developmental-Milestones-7-Months.aspx` },
  'aap-12mo': { label: 'AAP: Developmental Milestones: 12 Months', url: `${AAP}/ages-stages/baby/Pages/Developmental-Milestones-12-Months.aspx` },
  'aap-2y': { label: 'AAP: Developmental Milestones: 2 Year Olds', url: `${AAP}/ages-stages/toddler/Pages/Developmental-Milestones-2-Year-Olds.aspx` },
  'aap-common': { label: 'AAP: 11 Common Conditions in Newborns', url: `${AAP}/ages-stages/baby/Pages/Common-Conditions-in-Newborns.aspx` },
  'aap-vision': { label: 'AAP: Baby’s Vision Development', url: `${AAP}/ages-stages/baby/Pages/Babys-Vision-Development.aspx` },
  'aap-colic': { label: 'AAP: Colic Relief Tips for Parents', url: `${AAP}/ages-stages/baby/crying-colic/Pages/Colic.aspx` },
  'aap-cries': { label: 'AAP: Responding To Your Baby’s Cries', url: `${AAP}/ages-stages/baby/crying-colic/Pages/Responding-to-Your-Babys-Cries.aspx` },
  'aap-sleep': { label: 'AAP: Getting Your Baby to Sleep', url: `${AAP}/ages-stages/baby/sleep/Pages/Getting-Your-Baby-to-Sleep.aspx` },
  'aap-tummy': { label: 'AAP: Back to Sleep, Tummy to Play', url: `${AAP}/ages-stages/baby/sleep/Pages/back-to-sleep-tummy-to-play.aspx` },
  'aap-feed': { label: 'AAP: How Often and How Much Should Your Baby Eat?', url: `${AAP}/ages-stages/baby/feeding-nutrition/Pages/How-Often-and-How-Much-Should-Your-Baby-Eat.aspx` },
  'aap-bf': { label: 'AAP: How Often To Breastfeed', url: `${AAP}/ages-stages/baby/breastfeeding/Pages/How-Often-to-Breastfeed.aspx` },
  'aap-diapers': { label: 'AAP: Baby’s First Days: Bowel Movements & Urination', url: `${AAP}/ages-stages/baby/Pages/Babys-First-Days-Bowel-Movements-and-Urination.aspx` },
  'aap-jaundice': { label: 'AAP: Jaundice in Newborns', url: `${AAP}/ages-stages/baby/Pages/Jaundice.aspx` },
  'aap-fever': { label: 'AAP: Fever: When to Call the Pediatrician', url: `${AAP}/health-issues/conditions/fever/Pages/When-to-Call-the-Pediatrician.aspx` },
  'aap-checkups': { label: 'AAP: Your Child’s Checkups (the checklist for each visit)', url: `${AAP}/ages-stages/Your-Childs-Checkups/Pages/default.aspx` },
  'aap-teething': { label: 'AAP: When Does Teething Start?', url: `${AAP}/ages-stages/baby/teething-tooth-care/Pages/Teething-4-to-7-Months.aspx` },
  'aap-move-4-7': { label: 'AAP: Movement Milestones: Babies 4 to 7 Months', url: `${AAP}/ages-stages/baby/Pages/Movement-4-to-7-Months.aspx` },
  'aap-move-8-12': { label: 'AAP: Movement Milestones in Babies 8 to 12 Months Old', url: `${AAP}/ages-stages/baby/Pages/Movement-8-to-12-Months.aspx` },
  'aap-lang-4-7': { label: 'AAP: Language Development: 4 to 7 Months', url: `${AAP}/ages-stages/baby/Pages/Language-Development-4-to-7-Months.aspx` },
  'aap-lang-8-12': { label: 'AAP: Language Development: 8 to 12 Months', url: `${AAP}/ages-stages/baby/Pages/Language-Development-8-to-12-Months.aspx` },
  'aap-social-8-12': { label: 'AAP: Emotional and Social Development: 8 to 12 Months', url: `${AAP}/ages-stages/baby/Pages/Emotional-and-Social-Development-8-12-Months.aspx` },
  'aap-ppd': { label: 'AAP: Depression During & After Pregnancy: You Are Not Alone', url: `${AAP}/ages-stages/prenatal/delivery-beyond/Pages/Understanding-Motherhood-and-Mood-Baby-Blues-and-Beyond.aspx` },
  'nhs-crying': { label: 'NHS: Soothing a crying baby', url: 'https://www.nhs.uk/conditions/baby/caring-for-a-newborn/soothing-a-crying-baby/' },
  'nhs-weight': { label: 'NHS: Your baby’s weight and height', url: 'https://www.nhs.uk/conditions/baby/babys-development/height-weight-and-reviews/baby-height-and-weight/' },
  'nhs-teething': { label: 'NHS: Baby teething symptoms', url: 'https://www.nhs.uk/conditions/baby/babys-development/teething/baby-teething-symptoms/' },
  'nhs-separation': { label: 'NHS: Separation anxiety', url: 'https://www.nhs.uk/conditions/baby/babys-development/behaviour/separation-anxiety/' },
} satisfies Record<string, GuideSource>

export type SourceId = keyof typeof GUIDE_SOURCES

export interface GuideLine {
  text: string
  /** How to see it: something to try, or what it looks like, from the same pages. Shown under the line. */
  how?: string
  src: SourceId[]
}

export interface GuideEntry {
  id: string
  /** Where the period starts and ends (exclusive), in days for the weeks and in months after them. */
  unit: 'week' | 'month'
  from: number
  to: number
  /** The strip's chip: "5 wk", "4 mo", "2 yr". */
  short: string
  /** "5 weeks old". */
  title: string
  /** The period in a phrase. */
  headline: string
  /** What to look for: lines with a `how` say what to try; the others say what the weeks bring. */
  notice: GuideLine[]
  /** Normal, even if it looks worrying: what a pediatrician reassures parents about at this age. */
  normal?: GuideLine[]
  /** Feeding and sleep. */
  care?: GuideLine[]
  /** What helps. */
  helps: GuideLine[]
  /** Check-ups. */
  visit?: GuideLine[]
  /** For you. */
  you?: GuideLine[]
  /** Call the doctor. */
  call?: GuideLine[]
}

const l = (text: string, ...src: SourceId[]): GuideLine => ({ text, src })
/** A thing to look for, with how to see it: what to try, or what to watch for while it happens. */
const see = (text: string, how: string, ...src: SourceId[]): GuideLine => ({ text, how, src })

// Lines that hold for a stretch of periods, said the same way each time.
const FEVER = l('A temperature of 100.4°F (38°C) or higher before 3 months: call the doctor right away, day or night.', 'aap-fever')
const FEVER_LATER = l('A fever with a baby who looks very ill, is unusually drowsy or very fussy, or one that lasts more than 24 hours: call the doctor.', 'aap-fever')
const SAFE_SLEEP = l('Every sleep on the back, on a firm flat surface, in your room.', 'cdc-sleep')
const HUNGER = l('Feed on the early signs: hands to mouth, turning toward the breast or bottle, lip smacking. Crying is a late sign.', 'cdc-milestones', 'aap-bf')
const VITAMIN_D = l('Breastfed and mixed-fed babies need 400 IU of vitamin D a day from the first days.', 'cdc-vitd')
const SOOTHE = l('For a crying spell: swaddle, hold skin to skin, rock gently, sing, or offer a pacifier.', 'cdc-crying')
const TAKE_A_BREAK = l('If the crying gets to you, lay your baby in the crib and step away for a few minutes. Never shake a baby.', 'aap-social-0-3', 'cdc-crying')
const TALK = l('Talk, read and sing to your baby; it is how language starts.', 'cdc-milestones')
const EIGHT_TO_TWELVE = l('8 to 12 feeds in 24 hours is usual.', 'cdc-bf', 'cdc-formula')
const FLOPPY = l('Call the pediatrician if your baby seems especially limp or floppy, or the whole body shakes. A quivery chin or shaky hands are common in newborns.', 'aap-move-0-3')
const LOST_SKILL = l('Tell the doctor if your baby stops doing something they used to do, or uses only one side of the body.', 'aap-move-0-3')

const week = (n: number, e: Omit<GuideEntry, 'id' | 'unit' | 'from' | 'to' | 'short' | 'title'> & { title?: string; short?: string }): GuideEntry => ({
  id: `w${n}`,
  unit: 'week',
  from: n * 7,
  to: (n + 1) * 7,
  short: n === 0 ? 'Newborn' : `${n} wk`,
  title: n === 0 ? 'The first week' : n === 1 ? '1 week old' : `${n} weeks old`,
  ...e,
})
const month = (from: number, to: number, short: string, title: string, e: Omit<GuideEntry, 'id' | 'unit' | 'from' | 'to' | 'short' | 'title'>): GuideEntry => ({ id: `m${from}`, unit: 'month', from, to, short, title, ...e })

/**
 * Not yet: what is too early to expect, each with the age its source gives, so nobody watches a two-month-old for a
 * tooth. A line shows in the periods that start at `from` months or later and before `until` (the age at which it
 * stops being ahead and becomes something to look for).
 */
export const NOT_YET: (GuideLine & { from: number; until: number })[] = [
  { from: 0, until: 1.1, ...l('A real smile in answer to yours: around the sixth week. Smiles in sleep before then are reflexes.', 'aap-move-0-3') },
  { from: 0, until: 3, ...l('Holding the head steady: most babies do by 4 months when held. Until then it needs your hand.', 'cdc-milestones', 'aap-move-0-3') },
  { from: 0, until: 3, ...l('Rolling over: a few begin at about 3 months, and most roll from tummy to back by 6.', 'aap-move-0-3', 'cdc-milestones') },
  { from: 0, until: 4, ...l('A regular sleep pattern: babies do not have regular sleep cycles until about 4 months.', 'aap-sleep') },
  { from: 1, until: 4, ...l('Laughing: chuckles come by about 4 months, and laughs by 6.', 'cdc-milestones') },
  { from: 0, until: 4, ...l('A first tooth: teething typically starts between 4 and 7 months.', 'aap-teething') },
  { from: 0, until: 5, ...l('Solid food: at about 6 months, and not before 4.', 'cdc-solids') },
  { from: 3, until: 6, ...l('Sitting without support: most babies do by 9 months.', 'cdc-milestones') },
  { from: 3, until: 7, ...l('Crawling: usually mastered between 7 and 10 months, and a few children never crawl.', 'aap-move-8-12') },
  { from: 4, until: 8, ...l('Answering to their name: around 9 months.', 'cdc-milestones') },
  { from: 5, until: 9, ...l('Picking up small things between finger and thumb: at about 9 months. Until then the grip is a raking one.', 'aap-move-4-7') },
  { from: 6, until: 12, ...l('First steps: most babies take them at about a year.', 'aap-move-0-3') },
  { from: 6, until: 12, ...l('First words: most babies call a parent "mama" or "dada" by 12 months, and try one or two other words by 15.', 'cdc-milestones') },
  { from: 12, until: 18, ...l('Walking without holding on: most children do by 18 months.', 'cdc-milestones') },
  { from: 12, until: 24, ...l('Two words together: most children say them by 2 years.', 'cdc-milestones') },
  { from: 12, until: 30, ...l('Toilet training: most children are not able to until 2 to 3 years, and starting too early can make it take longer.', 'cdc-milestones') },
  { from: 15, until: 36, ...l('Sharing: at 2, children play next to each other and do not yet know how to share.', 'cdc-milestones') },
  { from: 36, until: 60, ...l('Writing: most children write some letters of their name by 5 years.', 'cdc-milestones') },
]

/** The period's start as an age in months (weeks are days). */
const startMonths = (e: GuideEntry): number => (e.unit === 'week' ? e.from / 30.4375 : e.from)

/** What is too early to expect in this period, nearest first. */
export function notYetFor(e: GuideEntry): GuideLine[] {
  const at = startMonths(e)
  return NOT_YET.filter((n) => at >= n.from && at < n.until)
    .sort((a, b) => a.until - b.until)
    .map(({ text, src }) => ({ text, src }))
}

/** Weeks 0 to 12 end where "3 months" begins. */
export const WEEKS = 13

export const GUIDE: GuideEntry[] = [
  week(0, {
    headline: 'Feeding, sleeping, and finding each other',
    notice: [
      l('Loses some weight in the first days, then gains steadily from about day 5.', 'aap-first-month'),
      see('Sees best 8 to 12 inches away.', 'Hold your face about that far from your baby’s, as it is during a feed: a newborn can move the eyes to gaze at a face that near.', 'aap-vision', 'aap-move-0-3'),
      see('Turns toward a touch on the cheek (the rooting reflex).', 'Stroke the cheek or the mouth and the head turns toward your hand. It is how a newborn finds the nipple.', 'aap-reflexes'),
      see('Grips whatever touches the palm.', 'Stroke the palm and your baby grips your finger; stroke the sole of the foot and the toes curl.', 'aap-reflexes'),
      l('First stools are black or dark green, then turn yellow-green.', 'aap-diapers'),
      l('Skin can turn yellow in the first few days (jaundice); most of it needs no treatment.', 'aap-jaundice'),
    ],
    normal: [
      l('Hands and feet that look bluish or feel cool, and blotchy skin: the colour comes back when they are warmed or moved.', 'aap-first-month', 'aap-common'),
      l('A pink or brick-red stain in the diaper in the first week is usually concentrated urine, not blood, as long as there are at least 4 wet diapers a day.', 'aap-diapers'),
      l('A newborn girl may have a small spot of blood in the diaper in the first week, from the mother’s hormones.', 'aap-diapers'),
      l('Coughing and sputtering when the milk comes fast.', 'aap-common'),
      l('Sleeping most of the day, as long as your baby wakes every few hours, feeds well and is alert for part of the day.', 'aap-common'),
    ],
    care: [
      EIGHT_TO_TWELVE,
      l('A breastfed newborn may ask every 1 to 3 hours. On formula, 1 to 2 ounces every 2 to 3 hours.', 'cdc-bf', 'cdc-formula'),
      l('Do not let more than about 4 hours pass at night without a feed; wake your baby if needed.', 'aap-bf'),
      l('Sleeps 16 to 17 hours a day, only 1 or 2 hours at a time.', 'aap-sleep'),
      VITAMIN_D,
    ],
    helps: [SAFE_SLEEP, HUNGER, l('Tummy time can start the day you are home: 2 or 3 times a day for 3 to 5 minutes, awake and watched.', 'aap-tummy')],
    visit: [l('The first check-up is 2 to 5 days after birth: weight, a look for jaundice, feeding, and the results of the hospital’s hearing and blood screens.', 'aap-checkups', 'aap-jaundice')],
    you: [l('Mood swings are very common in the first 2 weeks after a birth.', 'aap-ppd')],
    call: [
      FEVER,
      l('Fewer than 4 wet diapers a day.', 'aap-diapers'),
      l('Yellow skin that deepens or spreads to the belly, arms or legs, yellow in the whites of the eyes, or a baby who is hard to wake or not feeding well.', 'aap-jaundice'),
      FLOPPY,
    ],
  }),
  week(1, {
    headline: 'Back toward birth weight',
    notice: [
      l('Back to birth weight by about 2 weeks; almost all babies are by 3 weeks.', 'aap-first-month', 'nhs-weight'),
      l('A growth spurt is typical around 7 to 10 days. Feeds can bunch together, as often as every hour (cluster feeding).', 'aap-first-month', 'cdc-bf'),
      l('The cord stump dries and falls off between 1 and 3 weeks.', 'aap-first-month'),
      see('Startles with the whole body at a loud sound or a sudden shift of the head (the Moro reflex): arms and legs fling out, then the arms come together.', 'It should look the same on both sides. If one side moves differently from the other, tell the pediatrician.', 'aap-reflexes'),
      see('"Walks" when held upright (the stepping reflex).', 'Hold your baby under the arms, supporting the head too, with the soles on a flat surface: one foot is placed in front of the other. It goes after about 2 months.', 'aap-reflexes', 'aap-move-0-3'),
      l('Hands stay in tight fists and arm movements are jerky.', 'aap-1mo'),
    ],
    normal: [
      l('A few drops of blood on the diaper around the time the cord stump falls off.', 'aap-common'),
      l('Smiles during sleep. They are reflexes, not yet answers to you.', 'aap-move-0-3'),
      l('Stools that are yellow, seedy and runny on breast milk, or tan and firmer on formula. Green ones are not unusual.', 'aap-diapers'),
      l('A quivery chin or shaky hands.', 'aap-move-0-3'),
    ],
    care: [EIGHT_TO_TWELVE, l('On formula most newborns eat every 2 to 3 hours, 1 to 2 ounces a feed.', 'aap-feed'), VITAMIN_D],
    helps: [l('You cannot spoil a young baby. Answering cries promptly means less crying overall.', 'aap-cries'), l('Keep the cord stump clean and dry until it falls off.', 'aap-first-month'), SAFE_SLEEP],
    call: [FEVER, l('Fewer than 4 wet diapers a day.', 'aap-diapers')],
  }),
  week(2, {
    headline: 'More awake time, and the crying starts to build',
    notice: [
      l('Crying tends to increase from around 2 weeks.', 'nhs-crying'),
      l('Fussy spells are most common in the late afternoon and evening.', 'nhs-crying'),
      l('Should be back at birth weight around now.', 'aap-first-month'),
      see('Turns the head side to side on the tummy; it still flops back without your hand.', 'Lie on your back with your baby on your chest: they lift the head and use the arms to try to see your face.', 'aap-1mo', 'aap-tummy'),
      see('Prefers faces and high-contrast patterns to anything else.', 'Hold your face, or a black-and-white pattern, 8 to 12 inches away: that is where a baby this age can focus.', 'aap-1mo'),
      l('About 1 in 5 babies develop colic, usually starting between the second and fourth weeks.', 'aap-colic'),
    ],
    normal: [
      l('Crying for no reason you can find. All newborns do it.', 'aap-common'),
      l('Stretching out and arching the back now and then, after the curled-up position of the womb.', 'aap-first-month'),
      l('Hair falling out, or a bald spot where the head rubs. New hair covers it in a few months.', 'aap-first-month'),
    ],
    care: [EIGHT_TO_TWELVE, HUNGER],
    helps: [SOOTHE, TAKE_A_BREAK, l('Keep up tummy time, a few minutes at a time, awake and watched.', 'aap-tummy')],
    you: [l('Baby blues tend to pass in a few days or weeks. Feelings that will not lift may be postpartum depression, which about 1 in 8 people who give birth develop: tell your doctor.', 'aap-ppd')],
    call: [FEVER, FLOPPY],
  }),
  week(3, {
    headline: 'A growth spurt, and maybe baby acne',
    notice: [
      l('Another growth spurt comes between 3 and 6 weeks.', 'aap-first-month'),
      l('Gains close to an ounce (28 g) a day through the first month.', 'aap-first-month'),
      see('Knows your voice, and may look or turn toward it.', 'Speak before your baby can see you: by 1 month babies can tell a parent by voice, even from another room.', 'aap-1mo', 'aap-hearing'),
      see('The "fencing" pose (tonic neck reflex): when the head turns to one side, that arm straightens and the other bends.', 'It is subtle, and a crying or disturbed baby may not show it. It goes by 5 to 7 months.', 'aap-reflexes'),
      l('The cord stump should be off and the navel healed.', 'aap-first-month'),
    ],
    normal: [
      l('Pimples on the face (baby acne) often appear in the third to fifth week and clear on their own in a few weeks.', 'aap-first-month'),
      l('Many babies pass a stool after every feed. By 3 to 6 weeks some breastfed babies pass only one a week, which is normal if it is soft and your baby feeds and gains well.', 'aap-diapers'),
    ],
    care: [EIGHT_TO_TWELVE, l('A breastfed baby can have a pacifier from about 3 to 4 weeks, once feeding is going well.', 'aap-feed')],
    helps: [TALK, SOOTHE, SAFE_SLEEP],
    call: [FEVER, l('A navel that is not healed and dry after 3 weeks.', 'aap-first-month')],
  }),
  week(4, {
    headline: 'One month: more alert, and watching you',
    notice: [
      l('Much more alert and responsive than in the first weeks.', 'aap-1mo'),
      see('Listens when you speak and watches you as you hold them.', 'Talk with your face close, slower and higher than usual, with your eyes and mouth wide: it is what holds a baby’s attention.', 'aap-1mo', 'aap-hearing'),
      see('Recognizes and reacts to loud sounds.', 'A loud or sudden noise brings the startle: arms and legs out, sometimes a cry.', 'aap-1mo', 'aap-reflexes'),
      l('Brings the hands within range of the eyes and mouth.', 'aap-1mo'),
    ],
    normal: [
      l('Eyes that wander or cross now and then in these first months.', 'aap-1mo', 'aap-checkups'),
      l('A belly that sticks out after a big feed. Between feeds it should feel soft.', 'aap-common'),
    ],
    care: [l('By the end of the first month most bottle-fed babies take at least 3 to 4 ounces a feed, about every 3 to 4 hours.', 'aap-feed'), l('Breastfed babies still feed 8 to 12 times in 24 hours.', 'cdc-bf')],
    helps: [l('A mobile or pictures with strong contrast give your baby something to study. Keep mobiles off the sleep surface.', 'aap-1mo'), TALK, l('Tummy time 2 or 3 times a day.', 'aap-tummy')],
    visit: [l('The 1-month check-up: weight, length and head are measured and development is looked at. A second hepatitis B dose may be given now or at 2 months.', 'aap-checkups')],
    call: [FEVER, LOST_SKILL],
  }),
  week(5, {
    headline: 'The fussy weeks, with the first real smiles close',
    notice: [
      l('Fussing builds toward a peak at about 6 weeks, around 3 hours a day.', 'aap-colic'),
      see('The first real smile often comes around the sixth week.', 'Smile and talk with your face close. At first your baby may seem to smile past you without meeting your eyes; that is normal.', 'aap-move-0-3', 'aap-social-0-3'),
      see('Starts to lift the head when lying on the tummy.', 'Give them something to look at in front, such as your face: it is the reason to lift.', 'aap-move-0-3'),
      l('Waves the arms when excited and starts to notice their own hands.', 'aap-move-0-3'),
      l('A growth spurt is possible any time from 3 to 6 weeks.', 'aap-first-month'),
    ],
    normal: [
      l('Hours of fussing in the late afternoon and evening, in a baby who is fine the rest of the day.', 'nhs-crying', 'aap-colic'),
      l('Hands still in tight fists most of the time.', 'aap-move-0-3'),
    ],
    care: [EIGHT_TO_TWELVE, HUNGER],
    helps: [SOOTHE, TAKE_A_BREAK, l('Work up to 15 to 30 minutes of tummy time a day by 7 weeks.', 'aap-tummy')],
    call: [FEVER],
  }),
  week(6, {
    headline: 'Crying is at its peak, and it eases from here',
    notice: [
      l('Fussing usually peaks now at about 3 hours a day, then falls to 1 or 2 hours a day by 3 to 4 months.', 'aap-colic'),
      see('Real smiles, in answer to yours.', 'Smile and talk with your face close, then pause and give your baby a turn.', 'aap-move-0-3', 'aap-social-0-3', 'aap-hearing'),
      see('Holds your gaze for longer and longer.', 'If your baby looks away, let them: it keeps them from being overwhelmed. A different distance or a softer voice can help them stay with you longer.', 'aap-social-0-3'),
      l('May get the hands to the mouth and suck on them to settle.', 'aap-move-0-3'),
    ],
    care: [EIGHT_TO_TWELVE],
    helps: [
      l('If your baby calms within a few hours and is peaceful the rest of the day, this is ordinary fussing, not a problem.', 'aap-colic'),
      l('Answer smiles with smiles and talk: these first "conversations" tell your baby they matter to you.', 'aap-social-0-3'),
      TAKE_A_BREAK,
    ],
    call: [FEVER, l('Crying that does not stop, gets more intense and lasts through the day or night: talk to the doctor about colic.', 'aap-colic')],
  }),
  week(7, {
    headline: 'Smiles, coos, and a steadier head',
    notice: [
      l('Smiles when you talk or smile.', 'cdc-milestones'),
      see('Starts to answer you with soft coos and gurgles in the second or third month.', 'Copy the sounds your baby makes and see how long the two of you can "talk" back and forth.', 'aap-1-4mo', 'cdc-milestones'),
      see('Watches faces intently and follows a moving object with the eyes.', 'Walk slowly across the room where your baby can see you, and watch the eyes come with you.', 'aap-1-4mo', 'cdc-milestones'),
      see('Holds the head up when on the tummy.', 'Lay your baby on the tummy, awake and watched, with toys at eye level in front.', 'cdc-milestones'),
    ],
    normal: [
      l('Crying when put on the tummy. Most babies do better after a few tries.', 'aap-move-0-3'),
    ],
    care: [l('The time between feeds slowly gets longer: most breastfed babies feed every 2 to 4 hours, formula-fed every 3 to 4.', 'cdc-bf', 'cdc-formula')],
    helps: [l('Tummy time should add up to 15 to 30 minutes a day by now.', 'aap-tummy'), TALK, l('Learn the signs of being full: closing the mouth, turning the head away.', 'cdc-milestones')],
    visit: [l('The 2-month check-up is coming, with the first large round of vaccines.', 'aap-checkups')],
    call: [FEVER],
  }),
  week(8, {
    headline: 'Two months: the first checklist, and the 2-month visit',
    notice: [
      see('Calms down when spoken to or picked up.', 'When your baby fusses, talk softly or pick them up, and notice whether it eases.', 'cdc-milestones'),
      see('Looks at your face, and smiles when you talk or smile.', 'Smile and talk with your face close and see whether a smile comes back.', 'cdc-milestones'),
      see('Makes sounds other than crying.', 'Copy the sounds and see how long your baby "talks" back and forth with you.', 'cdc-milestones'),
      see('Reacts to loud sounds.', 'Hold a rattle off to one side of the head, shake it, and see if your baby looks for the noise.', 'cdc-milestones'),
      see('Watches you as you move, and looks at a toy for several seconds.', 'Look together at pictures with bright colours or faces, and talk about them.', 'cdc-milestones'),
      see('Holds the head up on the tummy, moves both arms and both legs, and opens the hands briefly.', 'Lay your baby on the tummy, awake and watched, with toys at eye level. Look for both arms and both legs moving.', 'cdc-milestones'),
      l('Crying starts to ease after its 6-week peak.', 'aap-colic'),
    ],
    normal: [
      l('A smile for you and only a curious stare for a stranger.', 'aap-social-0-3'),
      l('Occasional crossing of the eyes is still normal.', 'aap-checkups'),
    ],
    care: [l('Only breast milk or formula for about the first 6 months: no water, other drinks or foods.', 'cdc-milestones'), VITAMIN_D],
    helps: [TALK, HUNGER, l('Look after yourself too. It is easier to enjoy a baby when you feel well.', 'cdc-milestones')],
    visit: [l('The 2-month check-up: most babies are immunized against seven or eight diseases at this visit (the AAP lists hepatitis B, rotavirus, DTaP, Hib, pneumococcal and polio).', 'aap-checkups')],
    call: [FEVER, LOST_SKILL],
  }),
  week(9, {
    headline: 'The hands open up',
    notice: [
      l('The hands are no longer in fists all the time; your baby may open and shut them and watch.', 'aap-move-0-3'),
      see('Turns the head toward a sound.', 'Speak from one side: between about 1 and 3 months babies start to smile at a parent’s voice and turn the head toward where a sound comes from.', 'aap-hearing'),
      see('Likes to look at faces more than anything else.', 'Place a baby-safe mirror near your baby so they can look at themselves.', 'aap-1mo', 'cdc-milestones'),
      l('The startle reflex fades in the third month.', 'aap-move-0-3'),
      l('Kicks harder as the legs straighten out from their newborn tuck.', 'aap-move-0-3'),
      l('Smiles easily for the people they know best; a stranger may get a curious stare.', 'aap-social-0-3'),
    ],
    care: [l('Most breastfed babies feed every 2 to 4 hours, with the odd longer sleep of 4 to 5 hours.', 'cdc-bf')],
    helps: [TALK, l('Limit awake time in swings, bouncy seats and car seats; floor time builds strength.', 'aap-tummy'), SAFE_SLEEP],
    call: [FEVER],
  }),
  week(10, {
    headline: 'Reaching and batting',
    notice: [
      see('Swipes at things hanging just out of reach.', 'Hang a toy where the arms can almost reach it. Never fix one to the sleeping surface.', 'aap-move-0-3', 'aap-1mo'),
      see('The grip turns deliberate: may hold and shake a rattle.', 'Put a rattle in the hand and see whether the fingers hold on and shake it.', 'aap-move-0-3'),
      see('Bounces when held standing on your lap.', 'Hold your baby upright with the feet on your lap and let them push.', 'aap-move-0-3'),
      see('Coos and repeats vowel sounds, "ah-ah-ah" and "ooh-ooh-ooh", from about 2 months.', 'Imitate the cooing and add simple words and phrases of your own.', 'aap-hearing', 'aap-1-4mo'),
    ],
    care: [l('Formula-fed babies eat about every 3 to 4 hours.', 'cdc-formula')],
    helps: [l('A rattle sturdy enough not to break, and a hanging mobile, suit this age.', 'aap-1-4mo'), TALK, l('Avoid leaving your baby in bouncer seats or harnesses; they give the muscles less to do.', 'aap-move-0-3')],
    call: [FEVER],
  }),
  week(11, {
    headline: 'Calmer evenings',
    notice: [
      l('Crying gradually reduces at around 3 months.', 'nhs-crying'),
      l('Fussing is down to 1 or 2 hours a day by 3 to 4 months.', 'aap-colic'),
      see('By 3 months focuses on faces and close objects and follows a moving object with the eyes.', 'Lay your baby on the back and move a bright toy slowly from left to right and up and down, and see if the eyes go with it.', 'aap-vision', 'cdc-milestones'),
      see('Becomes intrigued by other children at about 3 or 4 months.', 'Watch your baby’s face when a brother, sister or another child talks to them.', 'aap-social-0-3'),
    ],
    care: [l('Keep the days bright and busy and the nights calm and quiet; it helps your baby tell them apart.', 'aap-sleep')],
    helps: [TALK, l('Colicky crying generally stops by 3 to 4 months.', 'aap-colic'), SAFE_SLEEP],
    call: [FEVER],
  }),
  week(12, {
    headline: 'Three months: rolling is on its way',
    notice: [
      l('Kicks are strong enough that your baby may soon flip from tummy to back; some roll at this age.', 'aap-move-0-3'),
      see('May begin to push up on the arms during tummy time.', 'Place yourself or a toy just out of reach in front, to get your baby reaching.', 'aap-move-0-3', 'aap-tummy'),
      l('Arm and leg movements are smoother, and the body looks more relaxed.', 'aap-move-0-3'),
      see('Often smiles when they see or hear you.', 'Come into view, or speak before you do, and watch for the smile.', 'aap-1-4mo'),
      l('Newborn reflexes fade as control grows: stepping and the startle after about 2 months, turning toward a stroked cheek by about 4.', 'aap-1-4mo', 'aap-reflexes'),
    ],
    care: [l('Regular sleep cycles arrive at about 4 months; until then sleep is still irregular.', 'aap-sleep')],
    helps: [l('Never leave your baby alone on a bed, sofa or changing table: the first roll comes without warning.', 'aap-move-0-3'), TALK, SAFE_SLEEP],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(3, 4, '3 mo', '3 months old', {
    headline: 'Hands, chuckles, and a steady head on the way',
    notice: [
      see('Coming by 4 months: holds the head steady when held, and pushes up onto the forearms on the tummy.', 'Hold your baby upright and see whether the head stays steady without your hand behind it.', 'cdc-milestones'),
      see('Brings the hands to the mouth and holds a toy you put in the hand.', 'Offer toys that are easy to hold, such as a rattle or a cloth book.', 'cdc-milestones'),
      see('Chuckles when you try to make them laugh, and coos back when you talk.', 'Play peek-a-boo: cover your eyes with your hands, uncover them and say "peek-a-boo", and watch for the smile.', 'cdc-milestones'),
      see('By 4 months sees colours and their shades well, and reaches for what is close.', 'Put your baby on a blanket with safe toys to reach for and kick at.', 'aap-vision', 'cdc-milestones'),
    ],
    care: [l('Regular sleep cycles arrive at about 4 months.', 'aap-sleep'), l('Solid food is not recommended before 4 months; about 6 months is the time.', 'cdc-solids')],
    helps: [
      l('Give time on the floor to move, and keep swings, strollers and bouncy seats short.', 'cdc-milestones'),
      l('Let your baby mouth safe things: nothing sharp, hot or small enough to choke on.', 'cdc-milestones'),
    ],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(4, 5, '4 mo', '4 months old', {
    headline: 'Four months: laughing, babbling, reaching',
    notice: [
      see('By 4 months most babies smile to get your attention, chuckle, coo, and turn toward your voice.', 'Copy your baby’s sounds and see how long they "talk" back and forth with you.', 'cdc-milestones'),
      see('Holds the head steady, swings an arm at toys, and pushes up on the forearms.', 'Hold your baby securely under the arms with the feet on your lap and let them bounce.', 'cdc-milestones'),
      l('Looks at their hands with interest, and opens the mouth at the sight of the breast or bottle when hungry.', 'cdc-milestones'),
      l('Babbling starts at about 4 months, with the rise and fall of real speech.', 'aap-lang-4-7'),
      l('Teething typically starts between 4 and 7 months; drooling and wanting to chew are the signs.', 'aap-teething'),
    ],
    care: [l('From 4 months, put your baby down drowsy but awake so they learn to fall asleep in their own bed.', 'aap-sleep'), l('Set steady routines for sleeping and feeding.', 'cdc-milestones')],
    helps: [l('For sore gums, rub them with a clean finger or offer a firm rubber teething ring. No numbing gels, teething tablets or amber necklaces.', 'aap-teething'), TALK],
    visit: [l('The 4-month check-up: growth and development, and the second doses of the 2-month vaccines.', 'aap-checkups')],
    call: [FEVER_LATER, LOST_SKILL, l('Tell the pediatrician if by 4 months your baby does not turn the head to find a sound, or seems very stiff or very floppy.', 'aap-7mo')],
  }),
  month(5, 6, '5 mo', '5 months old', {
    headline: 'Getting ready to roll and to sit',
    notice: [
      l('Rocks on the stomach, kicks and "swims" with the arms, usually at about 5 months.', 'aap-move-4-7'),
      l('Rolling both ways and sitting up are the big projects of 4 to 7 months.', 'aap-move-4-7'),
      see('Starts to balance sitting, leaning forward on the hands like a tripod.', 'An interesting toy in front gives your baby something to focus on while finding the balance.', 'aap-move-4-7'),
      see('Brings interesting things to the mouth with ease.', 'Let your baby see, hear, touch and mouth safe things: nothing sharp, hot or small enough to choke on.', 'aap-move-4-7', 'cdc-milestones'),
      l('Might repeat one sound for a day or more before trying another.', 'aap-lang-4-7'),
    ],
    care: [l('Signs of being ready for solids: sits with support, controls head and neck, opens the mouth for food, and swallows it instead of pushing it out.', 'cdc-solids')],
    helps: [l('Help your baby practise sitting: hold them up or prop the back with pillows while they find their balance.', 'aap-move-4-7'), l('Put toys just out of reach to encourage rolling.', 'cdc-milestones'), SAFE_SLEEP],
    call: [FEVER_LATER, LOST_SKILL, l('Tell the pediatrician if by 5 months your baby does not roll over in either direction or does not smile on their own.', 'aap-7mo')],
  }),
  month(6, 7, '6 mo', '6 months old', {
    headline: 'Six months: sitting with help, and first foods',
    notice: [
      see('By 6 months most babies know familiar people, laugh, and take turns making sounds with you.', 'When your baby smiles, smile; when they make a sound, copy it, and look for them taking their turn.', 'cdc-milestones'),
      see('Rolls from tummy to back and leans on the hands to sit.', 'Hold your baby up while they sit, with toys to look at as they learn to balance.', 'cdc-milestones'),
      see('Reaches for a toy they want and puts things in the mouth to explore.', 'When a toy is dropped, pick it up and hand it back: the game teaches cause and effect.', 'cdc-milestones'),
      see('Curious about sounds and voices.', 'Whisper, clap or make a funny noise and see if your baby looks, and which sounds they like best.', 'cdc-milestones'),
      l('Most babies start teething at around 6 months, some before 4 months and some after 12.', 'nhs-teething'),
    ],
    care: [
      l('Solid foods can start at about 6 months; breast milk or formula is still the main food.', 'cdc-solids', 'cdc-milestones'),
      l('On formula, 6 to 8 ounces at each of 4 or 5 feeds is typical by 6 months.', 'aap-feed'),
      l('It is normal at 6 months to wake in the night and settle again within a few minutes.', 'aap-sleep'),
    ],
    helps: [l('Ask the doctor about starting solids and which foods are choking risks.', 'cdc-milestones'), l('Point at things and name them: cars, trees, animals.', 'cdc-milestones'), l('Keep your baby’s sleep space in your room, ideally until at least 6 months.', 'cdc-sleep')],
    visit: [l('The 6-month check-up: third doses of the earlier vaccines, and a flu vaccine is recommended from 6 months.', 'aap-checkups')],
    call: [FEVER_LATER, LOST_SKILL, l('Tell the pediatrician if by 6 months your baby cannot sit with help, or does not laugh or squeal.', 'aap-7mo')],
  }),
  month(7, 8, '7 mo', '7 months old', {
    headline: 'Copying sounds, and on the move soon',
    notice: [
      see('From 6 or 7 months your baby actively copies the sounds of speech.', 'Look at colourful pictures together and talk about them. When your baby babbles back, answer: "Yes, that is the doggy!"', 'aap-lang-4-7', 'cdc-milestones'),
      l('Passes things from hand to hand and turns them over, between the sixth and eighth month.', 'aap-move-4-7'),
      l('By 7 months: sits with the help of the hands and then without, finds a toy that is partly hidden, and is interested in the baby in the mirror.', 'aap-7mo'),
      see('Takes the whole weight on the legs when held standing.', 'Hold your baby securely under the arms and let them stand, and name what the two of you can see.', 'aap-7mo', 'cdc-milestones'),
      l('Crawling is usually mastered between 7 and 10 months.', 'aap-move-8-12'),
    ],
    normal: [
      l('Never crawling at all. Some children scoot on the bottom or slither on the stomach instead; it is fine as long as both sides of the body are used equally.', 'aap-move-8-12'),
    ],
    care: [l('By 7 or 8 months your baby can eat a variety of foods from the different food groups.', 'cdc-solids'), l('No cow’s milk as a drink before 12 months; yogurt without added sugar is fine.', 'cdc-solids')],
    helps: [l('Answer the babble: repeat the sounds back and wait for a reply.', 'aap-lang-8-12'), l('Clear the floor of anything small enough to choke on.', 'aap-move-4-7')],
    call: [l('No babbling or copying of sounds by the seventh month: tell the doctor, who may check the hearing.', 'aap-lang-4-7'), FEVER_LATER, l('Tell the pediatrician if by 7 months your baby does not reach for things, does not take some weight on the legs, or only ever reaches with the same hand.', 'aap-7mo')],
  }),
  month(8, 9, '8 mo', '8 months old', {
    headline: 'Wary of strangers, and clingy with you',
    notice: [
      l('Fear of strangers is one of the first emotional milestones: a baby who was easy with everyone now tenses up.', 'aap-social-8-12'),
      see('Becomes clingy about you leaving. This is the start of separation anxiety.', 'Say a quick, cheerful goodbye instead of slipping away, and say so when you are back.', 'aap-social-8-12', 'cdc-milestones'),
      see('Enjoys peek-a-boo.', 'Cover your head with a cloth and see if your baby pulls it off.', 'cdc-milestones'),
      l('Much more mobile from about 8 months.', 'aap-move-8-12'),
      l('May rock on hands and knees, or even push backward, before crawling forward.', 'aap-move-8-12'),
    ],
    care: [l('Most 6 to 12 month olds need formula or solid food about 5 to 6 times in 24 hours.', 'cdc-formula')],
    helps: [
      l('Leave after a nap and a meal: babies take separation harder when tired, hungry or sick.', 'aap-social-8-12'),
      l('Practise short separations at home, and say where you are going and that you will be back.', 'aap-social-8-12'),
      l('Put an interesting toy just out of reach to encourage crawling.', 'aap-move-8-12'),
    ],
    call: [FEVER_LATER, LOST_SKILL, l('Tell the pediatrician if by 8 months your baby does not babble or shows no interest in peek-a-boo.', 'aap-7mo')],
  }),
  month(9, 10, '9 mo', '9 months old', {
    headline: 'Nine months: sitting alone, and a screening visit',
    notice: [
      l('By 9 months most babies sit without support and get to sitting by themselves.', 'cdc-milestones'),
      see('Makes strings of sounds like "mamamama" and "babababa", and lifts the arms to be picked up.', 'Repeat the sounds, then say a simple word that uses them: "bababa", then "book".', 'cdc-milestones'),
      see('Looks when you call their name and looks for a toy dropped out of sight.', 'Hide a toy under a blanket while your baby watches and see if they look for it.', 'cdc-milestones'),
      see('Bangs two things together, and passes a toy from one hand to the other.', 'Play "my turn, your turn" by passing a toy back and forth.', 'cdc-milestones'),
      l('The thumb-and-finger pincer grip arrives at about 9 months.', 'aap-move-4-7'),
    ],
    care: [l('Let your baby practise finger feeding and drinking a little water from a cup.', 'cdc-milestones'), l('Offer different tastes and textures: smooth, mashed, finely chopped. A food refused once deserves more tries.', 'cdc-milestones')],
    helps: [l('Say what you want instead of what you do not: "time to sit", not "don’t stand".', 'cdc-milestones'), l('Dump blocks out of a container and put them back in together.', 'cdc-milestones')],
    visit: [l('The 9-month check-up includes a developmental screening: a more formal set of questions about how your baby is growing and behaving.', 'aap-checkups', 'cdc-milestones')],
    call: [l('Not sitting alone by 9 months: tell the pediatrician.', 'aap-move-8-12'), FEVER_LATER],
  }),
  month(10, 11, '10 mo', '10 months old', {
    headline: 'Pulling up, pointing, and first syllables',
    notice: [
      l('Coos and screeches give way to syllables: "ba", "da", "ga", "ma".', 'aap-lang-8-12'),
      l('May say "mama" or "bye-bye" by accident, then learn it means something from your delight.', 'aap-lang-8-12'),
      see('Pulls up to standing at every chance, and at first may not know how to get down.', 'Put your baby close to things that are safe to pull up on.', 'aap-move-8-12', 'cdc-milestones'),
      see('Learns gestures by copying you: most babies wave "bye-bye" by 12 months.', 'Wave and say "bye-bye" each time you leave.', 'cdc-milestones'),
      l('Separation anxiety usually peaks between 10 and 18 months.', 'aap-social-8-12'),
    ],
    helps: [l('Ask questions and wait for an answer; repeat your baby’s sounds back.', 'aap-lang-8-12'), l('Build a small obstacle course of pillows and cushions, and stay close.', 'aap-move-8-12')],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(11, 12, '11 mo', '11 months old', {
    headline: 'Understanding more than they can say',
    notice: [
      see('Understands far more than they can say.', 'Name a favourite toy and watch your baby look toward it.', 'aap-lang-8-12'),
      see('Shows what they want by pointing, crawling or gesturing toward it.', 'Answer a point with words: "You want the cup? Here is the cup."', 'aap-lang-8-12', 'cdc-milestones'),
      l('A first "word" is any sound used the same way for the same thing.', 'aap-lang-8-12'),
      l('Most babies take their first real steps at about a year.', 'aap-move-0-3'),
    ],
    helps: [l('Treat the made-up word as a word, and say the real one back.', 'aap-lang-8-12'), l('Baby-proof where your child explores, and lock away medicines and cleaning products.', 'cdc-milestones')],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(12, 15, '1 yr', '1 year old', {
    headline: 'One year: standing, cruising, first words',
    notice: [
      see('By 12 months most babies pull up to stand and walk holding on to furniture.', 'Let your baby push an empty box or a push toy, or hold your hands, to practise. Baby walkers are not recommended.', 'cdc-milestones'),
      see('Waves bye-bye, calls a parent "mama" or "dada", and understands "no".', 'Talk or sing about what you are doing: "This is the way we wash our hands."', 'cdc-milestones'),
      see('Picks up small things between thumb and finger and puts things in a container.', 'Play together with blocks and a container: in, and out again.', 'cdc-milestones'),
      see('Looks for things they see you hide.', 'Let your baby watch you put a toy under a blanket, and see if they go and find it.', 'cdc-milestones'),
      l('Separation anxiety usually peaks between 10 and 18 months, then fades in the second half of the second year.', 'aap-social-8-12'),
    ],
    care: [
      l('At 12 months formula can give way to plain whole cow’s milk, a feed at a time.', 'cdc-formula'),
      l('Water, breast milk or plain milk to drink. Juice is not needed; if given, 4 ounces a day at most.', 'cdc-milestones'),
      l('From 12 months children need 600 IU of vitamin D a day.', 'cdc-vitd'),
    ],
    helps: [l('Build on what your child tries to say: for "ta", answer "Yes, a truck".', 'cdc-milestones'), l('Give safe places to explore and keep the Poison Help number handy.', 'cdc-milestones')],
    visit: [l('The 12-month check-up: vaccines for measles, mumps and rubella, hepatitis A and chickenpox may be given, and the doctor checks for anemia.', 'aap-checkups')],
    call: [FEVER_LATER, LOST_SKILL, l('Tell the pediatrician if at 12 months your baby cannot stand when supported, does not look for a toy hidden while they watch, says no single word, or does not wave, shake the head or point.', 'aap-12mo')],
  }),
  month(15, 18, '15 mo', '15 months old', {
    headline: 'First steps, first words, and showing you things',
    notice: [
      l('By 15 months most children take a few steps on their own.', 'cdc-milestones'),
      see('Tries one or two words besides "mama" and "dada", and points to ask for something.', 'When your child points, name the thing and wait a few seconds for a sound before handing it over.', 'cdc-milestones'),
      see('Tries to use things the right way, like a phone, a cup or a book.', 'Put a hat on your head, then hand it over and see if your child copies you. Try it with a book or a cup.', 'cdc-milestones'),
      see('Stacks at least two small things, like blocks.', 'Play with blocks together: you stack them, your child knocks them down.', 'cdc-milestones'),
      l('Shows you things they like, claps when excited, and shows affection.', 'cdc-milestones'),
    ],
    normal: [
      l('Tantrums. They are normal at this age, more likely when your child is tired or hungry, and get shorter and fewer with age.', 'cdc-milestones'),
      l('Early words that are not complete: "ba" for ball.', 'cdc-milestones'),
    ],
    care: [l('Steady routines for sleeping and eating; a calm bedtime with pyjamas, teeth and a book or two.', 'cdc-milestones'), l('Practise an open cup and a spoon. It is messy.', 'cdc-milestones')],
    helps: [l('Sing songs with gestures and see which actions your child copies.', 'cdc-milestones'), l('Screens are not recommended before 2 years, apart from video calls with family.', 'cdc-milestones')],
    visit: [l('The 15-month check-up: any vaccines still due from the 6- and 12-month visits.', 'aap-checkups')],
    call: [FEVER_LATER],
  }),
  month(18, 24, '18 mo', '18 months old', {
    headline: 'Walking, pointing to share, and a screening visit',
    notice: [
      see('By 18 months most children walk without holding on, scribble, and try a spoon.', 'Offer a cup without a lid and a spoon at meals. It is messy, and that is the practice.', 'cdc-milestones'),
      see('Tries three or more words besides "mama" and "dada", and follows a one-step direction.', 'Say "Give it to me" without holding out a hand, and see if the toy comes.', 'cdc-milestones'),
      see('Copies you doing chores, like sweeping with a broom.', 'Encourage pretend play too: hand over a spoon so your child can "feed" a stuffed animal, and take turns.', 'cdc-milestones'),
      l('Points to show you something interesting.', 'cdc-milestones'),
    ],
    care: [l('Sit at the table together for meals and snacks; it sets the routine.', 'cdc-milestones')],
    helps: [l('Offer a choice between two things: the red shirt or the blue one.', 'cdc-milestones'), l('Name body parts as you point to them: "your nose, my nose".', 'cdc-milestones')],
    visit: [l('The 18-month check-up includes developmental and autism screening questionnaires for you to fill in.', 'aap-checkups', 'cdc-milestones')],
    call: [FEVER_LATER, l('Tell the pediatrician if your child cannot walk by 18 months, or after several months of walking still walks only on the toes.', 'aap-2y')],
  }),
  month(24, 30, '2 yr', '2 years old', {
    headline: 'Two years: two words together, running, big feelings',
    notice: [
      see('By 2 years most children say at least two words together, run, and kick a ball.', 'Give your child balls to kick, roll and throw.', 'cdc-milestones'),
      see('Points to at least two body parts when you ask.', 'Sing "Head, Shoulders, Knees and Toes"; after a few times, touch a body part, wait, and see if your child sings the word.', 'cdc-milestones'),
      l('Notices when others are upset, and looks at your face to see how to react.', 'cdc-milestones'),
      l('Roller-coaster emotions are normal at this age, and a tantrum to get their way is part of it.', 'aap-checkups'),
    ],
    normal: [
      l('Eating a lot at one meal and little at the next. Toddlers do not eat the same amount or kind of food every day.', 'cdc-milestones'),
    ],
    care: [l('Let your child eat as much or as little as they want at each meal.', 'cdc-milestones')],
    helps: [l('Ask the doctor about toilet training to know whether your child is ready.', 'cdc-milestones'), l('Stay close during playdates: children this age play beside each other more than together.', 'cdc-milestones')],
    visit: [l('The 2-year check-up includes an autism screening.', 'aap-checkups', 'cdc-milestones')],
    call: [l('A fever that lasts more than 3 days, or with a child who looks very ill: call the doctor.', 'aap-fever'), l('Tell the pediatrician if by age 2 your child does not use two-word sentences, does not follow simple instructions, or does not copy actions or words.', 'aap-2y')],
  }),
  month(30, 36, '30 mo', '30 months old', {
    headline: 'About 50 words, pretend play, and "look at me"',
    notice: [
      l('By 30 months most children say about 50 words and put two together with an action word.', 'cdc-milestones'),
      see('Plays pretend, follows two-step instructions, and jumps with both feet.', 'Try an instruction in two steps, like "Put the toy down and close the door."', 'cdc-milestones'),
      see('"Draws" with crayons or chalk.', 'Draw a straight line and see if your child copies it. When lines come easily, show how to draw a circle.', 'cdc-milestones'),
      l('Plays next to other children and sometimes with them.', 'cdc-milestones'),
    ],
    helps: [
      l('Let your child choose between two or three simple, healthy options.', 'cdc-milestones'),
      l('Make time for free play, where your child follows their own interests.', 'cdc-milestones'),
      l('Show how to share, take turns and use words with other children.', 'cdc-milestones'),
    ],
    visit: [l('The 30-month check-up looks closely at language and social development, with a developmental screening.', 'aap-checkups', 'cdc-milestones')],
  }),
  month(36, 48, '3 yr', '3 years old', {
    headline: 'Three years: conversations and questions',
    notice: [
      see('By 3 years most children hold a short conversation and ask who, what, where and why.', 'Read together and ask "What is happening in the picture?" When an answer comes, ask for more.', 'cdc-milestones'),
      l('Joins other children to play, and calms within 10 minutes after you leave.', 'cdc-milestones'),
      see('Draws a circle when shown how, puts on some clothes, and uses a fork.', 'Give an "activity box" of paper and crayons, and draw lines and shapes together.', 'cdc-milestones'),
    ],
    helps: [l('Give instructions with 2 or 3 steps.', 'cdc-milestones'), l('Help your child name feelings and give them ways to calm down.', 'cdc-milestones'), l('Let your child help make meals with simple jobs.', 'cdc-milestones')],
  }),
  month(48, 60, '4 yr', '4 years old', {
    headline: 'Four years: stories, pretend, and helping',
    notice: [
      see('By 4 years most children speak in sentences of four or more words and tell you about their day.', 'Read together and ask what is happening in the story, and what might happen next.', 'cdc-milestones'),
      l('Pretends to be someone else in play, and comforts a friend who is sad.', 'cdc-milestones'),
      see('Names a few colours.', 'Ask the colour, shape and size of things you see during the day.', 'cdc-milestones'),
      l('Catches a large ball most of the time and draws a person with three or more parts.', 'cdc-milestones'),
    ],
    helps: [l('Eat together when you can, and let your child see you enjoy healthy food.', 'cdc-milestones'), l('Name the behaviour you want to see and praise it.', 'cdc-milestones')],
  }),
  month(60, 1200, '5 yr', '5 years old', {
    headline: 'Five years: rules, rhymes, and counting to 10',
    notice: [
      see('By 5 years most children take turns in games, tell a story with two events, and keep a conversation going.', 'Play a simple board game, a card game or Simon Says, to practise following the rules of a game.', 'cdc-milestones'),
      see('Uses or recognizes simple rhymes.', 'Play rhyming games: "What rhymes with cat?"', 'cdc-milestones'),
      l('Counts to 10, writes some letters of their name, and hops on one foot.', 'cdc-milestones'),
    ],
    helps: [l('Let your child "read" by telling the story from the pictures.', 'cdc-milestones'), l('Use the words of time: today, tomorrow, yesterday.', 'cdc-milestones'), l('Eat together, with screens off.', 'cdc-milestones')],
  }),
]

/** Where the guide's ages count from (the due date for a baby born early) and the child's age on it. */
function origin(from: AgeFrom, now: Date): Date {
  return startOfDay(parseDate(normsFrom(from, now)))
}

/** The index of the period the child is in now. Before the due date of a baby born early: the first. */
export function guideIndexFor(from: AgeFrom, now: Date): number {
  const start = origin(from, now)
  const today = startOfDay(now)
  const months = differenceInMonths(today, start)
  if (months < 3) {
    const days = Math.max(0, differenceInCalendarDays(today, start))
    return Math.min(WEEKS - 1, Math.floor(days / 7))
  }
  const i = GUIDE.findIndex((e) => e.unit === 'month' && months >= e.from && months < e.to)
  return i === -1 ? GUIDE.length - 1 : i
}

/** The first day of a period for this child, and its last (null for the open-ended last one). */
export function periodDates(entry: GuideEntry, from: AgeFrom, now: Date): { start: Date; end: Date | null } {
  const start = origin(from, now)
  if (entry.unit === 'week') return { start: addDays(start, entry.from), end: addDays(start, entry.to - 1) }
  return { start: addMonths(start, entry.from), end: entry.to >= 1200 ? null : addDays(addMonths(start, entry.to), -1) }
}

/** "Nov 10 – Nov 16", with the year when it is not this one. */
export function periodText(entry: GuideEntry, from: AgeFrom, now: Date): string {
  const { start, end } = periodDates(entry, from, now)
  const f = (d: Date) => format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')
  return end ? `${f(start)} – ${f(end)}` : `from ${f(start)}`
}

/** The age a period starts at, in months, for picking the CDC lists shown beside it. */
export function periodMonths(entry: GuideEntry): number {
  return entry.unit === 'week' ? (entry.from * 12) / 365.25 : entry.from
}

/** The sources a period's lines rest on, in the order they first appear. */
export function entrySources(entry: GuideEntry): (GuideSource & { id: SourceId })[] {
  const ids: SourceId[] = []
  for (const line of [...entry.notice, ...(entry.normal ?? []), ...notYetFor(entry), ...(entry.care ?? []), ...entry.helps, ...(entry.visit ?? []), ...(entry.you ?? []), ...(entry.call ?? [])]) for (const id of line.src) if (!ids.includes(id)) ids.push(id)
  return ids.map((id) => ({ id, ...GUIDE_SOURCES[id] }))
}
