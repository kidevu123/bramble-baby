export interface Question {
  id: string
  text: string
  help?: string
  type: 'single' | 'multi' | 'time' | 'number'
  options?: { value: string; label: string }[]
  min?: number
  max?: number
}

export const QUESTIONNAIRE: Question[] = [
  {
    id: 'location',
    text: 'Where does your child usually sleep at night?',
    type: 'single',
    options: [
      { value: 'crib-own-room', label: 'Crib in their own room' },
      { value: 'bassinet-parents', label: 'Crib or bassinet in our room' },
      { value: 'co-sleep', label: 'In our bed' },
      { value: 'varies', label: 'It varies' },
    ],
  },
  {
    id: 'fall-asleep',
    text: 'How does your child usually fall asleep?',
    type: 'single',
    options: [
      { value: 'independent', label: 'On their own in the crib' },
      { value: 'fed', label: 'Fed to sleep' },
      { value: 'rocked', label: 'Rocked or held' },
      { value: 'pacifier', label: 'With a pacifier' },
      { value: 'motion', label: 'Stroller or car' },
    ],
  },
  {
    id: 'wakings',
    text: 'How many times do they wake at night?',
    type: 'single',
    options: [
      { value: '0', label: 'Sleeps through' },
      { value: '1-2', label: '1–2 times' },
      { value: '3-4', label: '3–4 times' },
      { value: '5+', label: '5 or more' },
    ],
  },
  {
    id: 'waking-response',
    text: 'What usually happens at a night waking?',
    type: 'multi',
    options: [
      { value: 'feed', label: 'Feed' },
      { value: 'rock', label: 'Rock or hold' },
      { value: 'pacifier', label: 'Replace pacifier' },
      { value: 'bring-to-bed', label: 'Bring into our bed' },
      { value: 'wait', label: 'Wait and see' },
    ],
  },
  {
    id: 'nap-trouble',
    text: 'What are naps like?',
    type: 'single',
    options: [
      { value: 'short', label: 'Short (under 45 minutes)' },
      { value: 'fights', label: 'Fights going down' },
      { value: 'on-the-go', label: 'Only on the go' },
      { value: 'fine', label: 'Pretty good' },
    ],
  },
  {
    id: 'routine',
    text: 'Do you have a consistent bedtime routine?',
    type: 'single',
    options: [
      { value: 'yes', label: 'Yes, most nights' },
      { value: 'no', label: 'Not really' },
    ],
  },
  { id: 'bedtime', text: 'Typical bedtime', type: 'time' },
  { id: 'wake-time', text: 'Typical morning wake time', type: 'time' },
  {
    id: 'goal',
    text: "What's your biggest goal?",
    type: 'single',
    options: [
      { value: 'sleep-through', label: 'Sleeping through the night' },
      { value: 'longer-naps', label: 'Longer naps' },
      { value: 'fall-asleep-alone', label: 'Falling asleep on their own' },
      { value: 'gentler-nights', label: 'Gentler, calmer nights' },
      { value: 'predictable', label: 'A predictable schedule' },
    ],
  },
  {
    id: 'method',
    text: 'How do you feel about sleep training methods?',
    help: 'We only suggest formal methods from about 4–6 months, and always with a gentle option.',
    type: 'single',
    options: [
      { value: 'gentle', label: 'Gentle and gradual' },
      { value: 'check-console', label: 'Timed check-ins are fine' },
      { value: 'chair', label: 'Stay in the room and fade out' },
      { value: 'none', label: 'No preference' },
    ],
  },
  {
    id: 'medical',
    text: 'Anything going on right now?',
    type: 'multi',
    options: [
      { value: 'reflux', label: 'Reflux' },
      { value: 'teething', label: 'Teething' },
      { value: 'illness', label: 'Illness or recovering' },
      { value: 'none', label: 'Nothing right now' },
    ],
  },
]

export const SAFETY: string[] = [
  'Always place baby on their back to sleep, on a firm, flat surface.',
  'Keep the sleep space bare: no pillows, blankets, bumpers, or soft toys.',
  'Room-share without bed-sharing for at least the first 6 months.',
  'Keep the room cool (68–72°F / 20–22°C) and avoid overheating.',
  'Check with your pediatrician before making changes if your child has a medical condition or was born early.',
]

export const ENVIRONMENT: string[] = [
  'Make it dark: blackout shades so the room looks the same at 7 PM and 5 AM.',
  'Add steady white noise, about as loud as a shower, running all night.',
  'A cool room and a sleep sack sized for age (no loose blankets).',
  'Keep the crib for sleep only: play and feeds happen elsewhere.',
]

export const METHODS = {
  soothe: {
    name: 'Soothing rhythms',
    description:
      'Under 4 months there is no sleep training, only rhythm-building. Follow wake windows, keep days bright and nights dim, and soothe however works. Feeding to sleep is completely fine right now.',
    nightWakingProtocol: [
      'Respond promptly: feed if hungry, change if wet, then settle with low light and minimal talking.',
      'Try one calm settling attempt in the crib before picking up, but never wait it out at this age.',
      'Keep night feeds boring: dim light, no play, straight back down.',
    ],
  },
  gentle: {
    name: 'Gentle fading',
    description:
      'You stay with your child and slowly do less. Start with what works today (rocking, patting), then step down one notch every 2–3 nights until they fall asleep on their own.',
    nightWakingProtocol: [
      'Wait 1–2 minutes to see if they resettle on their own.',
      'Go in, soothe with your current step (patting, shushing), and stop as soon as calm, not asleep.',
      'Repeat as needed. Each night, use a little less contact than the night before.',
    ],
  },
  'check-console': {
    name: 'Graduated check-ins',
    description:
      'Put your child down awake, leave, and return at growing intervals for brief, calm check-ins (voice and a pat, no picking up). Most families see big improvement within 3–5 nights.',
    nightWakingProtocol: [
      'Night 1: check at 3, 5, then every 10 minutes.',
      'Night 2: check at 5, 10, then every 12 minutes.',
      'Night 3: check at 10, 12, then every 15 minutes.',
      'Keep checks under a minute: "You’re okay, I love you, it’s sleep time."',
    ],
  },
  chair: {
    name: 'Chair method',
    description:
      'Sit in a chair beside the crib while your child falls asleep, offering calm words but not picking up. Every 3 nights move the chair further away until you are outside the door, usually over about 2 weeks.',
    nightWakingProtocol: [
      'Return to your current chair position and settle from there.',
      'Use a consistent phrase and soft touch, then sit back down.',
      'Do not pick up unless truly needed; stay until asleep.',
    ],
  },
} as const

export type MethodKey = keyof typeof METHODS
