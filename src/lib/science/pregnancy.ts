export interface GestationInfo {
  trimester: 1 | 2 | 3
  babySize: string
  highlights: string[]
}

const SIZES: [number, string][] = [
  [20, 'a banana (about 25 cm, 300 g)'],
  [24, 'an ear of corn (about 30 cm, 600 g)'],
  [28, 'an eggplant (about 37 cm, 1 kg)'],
  [32, 'a squash (about 42 cm, 1.7 kg)'],
  [35, 'a honeydew melon (about 46 cm, 2.4 kg)'],
  [37, 'a head of romaine (about 48 cm, 2.9 kg)'],
  [40, 'a small pumpkin (about 51 cm, 3.4 kg)'],
]

/** Week-by-week highlights condensed from NHS week-by-week and ACOG patient guidance. */
export function gestationInfo(weeks: number): GestationInfo {
  const w = Math.max(0, Math.min(42, Math.floor(weeks)))
  const trimester: 1 | 2 | 3 = w < 14 ? 1 : w < 28 ? 2 : 3
  const babySize = (SIZES.find(([wk]) => w <= wk) ?? SIZES[SIZES.length - 1])[1]
  const highlights: string[] = []
  if (w < 28) highlights.push('Anatomy scan happens around 18–22 weeks; glucose screening around 24–28 weeks.')
  if (w >= 28) highlights.push('Start daily kick counts: you should feel 10 movements within 2 hours, usually much faster.')
  if (w >= 28 && w < 36) highlights.push('Tdap vaccine is recommended between 27 and 36 weeks to protect the newborn from whooping cough.')
  if (w >= 36) highlights.push('Group B strep swab happens at 36–37 weeks. Pack the hospital bag and install the car seat now.')
  if (w >= 37) highlights.push('Full term begins at 37 weeks. Labor signs: regular contractions 5 minutes apart lasting 1 minute for 1 hour (5-1-1), waters breaking, or bleeding.')
  if (w >= 39) highlights.push('39–40 weeks is the sweet spot for birth; your provider will discuss options if you pass 41 weeks.')
  if (w >= 41) highlights.push('Past 41 weeks, expect extra monitoring and a conversation about induction.')
  return { trimester, babySize, highlights }
}

export const KICK_COUNTS = {
  text: 'From 28 weeks, count movements at the same time daily, ideally after a meal: 10 movements within 2 hours is reassuring. Fewer, or a noticeable change in pattern, means call your provider the same day.',
  sources: ['acog-kicks'],
}

export const LABOR_SIGNS: { text: string; sources: string[] }[] = [
  { text: '5-1-1 rule: contractions every 5 minutes, lasting 1 minute, for 1 hour (first babies; 4-1-1 if you have given birth before or live far away).', sources: ['acog-labor'] },
  { text: 'Water breaking, with or without contractions: call, and note the time and color of the fluid.', sources: ['acog-labor'] },
  { text: 'Bright red bleeding, severe constant pain, fewer movements, or a fever: call right away, whatever the timing.', sources: ['acog-labor'] },
  { text: 'Early labor can last many hours: eat lightly, hydrate, rest between contractions, and use the timer here to watch the pattern.', sources: ['acog-labor'] },
]

export const HOSPITAL_BAG: string[] = [
  'ID, insurance card, birth plan, and pediatrician’s name',
  'Phone charger with a long cable',
  'Comfortable robe, nursing bra, slippers, and going-home outfit',
  'Toiletries, lip balm, hair ties',
  'Snacks and a refillable water bottle',
  'Baby: car seat installed, 2 outfits, swaddle, hat, and a going-home outfit',
  'Partner: change of clothes, pillow, snacks',
]
