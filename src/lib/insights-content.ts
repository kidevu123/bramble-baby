export type InsightCategory = 'sleep' | 'feeding' | 'development' | 'diaper' | 'health' | 'activity' | 'expecting'

export interface Insight {
  id: string
  category: InsightCategory
  badge: 'new' | 'tip' | 'pattern' | 'milestone'
  title: string
  body: string
  steps?: string[]
  source?: string
}

export interface Miniplan {
  id: string
  title: string
  summary: string
  ageMinMonths: number
  ageMaxMonths: number
  category: InsightCategory
  steps: { title: string; detail: string }[]
}

/** Developmental content by age window (months). Windows follow CDC/WHO-style milestone ranges. */
export const DEVELOPMENT: { min: number; max: number; insight: Omit<Insight, 'id'> }[] = [
  { min: 0, max: 1.5, insight: { category: 'development', badge: 'milestone', title: 'What newborns can do', body: 'Newborns see best 8–12 inches away, exactly the distance to your face while feeding. They recognize your voice and calm to your smell.', steps: ['Hold face-to-face and talk softly', 'Offer short tummy time on your chest', 'Expect 16–18 hours of sleep in fragments'] } },
  { min: 1.5, max: 3.5, insight: { category: 'development', badge: 'milestone', title: 'Social smiles are coming', body: 'Around 6–8 weeks most babies start smiling back at you. Cooing follows soon after. Head control improves week by week.', steps: ['Smile and pause so they can answer', 'Tummy time 2–3 times a day, a few minutes each', 'Track a moving toy side to side'] } },
  { min: 3.5, max: 5.5, insight: { category: 'development', badge: 'milestone', title: 'Rolling and reaching', body: 'Between 4 and 6 months babies begin rolling tummy-to-back, reaching for toys, and laughing out loud. Sleep often reorganizes around now (the "4-month regression" is really maturation).', steps: ['Place toys just out of reach during floor time', 'Stop swaddling once rolling starts', 'Keep wake windows around 2–2.5 hours'] } },
  { min: 5.5, max: 7.5, insight: { category: 'development', badge: 'milestone', title: 'Sitting and solids readiness', body: 'Sitting with support, good head control, and interest in your food are the readiness signs for solids, usually right around 6 months.', steps: ['Start with iron-rich foods (fortified cereal, pureed meat, lentils)', 'One new food every 2–3 days', 'Offer common allergens early and often once tolerated'] } },
  { min: 7.5, max: 10, insight: { category: 'development', badge: 'milestone', title: 'On the move', body: 'Crawling, pulling to stand, and the pincer grasp show up between 8 and 10 months. Separation anxiety peaks, which can bring new night wakings.', steps: ['Baby-proof at floor level now', 'Offer soft finger foods to practice pincer grasp', 'Play peekaboo to practice separations'] } },
  { min: 10, max: 13.5, insight: { category: 'development', badge: 'milestone', title: 'First words and first steps', body: 'Around the first birthday: first words ("mama", "dada" with meaning), pointing, and cruising or first steps. Many babies drop to one nap between 13 and 18 months.', steps: ['Name what they point at', 'Read the same books again and again', 'Offer whole milk and a cup at meals from 12 months'] } },
  { min: 13.5, max: 19, insight: { category: 'development', badge: 'milestone', title: 'Walking and words', body: 'By 18 months most toddlers walk well, say 10+ words, scribble, and follow one-step directions. Big feelings arrive too.', steps: ['Narrate feelings: "You are mad the block fell"', 'Offer two choices instead of open questions', 'Keep one solid afternoon nap'] } },
  { min: 19, max: 30, insight: { category: 'development', badge: 'milestone', title: 'Two-word phrases', body: 'By 24 months: two-word phrases ("more milk"), running, kicking a ball, and pretend play. Language explodes this year.', steps: ['Expand what they say: "More milk? Cold milk!"', 'Give simple jobs (carry the spoon)', 'Watch for readiness signs before potty training'] } },
  { min: 30, max: 60, insight: { category: 'development', badge: 'milestone', title: 'Preschool leaps', body: 'Three-year-olds ask "why" nonstop, dress with help, and play with other kids. Naps may fade between 3 and 5.', steps: ['Keep a quiet-time rest even without a nap', 'Hold bedtime steady even when naps drop', 'Read and count everything'] } },
]

