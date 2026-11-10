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
  /** What you may notice. */
  notice: GuideLine[]
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

/** Weeks 0 to 12 end where "3 months" begins. */
export const WEEKS = 13

export const GUIDE: GuideEntry[] = [
  week(0, {
    headline: 'Feeding, sleeping, and finding each other',
    notice: [
      l('Loses some weight in the first days, then gains steadily from about day 5.', 'aap-first-month'),
      l('Sees best 8 to 12 inches away: about the distance to your face during a feed.', 'aap-vision'),
      l('Moves by reflex: turns toward the nipple, grips your finger, startles.', 'aap-move-0-3'),
      l('First stools are black or dark green, then turn yellow-green.', 'aap-diapers'),
      l('Skin can turn yellow in the first few days (jaundice); most of it needs no treatment.', 'aap-jaundice'),
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
    ],
  }),
  week(1, {
    headline: 'Back toward birth weight',
    notice: [
      l('Back to birth weight by about 2 weeks; almost all babies are by 3 weeks.', 'aap-first-month', 'nhs-weight'),
      l('A growth spurt is typical around 7 to 10 days. Feeds can bunch together, as often as every hour (cluster feeding).', 'aap-first-month', 'cdc-bf'),
      l('The cord stump dries and falls off between 1 and 3 weeks.', 'aap-first-month'),
      l('Hands stay in tight fists and arm movements are jerky.', 'aap-1mo'),
      l('Bruising or swelling from the birth is gone by the end of the first week or two.', 'aap-first-month'),
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
      l('Turns the head side to side on the tummy; it still flops back without your hand.', 'aap-1mo'),
      l('Prefers faces and high-contrast patterns to anything else.', 'aap-1mo'),
      l('About 1 in 5 babies develop colic, usually starting between the second and fourth weeks.', 'aap-colic'),
    ],
    care: [EIGHT_TO_TWELVE, HUNGER],
    helps: [SOOTHE, TAKE_A_BREAK, l('Keep up tummy time, a few minutes at a time, awake and watched.', 'aap-tummy')],
    you: [l('Baby blues tend to pass in a few days or weeks. Feelings that will not lift may be postpartum depression, which about 1 in 8 people who give birth develop: tell your doctor.', 'aap-ppd')],
    call: [FEVER],
  }),
  week(3, {
    headline: 'A growth spurt, and maybe baby acne',
    notice: [
      l('Another growth spurt comes between 3 and 6 weeks.', 'aap-first-month'),
      l('Gains close to an ounce (28 g) a day through the first month.', 'aap-first-month'),
      l('Pimples on the face (baby acne) often appear in the third to fifth week and clear on their own in a few weeks.', 'aap-first-month'),
      l('The cord stump should be off and the navel healed.', 'aap-first-month'),
      l('May look or turn toward familiar sounds and voices.', 'aap-1mo'),
    ],
    care: [EIGHT_TO_TWELVE, l('A breastfed baby can have a pacifier from about 3 to 4 weeks, once feeding is going well.', 'aap-feed')],
    helps: [TALK, SOOTHE, SAFE_SLEEP],
    call: [FEVER, l('A navel that is not healed and dry after 3 weeks.', 'aap-first-month')],
  }),
  week(4, {
    headline: 'One month: more alert, and watching you',
    notice: [
      l('Much more alert and responsive than in the first weeks.', 'aap-1mo'),
      l('Brings the hands within range of the eyes and mouth.', 'aap-1mo'),
      l('Eyes may wander or cross now and then.', 'aap-1mo'),
      l('Recognizes and reacts to loud sounds.', 'aap-1mo'),
      l('Listens when you speak and watches you as you hold them.', 'aap-1mo'),
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
      l('The first real smile often comes around the sixth week.', 'aap-move-0-3'),
      l('Starts to lift the head when lying on the tummy.', 'aap-move-0-3'),
      l('Waves the arms when excited and starts to notice their own hands.', 'aap-move-0-3'),
      l('A growth spurt is possible any time from 3 to 6 weeks.', 'aap-first-month'),
    ],
    care: [EIGHT_TO_TWELVE, HUNGER],
    helps: [SOOTHE, TAKE_A_BREAK, l('Work up to 15 to 30 minutes of tummy time a day by 7 weeks.', 'aap-tummy')],
    call: [FEVER],
  }),
  week(6, {
    headline: 'Crying is at its peak, and it eases from here',
    notice: [
      l('Fussing usually peaks now at about 3 hours a day, then falls to 1 or 2 hours a day by 3 to 4 months.', 'aap-colic'),
      l('Real smiles, in answer to yours.', 'aap-move-0-3', 'aap-social-0-3'),
      l('Holds your gaze for longer and longer.', 'aap-social-0-3'),
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
      l('Starts to answer you with soft coos and gurgles in the second or third month.', 'aap-1-4mo'),
      l('Watches faces intently and follows a moving object with the eyes.', 'aap-1-4mo'),
      l('Holds the head up when on the tummy.', 'cdc-milestones'),
    ],
    care: [l('The time between feeds slowly gets longer: most breastfed babies feed every 2 to 4 hours, formula-fed every 3 to 4.', 'cdc-bf', 'cdc-formula')],
    helps: [l('Tummy time should add up to 15 to 30 minutes a day by now.', 'aap-tummy'), TALK, l('Learn the signs of being full: closing the mouth, turning the head away.', 'cdc-milestones')],
    visit: [l('The 2-month check-up is coming, with the first large round of vaccines.', 'aap-checkups')],
    call: [FEVER],
  }),
  week(8, {
    headline: 'Two months: the first checklist, and the 2-month visit',
    notice: [
      l('By 2 months most babies calm when picked up, look at your face, and smile back.', 'cdc-milestones'),
      l('Makes sounds other than crying, and reacts to loud sounds.', 'cdc-milestones'),
      l('Holds the head up on the tummy, moves both arms and both legs, and opens the hands briefly.', 'cdc-milestones'),
      l('Crying starts to ease after its 6-week peak.', 'aap-colic'),
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
      l('Swipes at things hanging just out of reach.', 'aap-move-0-3'),
      l('The grip turns deliberate: may hold and shake a rattle.', 'aap-move-0-3'),
      l('Bounces when held standing on your lap.', 'aap-move-0-3'),
      l('"Talks" back with coos when you talk.', 'aap-1-4mo'),
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
      l('By 3 months focuses on faces and close objects and follows a moving object with the eyes.', 'aap-vision'),
      l('Becomes intrigued by other children at about 3 or 4 months.', 'aap-social-0-3'),
    ],
    care: [l('Keep the days bright and busy and the nights calm and quiet; it helps your baby tell them apart.', 'aap-sleep')],
    helps: [TALK, l('Colicky crying generally stops by 3 to 4 months.', 'aap-colic'), SAFE_SLEEP],
    call: [FEVER],
  }),
  week(12, {
    headline: 'Three months: rolling is on its way',
    notice: [
      l('Kicks are strong enough that your baby may soon flip from tummy to back; some roll at this age.', 'aap-move-0-3'),
      l('Arm and leg movements are smoother, and the body looks more relaxed.', 'aap-move-0-3'),
      l('Often smiles when they see or hear you.', 'aap-1-4mo'),
      l('Many newborn reflexes have faded as control grows.', 'aap-1-4mo'),
    ],
    care: [l('Regular sleep cycles arrive at about 4 months; until then sleep is still irregular.', 'aap-sleep')],
    helps: [l('Never leave your baby alone on a bed, sofa or changing table: the first roll comes without warning.', 'aap-move-0-3'), TALK, SAFE_SLEEP],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(3, 4, '3 mo', '3 months old', {
    headline: 'Hands, chuckles, and a steady head on the way',
    notice: [
      l('Coming by 4 months: holds the head steady when held, and pushes up onto the forearms on the tummy.', 'cdc-milestones'),
      l('Brings the hands to the mouth and holds a toy you put in the hand.', 'cdc-milestones'),
      l('Chuckles when you try to make them laugh, and coos back when you talk.', 'cdc-milestones'),
      l('By 4 months sees colours and their shades well, and reaches for what is close.', 'aap-vision'),
    ],
    care: [l('Regular sleep cycles arrive at about 4 months.', 'aap-sleep'), l('Solid food is not recommended before 4 months; about 6 months is the time.', 'cdc-solids')],
    helps: [
      l('Lay your baby on the back and move a bright toy slowly side to side and up and down to follow.', 'cdc-milestones'),
      l('Give time on the floor to move, and keep swings, strollers and bouncy seats short.', 'cdc-milestones'),
      l('Let your baby mouth safe things: nothing sharp, hot or small enough to choke on.', 'cdc-milestones'),
    ],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(4, 5, '4 mo', '4 months old', {
    headline: 'Four months: laughing, babbling, reaching',
    notice: [
      l('By 4 months most babies smile to get your attention, chuckle, coo, and turn toward your voice.', 'cdc-milestones'),
      l('Holds the head steady, swings an arm at toys, and pushes up on the forearms.', 'cdc-milestones'),
      l('Babbling starts at about 4 months, with the rise and fall of real speech.', 'aap-lang-4-7'),
      l('Teething typically starts between 4 and 7 months; drooling and wanting to chew are the signs.', 'aap-teething'),
    ],
    care: [l('From 4 months, put your baby down drowsy but awake so they learn to fall asleep in their own bed.', 'aap-sleep'), l('Set steady routines for sleeping and feeding.', 'cdc-milestones')],
    helps: [l('For sore gums, rub them with a clean finger or offer a firm rubber teething ring. No numbing gels, teething tablets or amber necklaces.', 'aap-teething'), TALK],
    visit: [l('The 4-month check-up: growth and development, and the second doses of the 2-month vaccines.', 'aap-checkups')],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(5, 6, '5 mo', '5 months old', {
    headline: 'Getting ready to roll and to sit',
    notice: [
      l('Rocks on the stomach, kicks and "swims" with the arms, usually at about 5 months.', 'aap-move-4-7'),
      l('Rolling both ways and sitting up are the big projects of 4 to 7 months.', 'aap-move-4-7'),
      l('Brings interesting things to the mouth with ease.', 'aap-move-4-7'),
      l('Might repeat one sound for a day or more before trying another.', 'aap-lang-4-7'),
    ],
    care: [l('Signs of being ready for solids: sits with support, controls head and neck, opens the mouth for food, and swallows it instead of pushing it out.', 'cdc-solids')],
    helps: [l('Help your baby practise sitting: hold them up or prop the back with pillows while they find their balance.', 'aap-move-4-7'), l('Put toys just out of reach to encourage rolling.', 'cdc-milestones'), SAFE_SLEEP],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(6, 7, '6 mo', '6 months old', {
    headline: 'Six months: sitting with help, and first foods',
    notice: [
      l('By 6 months most babies know familiar people, laugh, and take turns making sounds with you.', 'cdc-milestones'),
      l('Rolls from tummy to back and leans on the hands to sit.', 'cdc-milestones'),
      l('Reaches for a toy they want and puts things in the mouth to explore.', 'cdc-milestones'),
      l('Most babies start teething at around 6 months, some before 4 months and some after 12.', 'nhs-teething'),
    ],
    care: [
      l('Solid foods can start at about 6 months; breast milk or formula is still the main food.', 'cdc-solids', 'cdc-milestones'),
      l('On formula, 6 to 8 ounces at each of 4 or 5 feeds is typical by 6 months.', 'aap-feed'),
      l('It is normal at 6 months to wake in the night and settle again within a few minutes.', 'aap-sleep'),
    ],
    helps: [l('Ask the doctor about starting solids and which foods are choking risks.', 'cdc-milestones'), l('Point at things and name them: cars, trees, animals.', 'cdc-milestones'), l('Keep your baby’s sleep space in your room, ideally until at least 6 months.', 'cdc-sleep')],
    visit: [l('The 6-month check-up: third doses of the earlier vaccines, and a flu vaccine is recommended from 6 months.', 'aap-checkups')],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(7, 8, '7 mo', '7 months old', {
    headline: 'Copying sounds, and on the move soon',
    notice: [
      l('From 6 or 7 months your baby actively copies the sounds of speech.', 'aap-lang-4-7'),
      l('Passes things from hand to hand and turns them over, between the sixth and eighth month.', 'aap-move-4-7'),
      l('Crawling is usually mastered between 7 and 10 months. A few children never crawl and scoot or slither instead.', 'aap-move-8-12'),
    ],
    care: [l('By 7 or 8 months your baby can eat a variety of foods from the different food groups.', 'cdc-solids'), l('No cow’s milk as a drink before 12 months; yogurt without added sugar is fine.', 'cdc-solids')],
    helps: [l('Answer the babble: repeat the sounds back and wait for a reply.', 'aap-lang-8-12'), l('Clear the floor of anything small enough to choke on.', 'aap-move-4-7')],
    call: [l('No babbling or copying of sounds by the seventh month: tell the doctor, who may check the hearing.', 'aap-lang-4-7'), FEVER_LATER],
  }),
  month(8, 9, '8 mo', '8 months old', {
    headline: 'Wary of strangers, and clingy with you',
    notice: [
      l('Fear of strangers is one of the first emotional milestones: a baby who was easy with everyone now tenses up.', 'aap-social-8-12'),
      l('Becomes clingy about you leaving. This is the start of separation anxiety.', 'aap-social-8-12'),
      l('Much more mobile from about 8 months.', 'aap-move-8-12'),
      l('May rock on hands and knees, or even push backward, before crawling forward.', 'aap-move-8-12'),
    ],
    care: [l('Most 6 to 12 month olds need formula or solid food about 5 to 6 times in 24 hours.', 'cdc-formula')],
    helps: [
      l('Leave after a nap and a meal: babies take separation harder when tired, hungry or sick.', 'aap-social-8-12'),
      l('Practise short separations at home, and say where you are going and that you will be back.', 'aap-social-8-12'),
      l('Put an interesting toy just out of reach to encourage crawling.', 'aap-move-8-12'),
    ],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(9, 10, '9 mo', '9 months old', {
    headline: 'Nine months: sitting alone, and a screening visit',
    notice: [
      l('By 9 months most babies sit without support and get to sitting by themselves.', 'cdc-milestones'),
      l('Makes strings of sounds like "mamamama" and "babababa", and lifts the arms to be picked up.', 'cdc-milestones'),
      l('Looks when you call their name and looks for a toy dropped out of sight.', 'cdc-milestones'),
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
      l('Pulls up to standing at every chance, and at first may not know how to get down.', 'aap-move-8-12'),
      l('Separation anxiety usually peaks between 10 and 18 months.', 'aap-social-8-12'),
    ],
    helps: [l('Ask questions and wait for an answer; repeat your baby’s sounds back.', 'aap-lang-8-12'), l('Build a small obstacle course of pillows and cushions, and stay close.', 'aap-move-8-12')],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(11, 12, '11 mo', '11 months old', {
    headline: 'Understanding more than they can say',
    notice: [
      l('Understands far more than they can say: watch them look at a favourite toy when you name it.', 'aap-lang-8-12'),
      l('Shows what they want by pointing, crawling or gesturing toward it.', 'aap-lang-8-12'),
      l('A first "word" is any sound used the same way for the same thing.', 'aap-lang-8-12'),
      l('Most babies take their first real steps at about a year.', 'aap-move-0-3'),
    ],
    helps: [l('Treat the made-up word as a word, and say the real one back.', 'aap-lang-8-12'), l('Baby-proof where your child explores, and lock away medicines and cleaning products.', 'cdc-milestones')],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(12, 15, '1 yr', '1 year old', {
    headline: 'One year: standing, cruising, first words',
    notice: [
      l('By 12 months most babies pull up to stand and walk holding on to furniture.', 'cdc-milestones'),
      l('Waves bye-bye, calls a parent "mama" or "dada", and understands "no".', 'cdc-milestones'),
      l('Picks up small things between thumb and finger and puts things in a container.', 'cdc-milestones'),
      l('Separation anxiety usually peaks between 10 and 18 months, then fades in the second half of the second year.', 'aap-social-8-12'),
    ],
    care: [
      l('At 12 months formula can give way to plain whole cow’s milk, a feed at a time.', 'cdc-formula'),
      l('Water, breast milk or plain milk to drink. Juice is not needed; if given, 4 ounces a day at most.', 'cdc-milestones'),
      l('From 12 months children need 600 IU of vitamin D a day.', 'cdc-vitd'),
    ],
    helps: [l('Build on what your child tries to say: for "ta", answer "Yes, a truck".', 'cdc-milestones'), l('Give safe places to explore and keep the Poison Help number handy.', 'cdc-milestones')],
    visit: [l('The 12-month check-up: vaccines for measles, mumps and rubella, hepatitis A and chickenpox may be given, and the doctor checks for anemia.', 'aap-checkups')],
    call: [FEVER_LATER, LOST_SKILL],
  }),
  month(15, 18, '15 mo', '15 months old', {
    headline: 'First steps, first words, and showing you things',
    notice: [
      l('By 15 months most children take a few steps on their own.', 'cdc-milestones'),
      l('Tries one or two words besides "mama" and "dada", and points to ask for something.', 'cdc-milestones'),
      l('Shows you things they like, claps when excited, and shows affection.', 'cdc-milestones'),
    ],
    care: [l('Steady routines for sleeping and eating; a calm bedtime with pyjamas, teeth and a book or two.', 'cdc-milestones'), l('Practise an open cup and a spoon. It is messy.', 'cdc-milestones')],
    helps: [l('Sing songs with gestures and see which actions your child copies.', 'cdc-milestones'), l('Screens are not recommended before 2 years, apart from video calls with family.', 'cdc-milestones')],
    visit: [l('The 15-month check-up: any vaccines still due from the 6- and 12-month visits.', 'aap-checkups')],
    call: [FEVER_LATER],
  }),
  month(18, 24, '18 mo', '18 months old', {
    headline: 'Walking, pointing to share, and a screening visit',
    notice: [
      l('By 18 months most children walk without holding on, scribble, and try a spoon.', 'cdc-milestones'),
      l('Tries three or more words besides "mama" and "dada", and follows a one-step direction.', 'cdc-milestones'),
      l('Points to show you something interesting, and copies you doing chores.', 'cdc-milestones'),
    ],
    care: [l('Sit at the table together for meals and snacks; it sets the routine.', 'cdc-milestones')],
    helps: [l('Offer a choice between two things: the red shirt or the blue one.', 'cdc-milestones'), l('Name body parts as you point to them: "your nose, my nose".', 'cdc-milestones')],
    visit: [l('The 18-month check-up includes developmental and autism screening questionnaires for you to fill in.', 'aap-checkups', 'cdc-milestones')],
    call: [FEVER_LATER],
  }),
  month(24, 30, '2 yr', '2 years old', {
    headline: 'Two years: two words together, running, big feelings',
    notice: [
      l('By 2 years most children say at least two words together, run, and kick a ball.', 'cdc-milestones'),
      l('Notices when others are upset, and looks at your face to see how to react.', 'cdc-milestones'),
      l('Roller-coaster emotions are normal at this age, and a tantrum to get their way is part of it.', 'aap-checkups'),
    ],
    care: [l('Let your child eat as much or as little as they want at each meal.', 'cdc-milestones')],
    helps: [l('Ask the doctor about toilet training to know whether your child is ready.', 'cdc-milestones'), l('Stay close during playdates: children this age play beside each other more than together.', 'cdc-milestones')],
    visit: [l('The 2-year check-up includes an autism screening.', 'aap-checkups', 'cdc-milestones')],
    call: [l('A fever that lasts more than 3 days, or with a child who looks very ill: call the doctor.', 'aap-fever')],
  }),
  month(30, 36, '30 mo', '30 months old', {
    headline: 'About 50 words, pretend play, and "look at me"',
    notice: [
      l('By 30 months most children say about 50 words and put two together with an action word.', 'cdc-milestones'),
      l('Plays pretend, follows two-step instructions, and jumps with both feet.', 'cdc-milestones'),
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
      l('By 3 years most children hold a short conversation and ask who, what, where and why.', 'cdc-milestones'),
      l('Joins other children to play, and calms within 10 minutes after you leave.', 'cdc-milestones'),
      l('Draws a circle when shown how, puts on some clothes, and uses a fork.', 'cdc-milestones'),
    ],
    helps: [l('Give instructions with 2 or 3 steps.', 'cdc-milestones'), l('Help your child name feelings and give them ways to calm down.', 'cdc-milestones'), l('Let your child help make meals with simple jobs.', 'cdc-milestones')],
  }),
  month(48, 60, '4 yr', '4 years old', {
    headline: 'Four years: stories, pretend, and helping',
    notice: [
      l('By 4 years most children speak in sentences of four or more words and tell you about their day.', 'cdc-milestones'),
      l('Pretends to be someone else in play, and comforts a friend who is sad.', 'cdc-milestones'),
      l('Catches a large ball most of the time and draws a person with three or more parts.', 'cdc-milestones'),
    ],
    helps: [l('Eat together when you can, and let your child see you enjoy healthy food.', 'cdc-milestones'), l('Name the behaviour you want to see and praise it.', 'cdc-milestones')],
  }),
  month(60, 1200, '5 yr', '5 years old', {
    headline: 'Five years: rules, rhymes, and counting to 10',
    notice: [
      l('By 5 years most children take turns in games, tell a story with two events, and keep a conversation going.', 'cdc-milestones'),
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
  for (const line of [...entry.notice, ...(entry.care ?? []), ...entry.helps, ...(entry.visit ?? []), ...(entry.you ?? []), ...(entry.call ?? [])]) for (const id of line.src) if (!ids.includes(id)) ids.push(id)
  return ids.map((id) => ({ id, ...GUIDE_SOURCES[id] }))
}
