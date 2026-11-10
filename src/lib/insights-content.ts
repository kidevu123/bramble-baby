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