export const EXPECTING: Omit<Insight, 'id'>[] = [
  { category: 'expecting', badge: 'tip', title: 'The 5-1-1 rule', body: 'Head to the hospital (or call your provider) when contractions are 5 minutes apart, lasting 1 minute, for 1 hour. Use the Contractions timer here to see the pattern.', steps: ['Time from start of one to start of the next', 'Note how long each lasts', 'Call anytime if water breaks, bleeding, or reduced movement'] },
  { category: 'expecting', badge: 'tip', title: 'Pack the hospital bag', body: 'Have it by the door around 36 weeks.', steps: ['ID, insurance, birth plan, phone charger', 'Comfortable clothes, nursing bra, toiletries', 'Going-home outfit for baby and an installed car seat'] },
  { category: 'expecting', badge: 'tip', title: 'Set up safe sleep now', body: 'Firm, flat mattress with a fitted sheet, in your room but not your bed. Nothing else in the crib. It is easier to set up calmly now than at 3 AM on night one.' },
  { category: 'expecting', badge: 'tip', title: 'Third-trimester sleep', body: 'Sleep on your side (left is ideal) with a pillow between your knees and under your belly. Short naps are fine; your body is practicing for newborn nights.' },
  { category: 'expecting', badge: 'tip', title: 'Line up your caregivers', body: 'Add the other parent, grandparents, or a doula in Baby Buddy so everyone can log from day one. Shared logs make the first weeks calmer.' },
]

