export type Id = number

export interface Child {
  id: Id
  first_name: string
  last_name: string
  birth_date: string
  birth_time: string | null
  slug: string
  picture: string | null
}

export interface Sleep {
  id: Id
  child: Id
  start: string
  end: string
  duration: string
  nap: boolean
  notes: string | null
  tags: string[]
}

export type FeedingType = 'breast milk' | 'formula' | 'fortified breast milk' | 'solid food'
export type FeedingMethod =
  | 'bottle'
  | 'left breast'
  | 'right breast'
  | 'both breasts'
  | 'parent fed'
  | 'self fed'

export interface Feeding {
  id: Id
  child: Id
  start: string
  end: string
  duration: string
  type: FeedingType
  method: FeedingMethod
  amount: number | null
  notes: string | null
  tags: string[]
}

export type DiaperColor = '' | 'black' | 'brown' | 'green' | 'yellow'

export interface DiaperChange {
  id: Id
  child: Id
  time: string
  wet: boolean
  solid: boolean
  color: DiaperColor
  amount: number | null
  notes: string | null
  tags: string[]
}

export interface Pumping {
  id: Id
  child: Id
  start: string
  end: string
  duration: string
  amount: number | null
  notes: string | null
  tags: string[]
}

export interface TummyTime {
  id: Id
  child: Id
  start: string
  end: string
  duration: string
  milestone: string
  tags: string[]
}

export interface Temperature {
  id: Id
  child: Id
  temperature: number
  time: string
  notes: string | null
  tags: string[]
}

export interface Measurement {
  id: Id
  child: Id
  date: string
  notes: string | null
  tags: string[]
}

export interface Weight extends Measurement {
  weight: number
}
export interface Height extends Measurement {
  height: number
}
export interface HeadCircumference extends Measurement {
  head_circumference: number
}
export type GrowthEntry = Weight | Height | HeadCircumference
export type GrowthKind = 'weight' | 'height' | 'head'

export interface Note {
  id: Id
  child: Id
  note: string
  image: string | null
  time: string
  tags: string[]
}

export interface Medication {
  id: Id
  child: Id
  name: string
  dosage: number
  dosage_unit: string
  time: string
  next_dose_interval: string | null
  next_dose_time: string | null
  notes: string | null
  tags: string[]
}

export interface Timer {
  id: Id
  child: Id | null
  name: string | null
  start: string
  duration: string
  user: Id
}

export interface Profile {
  user: { id: Id; username: string; first_name: string; last_name: string; email: string; is_staff: boolean }
  language: string
  timezone: string
  api_key: string
}

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export type EventKind =
  | 'contractions'
  | 'sleep'
  | 'nursing'
  | 'bottle'
  | 'feeding'
  | 'solids'
  | 'diaper'
  | 'potty'
  | 'pumping'
  | 'milestones'
  | 'medicine'
  | 'activity'
  | 'tummy'
  | 'growth'
  | 'temperature'
  | 'note'
