/** Food catalog for Solids, a picture grid (emoji art, works offline). */
export interface Food {
  id: string
  label: string
  emoji: string
  group: 'fruit' | 'veg' | 'grain' | 'protein' | 'dairy' | 'other'
  /** Common allergen flag: shown with a small badge. */
  allergen?: boolean
  /** Photo under /foods/<id>.jpg (CC0 / public domain, see food-credits.json). Emoji is the fallback. */
  image?: string
}

export const FOODS: Food[] = [
  { id: 'avocado', label: 'avocado', emoji: '🥑', group: 'fruit', image: '/foods/avocado.jpg' },
  { id: 'banana', label: 'banana', emoji: '🍌', group: 'fruit', image: '/foods/banana.jpg' },
  { id: 'apple', label: 'apple', emoji: '🍎', group: 'fruit', image: '/foods/apple.jpg' },
  { id: 'rice-cereal', label: 'rice cereal', emoji: '🍚', group: 'grain', image: '/foods/rice-cereal.jpg' },
  { id: 'sweet-potato', label: 'sweet potato', emoji: '🍠', group: 'veg', image: '/foods/sweet-potato.jpg' },
  { id: 'oatmeal', label: 'oatmeal', emoji: '🥣', group: 'grain', image: '/foods/oatmeal.jpg' },
  { id: 'spinach', label: 'spinach', emoji: '🥬', group: 'veg', image: '/foods/spinach.jpg' },
  { id: 'chicken', label: 'chicken', emoji: '🍗', group: 'protein', image: '/foods/chicken.jpg' },
  { id: 'peas', label: 'peas', emoji: '🫛', group: 'veg', image: '/foods/peas.jpg' },
  { id: 'pear', label: 'pear', emoji: '🍐', group: 'fruit', image: '/foods/pear.jpg' },
  { id: 'yogurt', label: 'yogurt', emoji: '🥛', group: 'dairy', allergen: true, image: '/foods/yogurt.jpg' },
  { id: 'carrot', label: 'carrot', emoji: '🥕', group: 'veg', image: '/foods/carrot.jpg' },
  { id: 'egg', label: 'egg', emoji: '🥚', group: 'protein', allergen: true, image: '/foods/egg.jpg' },
  { id: 'peanut', label: 'peanut butter', emoji: '🥜', group: 'protein', allergen: true, image: '/foods/peanut.jpg' },
  { id: 'blueberry', label: 'blueberries', emoji: '🫐', group: 'fruit', image: '/foods/blueberry.jpg' },
  { id: 'strawberry', label: 'strawberry', emoji: '🍓', group: 'fruit', image: '/foods/strawberry.jpg' },
  { id: 'mango', label: 'mango', emoji: '🥭', group: 'fruit', image: '/foods/mango.jpg' },
  { id: 'peach', label: 'peach', emoji: '🍑', group: 'fruit', image: '/foods/peach.jpg' },
  { id: 'watermelon', label: 'watermelon', emoji: '🍉', group: 'fruit', image: '/foods/watermelon.jpg' },
  { id: 'broccoli', label: 'broccoli', emoji: '🥦', group: 'veg', image: '/foods/broccoli.jpg' },
  { id: 'squash', label: 'squash', emoji: '🎃', group: 'veg', image: '/foods/squash.jpg' },
  { id: 'corn', label: 'corn', emoji: '🌽', group: 'veg', image: '/foods/corn.jpg' },
  { id: 'potato', label: 'potato', emoji: '🥔', group: 'veg', image: '/foods/potato.jpg' },
  { id: 'tomato', label: 'tomato', emoji: '🍅', group: 'veg', image: '/foods/tomato.jpg' },
  { id: 'cucumber', label: 'cucumber', emoji: '🥒', group: 'veg', image: '/foods/cucumber.jpg' },
  { id: 'bread', label: 'toast', emoji: '🍞', group: 'grain', allergen: true, image: '/foods/bread.jpg' },
  { id: 'pasta', label: 'pasta', emoji: '🍝', group: 'grain', allergen: true, image: '/foods/pasta.jpg' },
  { id: 'beans', label: 'beans', emoji: '🫘', group: 'protein', image: '/foods/beans.jpg' },
  { id: 'lentils', label: 'lentils', emoji: '🍲', group: 'protein', image: '/foods/lentils.jpg' },
  { id: 'salmon', label: 'salmon', emoji: '🐟', group: 'protein', allergen: true, image: '/foods/salmon.jpg' },
  { id: 'beef', label: 'beef', emoji: '🥩', group: 'protein', image: '/foods/beef.jpg' },
  { id: 'turkey', label: 'turkey', emoji: '🦃', group: 'protein', image: '/foods/turkey.jpg' },
  { id: 'tofu', label: 'tofu', emoji: '🧈', group: 'protein', allergen: true, image: '/foods/tofu.jpg' },
  { id: 'cheese', label: 'cheese', emoji: '🧀', group: 'dairy', allergen: true, image: '/foods/cheese.jpg' },
  { id: 'puffs', label: 'puffs', emoji: '🍿', group: 'other' },
  { id: 'teether', label: 'teething biscuit', emoji: '🍪', group: 'other', image: '/foods/teether.jpg' },
]