export const MINIPLANS: Miniplan[] = [
  {
    id: 'transport-response',
    title: 'How to use the "transport response"',
    summary: 'A 13-minute routine shown to calm crying babies and help them transfer to the crib.',
    ageMinMonths: 0,
    ageMaxMonths: 8,
    category: 'sleep',
    steps: [
      { title: 'Hold your baby close', detail: 'Chest to chest, head supported, no talking.' },
      { title: 'Walk for 5 minutes', detail: 'Steady pace, smooth turns. Most babies stop crying within a minute or two.' },
      { title: 'Sit for 8 minutes', detail: 'Stay seated and still so they move from light to deeper sleep.' },
      { title: 'Transfer gently', detail: 'Lay them down bottom first, then back, then head. Keep a hand on the chest for a few breaths.' },
    ],
  },
  {
    id: 'drowsy-but-awake',
    title: 'Drowsy but awake',
    summary: 'Teach the last step of falling asleep in the crib without a full sleep-training plan.',
    ageMinMonths: 2,
    ageMaxMonths: 8,
    category: 'sleep',
    steps: [
      { title: 'Soothe to calm, not asleep', detail: 'Rock, feed, or shush until eyes are heavy and blinks slow.' },
      { title: 'Lay down and stay', detail: 'Keep a hand on their chest and shush for up to 5 minutes.' },
      { title: 'Rescue if needed', detail: 'If crying escalates, pick up, calm, try once more, then help them all the way to sleep. Tomorrow you try again.' },
      { title: 'Pick one attempt a day', detail: 'The first nap or bedtime is the easiest. Success rate climbs after a week.' },
    ],
  },
  {
    id: 'dropping-a-nap',
    title: 'Dropping a nap',
    summary: 'Signs your child is ready for fewer naps and how to bridge the transition.',
    ageMinMonths: 3,
    ageMaxMonths: 40,
    category: 'sleep',
    steps: [
      { title: 'Look for the signs', detail: 'Refusing the last nap 4+ days out of 7, very short naps, or bedtime pushing past 8 PM for two weeks.' },
      { title: 'Stretch, do not cut', detail: 'Lengthen each wake window by 15 minutes every 2–3 days until the nap falls away naturally.' },
      { title: 'Move bedtime earlier', detail: 'During the transition, an earlier bedtime (30–45 minutes) prevents overtiredness.' },
      { title: 'Expect 2–4 weeks', detail: 'Alternate between the old and new schedules on rough days. It settles.' },
    ],
  },
  {
    id: 'starting-solids',
    title: 'Starting solids',
    summary: 'Readiness signs, first foods, and how to introduce allergens.',
    ageMinMonths: 4,
    ageMaxMonths: 9,
    category: 'feeding',
    steps: [
      { title: 'Check readiness (about 6 months)', detail: 'Sits with minimal support, good head control, reaches for food, lost the tongue-thrust reflex.' },
      { title: 'Start with iron', detail: 'Iron-fortified cereal, pureed meats, beans, or lentils. Once a day after a milk feed.' },
      { title: 'One new food every 2–3 days', detail: 'Log it in Solids so reactions are easy to trace.' },
      { title: 'Introduce allergens early', detail: 'Peanut (thinned), egg, dairy, wheat, soy, fish, sesame, tree nuts: small amounts, one at a time, in the morning, and keep offering.' },
    ],
  },
  {
    id: 'bottle-refusal',
    title: 'Bottle refusal',
    summary: 'For breastfed babies who will not take a bottle from anyone.',
    ageMinMonths: 1,
    ageMaxMonths: 12,
    category: 'feeding',
    steps: [
      { title: 'Someone else offers', detail: 'Baby smells milk on the nursing parent. Have another caregiver try while the nursing parent leaves the room.' },
      { title: 'Not too hungry, not full', detail: 'Try 30–60 minutes after a feed when calm. Desperate hunger makes refusal worse.' },
      { title: 'Change one variable', detail: 'Nipple flow, milk temperature, position (facing out, moving), or offering while drowsy.' },
      { title: 'Offer daily, briefly', detail: '5 minutes a day, no pressure. Consistency beats intensity.' },
    ],
  },
  {
    id: 'early-morning-waking',
    title: 'Early morning waking',
    summary: 'For wake-ups before 6 AM that are hard to resettle.',
    ageMinMonths: 4,
    ageMaxMonths: 48,
    category: 'sleep',
    steps: [
      { title: 'Treat it as night', detail: 'Before 6:00 AM: no lights, no talking, same night protocol. Anything else rewards the waking.' },
      { title: 'Black out the room', detail: 'Even faint dawn light triggers waking. Tape the edges of shades.' },
      { title: 'Check the first nap', detail: 'A first nap before 8:30 AM often acts as a "night extension" and reinforces the early waking. Push it 15 minutes later every few days.' },
      { title: 'Check bedtime', detail: 'Counter-intuitively, earlier bedtimes often fix early waking if the child is overtired. Try 20 minutes earlier for 5 nights.' },
    ],
  },
  {
    id: 'teething-nights',
    title: 'Teething nights',
    summary: 'Keep the routine while easing discomfort.',
    ageMinMonths: 4,
    ageMaxMonths: 30,
    category: 'health',
    steps: [
      { title: 'Confirm it is teeth', detail: 'Drooling, chewing, red gums, a bump. Teething does not cause fever over 100.4°F or diarrhea; call your provider for those.' },
      { title: 'Comfort before bed', detail: 'Cold teether or washcloth, gum massage, and if your provider agrees, an age-appropriate dose of infant acetaminophen or ibuprofen (6+ months). Log it in Medicine.' },
      { title: 'Respond, then return', detail: 'Extra cuddles are fine for 2–3 nights. Then go back to your usual approach so a new habit does not form.' },
    ],
  },
  {
    id: 'travel-time-zones',
    title: 'Travel and time zones',
    summary: 'Shift the schedule without losing the week.',
    ageMinMonths: 0,
    ageMaxMonths: 60,
    category: 'sleep',
    steps: [
      { title: 'Under 2 hours difference', detail: 'Just switch to local time on arrival.' },
      { title: '3+ hours difference', detail: 'Shift 30–60 minutes a day starting 3 days before, or accept 3–4 days of adjustment on arrival.' },
      { title: 'Use light', detail: 'Bright morning light in the new zone resets the clock fastest. Dark, boring nights.' },
      { title: 'Pack the sleep cues', detail: 'Same sleep sack, white noise app, and a portable blackout shade.' },
    ],
  },
  {
    id: 'daylight-saving',
    title: 'Daylight saving shift',
    summary: 'A one-hour change made painless over four days.',
    ageMinMonths: 0,
    ageMaxMonths: 60,
    category: 'sleep',
    steps: [
      { title: 'Start 4 days before', detail: 'Move naps, meals, and bedtime 15 minutes each day toward the new time.' },
      { title: 'Or split the difference', detail: 'On the day of the change, put them down 30 minutes off; the next day, on the new time.' },
      { title: 'Blackout for spring', detail: 'Lighter evenings and mornings make darkness essential.' },
    ],
  },
  {
    id: 'weaning-night-feeds',
    title: 'Weaning night feeds',
    summary: 'For healthy babies over 6 months, with your provider’s okay.',
    ageMinMonths: 6,
    ageMaxMonths: 18,
    category: 'feeding',
    steps: [
      { title: 'Front-load the day', detail: 'Add a feed or bigger solids in the afternoon and a full feed at bedtime.' },
      { title: 'Shrink one feed at a time', detail: 'Cut 1–2 minutes of nursing or 0.5–1 oz every 2–3 nights.' },
      { title: 'Settle, do not feed', detail: 'Once a feed is under 3 minutes or 1 oz, drop it and use your settling method instead.' },
      { title: 'Keep one, then none', detail: 'Many families keep a single early-morning feed for a while. That is fine.' },
    ],
  },
]