export const FOOD_BY_ID = new Map(FOODS.map((f) => [f.id, f]))
export const FOOD_BY_LABEL = new Map(FOODS.map((f) => [f.label, f]))

export type Reaction = 'loved' | 'ok' | 'disliked' | 'allergic'
export type EatenAmount = 'taste' | 'some' | 'most' | 'all'

export const REACTIONS: { value: Reaction; label: string; emoji: string }[] = [
  { value: 'loved', label: 'Loved it', emoji: '😍' },
  { value: 'ok', label: 'Okay', emoji: '🙂' },
  { value: 'disliked', label: 'Disliked', emoji: '😖' },
  { value: 'allergic', label: 'Reaction', emoji: '⚠️' },
]

export const AMOUNTS: { value: EatenAmount; label: string }[] = [
  { value: 'taste', label: 'Taste' },
  { value: 'some', label: 'Some' },
  { value: 'most', label: 'Most' },
  { value: 'all', label: 'All' },
]

/**
 * Solids are stored as a Baby Buddy Feeding with type "solid food". The notes field carries
 * the foods list plus optional structured hints, e.g. "avocado, banana | loved | most | note".
 */
export function encodeSolidsNotes(foods: string[], reaction: Reaction | null, amount: EatenAmount | null, note: string): string {
  const parts = [foods.join(', ')]
  if (reaction || amount || note.trim()) parts.push(reaction ?? '', amount ?? '', note.trim())
  return parts.join(' | ').replace(/(\s\|\s)+$/, '')
}

export function decodeSolidsNotes(notes: string | null | undefined): { foods: string[]; reaction: Reaction | null; amount: EatenAmount | null; note: string } {
  if (!notes) return { foods: [], reaction: null, amount: null, note: '' }
  const [foodsPart = '', reaction = '', amount = '', ...rest] = notes.split(' | ')
  const foods = foodsPart
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const isReaction = (v: string): v is Reaction => ['loved', 'ok', 'disliked', 'allergic'].includes(v)
  const isAmount = (v: string): v is EatenAmount => ['taste', 'some', 'most', 'all'].includes(v)
  return { foods, reaction: isReaction(reaction) ? reaction : null, amount: isAmount(amount) ? amount : null, note: rest.join(' | ').trim() }
}

/** Foods tried so far (from feeding notes), most recent first, unique. */
export function foodsTried(notesList: (string | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of notesList) {
    for (const f of decodeSolidsNotes(n).foods) {
      if (!seen.has(f)) {
        seen.add(f)
        out.push(f)
      }
    }
  }
  return out
}
