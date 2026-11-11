/**
 * What's new: the release notes a phone shows once after it updates, in the family's words. Every user-visible
 * release adds an entry here (newest first) with the version in package.json. The phone keeps the last version it
 * showed (`bramble.whats-new-seen`).
 * Write `{name}` for the child (other families run their own copy), never a real name.
 */
export interface Release {
  version: string
  date: string
  items: string[]
}

export const RELEASES: Release[] = [
  {
    version: '1.66.0',
    date: 'Nov 11',
    items: ['Nothing new in this copy: 1.66.0 adds to an integration the public release does not include.'],
  },
  {
    version: '1.65.0',
    date: 'Nov 11',
    items: [
      'A note the morning each new week of {name}’s age begins (each month later on): what to look for at that age. A tap opens What to expect. Settings › Notifications › What to expect turns it off.',
      'Opening Bramble now clears its old notifications from the lock screen, a new one sweeps away those from more than half a day ago, and the Inbox has a Clear for what was sent.',
    ],
  },
  {
    version: '1.64.0',
    date: 'Nov 11',
    items: ['Nothing new in this copy: 1.64.0 adds to an integration the public release does not include.'],
  },
  {
    version: '1.63.0',
    date: 'Nov 11',
    items: [
      'What to expect now says what is too early to expect at {name}’s age, the way a pediatrician would: at two months, no tooth yet (4 to 7 months), no solid food (about 6 months), no rolling or laughing yet. Each line moves on once it is due.',
      'And what is normal even if it worries you: eyes that cross now and then, a smile for you and a stare for strangers, baby acne, a brick-red stain in a newborn’s diaper.',
      'All of it from pages of the AAP, CDC and the NHS, named under “Where this comes from”.',
    ],
  },
  {
    version: '1.62.0',
    date: 'Nov 11',
    items: [
      'Child tab › What to expect now says what to look for at {name}’s age and how to see it: under each thing, something to try. At two months, for instance: hold a rattle off to one side, shake it, and see if {name} looks for the noise.',
      'Every one of those comes from a page of the AAP, CDC or the NHS, named under “Where this comes from”. From 4 months it also lists what the AAP says to tell the pediatrician about.',
      'Add milestone no longer offers a first tooth, first solids, crawling or potty training to a baby months away from them. They appear under “Other firsts” from the age they start to happen.',
    ],
  },
  {
    version: '1.61.0',
    date: 'Nov 11',
    items: ['Nothing new in this copy: 1.61.0 adds to an integration the public release does not include.'],
  },
  {
    version: '1.60.0',
    date: 'Nov 11',
    items: ['Nothing new in this copy: 1.60.0 adds to an integration the public release does not include.'],
  },
  {
    version: '1.59.0',
    date: 'Nov 10',
    items: [
      'Settings › Integrations: the Hatch scale now lives behind one Integrations row, where other devices will join it.',
      'The row says what is connected, and names one that needs you (a sign-in that ended, a choice to make) without opening the list.',
    ],
  },
  {
    version: '1.58.0',
    date: 'Nov 10',
    items: ['Nothing new in this copy: 1.58.0 adds an integration the public release does not include.'],
  },
  {
    version: '1.57.0',
    date: 'Nov 10',
    items: [
      'Child tab › What to expect: a guide to {name}’s age, week by week for the first three months and month by month after. What you may notice, feeding and sleep, what helps, the check-up that is due, and when to call the doctor.',
      'Browse any week or month, back or ahead. Every line comes from the American Academy of Pediatrics, the NHS or CDC, and each period lists its sources.',
      'The milestone checklist moved in with it: mark what you have seen right under the week it belongs to. Reports › Milestones keeps the list of what was logged.',
    ],
  },
  {
    version: '1.56.0',
    date: 'Nov 10',
    items: [
      'Reports › Milestones is now the CDC checklist for {name}’s age: what most children do by 2, 4, 6, 9 months and on to 5 years. Tap an item when you see it; the list keeps the date.',
      'It says how much of the list is seen, when the next one starts, and when the pediatrician is due to run a screening. An item that stays unmarked is something to mention at the next visit.',
      'After a NICU stay of 5 days or more it reminds you of the hearing test due by 9 months.',
      'The milestone sheet on Home offers the same list, and milestones you already logged count.',
    ],
  },
  {
    version: '1.55.2',
    date: 'Nov 8',
    items: [
      'Nothing new in this copy: 1.55.2 changes an integration the public release does not include.',
    ],
  },
  {
    version: '1.55.1',
    date: 'Nov 8',
    items: [
      'Nursing logged after the fact works again: type the minutes and the feed ends just now, with Save live (it used to say the feed would end in the future until Just now was tapped).',
      'Saving a nursing feed or a formula bottle no longer ends on "Cannot reach the server" with the sheet left open (the entry was saved all along; the sheet now closes).',
    ],
  },
  {
    version: '1.55.0',
    date: 'Nov 4',
    items: [
      'Settings › Weighing: the weight of a dry diaper. A weighing taken with a diaper on (the doctor\u2019s scale) gets a Diaper on switch in the weight sheet, and {name}\u2019s naked weight is what gets saved; the entry says what was taken off.',
      'Only a dry diaper can be taken off: a wet one weighs more than a day\u2019s growth, so ask for a naked weight or a fresh diaper at the office.',
      'Type it understands "weight 5 lb 7 oz with diaper".',
    ],
  },
  {
    version: '1.54.1',
    date: 'Nov 3',
    items: [
      'Fixed: Print or PDF did nothing on the phone (an app on the Home Screen has no print dialog). The report page now has Save PDF: the page is drawn in the app and opens in the share sheet, where you can print it, AirDrop or mail it, or save it to Files.',
    ],
  },
  {
    version: '1.54.0',
    date: 'Nov 3',
    items: [
      'The pediatrician report is one printable page from the last visit to this one: type the two dates on the report page and it remembers them.',
      'It shows {name}\u2019s weight as a chart against the doctor\u2019s goal and the WHO curves, the gain since the last visit in grams a day, bottles a day as a chart, feeds, diapers and sleep with what is typical, the weeks side by side, and any fevers or medicines.',
      'Reports › Summary › Overview › Report for the pediatrician, then Print or PDF.',
    ],
  },
  {
    version: '1.53.3',
    date: 'Nov 3',
    items: [
      'Fixed: the Bobbie spoon measures were too big. The app counted a level teaspoon of Bobbie as 1.9 g; Bobbie\u2019s own spec sheet says 2.49 g. So "½ teaspoon" for 60 mL at 22 kcal/oz was really ⅜ (a third), and ½ made about 22.8 kcal/oz. If you mixed by the spoon, your bottles were a little stronger than 22, not weaker.',
      'Fortify recipes now lead with the grams for a kitchen scale, which are exact. Spoons are a second, rounded measure (to the nearest level ⅛ teaspoon, as measuring sets have) and the chart says how far they can land from the strength.',
      'A spoon and its grams are no longer written as if they were the same amount.',
    ],
  },
  {
    version: '1.53.2',
    date: 'Oct 28',
    items: [
      'The fortify recipe left the Stash tab. It now sits folded at the bottom of Make premade bottles and of a fortified bottle: tap "Recipe chart" to open it.',
    ],
  },
  {
    version: '1.53.1',
    date: 'Oct 28',
    items: [
      'Settings › Calories & fortifying shows the recipe chart for your formula and strength.',
      'Fixed: with the keyboard up, the bottle sheet could not scroll down to the time and Save.',
    ],
  },
  {
    version: '1.53.0',
    date: 'Oct 28',
    items: [
      'The fortifying recipe names your formula and gives the grams beside the spoons, for a kitchen scale.',
      'Logging a fortified bottle you mixed yourself says how much powder goes into that amount.',
    ],
  },
  {
    version: '1.52.0',
    date: 'Oct 28',
    items: [
      'Calories are now a switch in Settings › Calories & fortifying, off unless you need them.',
      "With it on, Reports › Day shows the day's total calories, and formula bottles count at the strength you mix them (Bobbie is in the list of powders).",
    ],
  },
  {
    version: '1.51.0',
    date: 'Oct 28',
    items: [
      "Calories: Reports › Feeding shows the calories a day and per kg against the doctor's goal (Settings › Calories & fortifying).",
      'Fortified milk: set the strength, and the Stash tab gives the formula to add for any amount; premade bottles can be made fortified and keep 24 hours.',
      "Fortified bottles keep the strength they were mixed at, so {name}'s calories stay right if the recipe changes.",
    ],
  },
  {
    version: '1.50.0',
    date: 'Oct 28',
    items: ['Moving a bag into the freezer prints its label again, and thawing one prints a new THAWED label with the right use-by times. Turn it off in Settings › Milk labels & printer.'],
  },
  {
    version: '1.49.1',
    date: 'Oct 28',
    items: ['Housekeeping for the public release of Bramble\'s code. Nothing changes in how the app works, and your settings carry over.'],
  },
  {
    version: '1.49.0',
    date: 'Oct 27',
    items: [
      'Times in notifications are in your own time zone. On a server set to another zone, "Last session 6:30 PM" could arrive for a 2:30 PM pump. Settings › Notifications shows the zone.',
      'A session logged late says its day ("at 6:30 PM Monday"), and pings held up while the server could not reach Baby Buddy are no longer sent all at once.',
      'Milk taken out of the fridge onto the counter is counted from when it came out, and says so in its reminder.',
    ],
  },
  {
    version: '1.48.0',
    date: 'Oct 23',
    items: ['Stash › Premade bottles has a small Rearrange link: tap a bottle, then the spot it moved to. A bottle already there swaps places.'],
  },
  {
    version: '1.47.0',
    date: 'Oct 23',
    items: ['The nap prediction on Home (the lime pill) is now called Nap window. It works the same, and its settings on the Child tab are kept.'],
  },
  {
    version: '1.46.0',
    date: 'Oct 23',
    items: [
      'While {name} is in the NICU, the Stash is about what goes in: Take to the NICU moves the bags you bring in out of the home stash in one tap, and the card shows what went in this week.',
      'Milk from the first five days is marked Colostrum on the bag and on the sticker, so it goes first.',
    ],
  },
  {
    version: '1.45.0',
    date: 'Oct 23',
    items: [
      'Settings › Born early: for a baby born before 37 weeks, set the weeks at birth and the NICU stay. Everything already logged is read again with them.',
      'In the NICU, Bramble shows what you log without comparing it to age norms, and the feed and diaper reminders stay quiet. Pump reminders keep going.',
      'Reports › Pumping shows sessions a day against 8 (one at night) and volume against what NICU lactation teams aim for.',
      'After the due date, age norms and growth percentiles use corrected age.',
    ],
  },
  {
    version: '1.44.0',
    date: 'Oct 23',
    items: ['Tap any bar on a Reports chart to see its value and day (and what it is made of, like wet and poo diapers). Tap away to close it.'],
  },
  {
    version: '1.43.0',
    date: 'Oct 23',
    items: [
      'Reports › Feeding: the tiles put Bottle / day right beside what {name}’s weight suggests, with the amount a feed under Feeds / day.',
      'Reports › Diapers leads with how the wet diapers compare to what is typical.',
    ],
  },
  {
    version: '1.42.1',
    date: 'Oct 23',
    items: ['Stash has a small key above the list: what each colour and symbol means (teal snowflake = Freezer, sun = day milk, moon = night milk).'],
  },
  {
    version: '1.42.0',
    date: 'Oct 22',
    items: ['This “What’s new” card. It shows once after each update; Settings › What’s new has it again.'],
  },
  {
    version: '1.41.1',
    date: 'Oct 22',
    items: ['The grandparents’ screen has a way out: tap “Signed in as …” at the bottom, then Sign out.'],
  },
  {
    version: '1.41.0',
    date: 'Oct 22',
    items: ['Grandparents say whether {name} finished the bottle, and how much was left. Your timeline shows “Bottle · finished” or “Bottle · not finished”.'],
  },
  {
    version: '1.40.0',
    date: 'Oct 22',
    items: [
      'A simple screen for grandparents: big Bottle and Diaper buttons, the time is always now, and every save can be taken back.',
      'Grandma and Grandpa get it by themselves. Change it in Settings › People.',
    ],
  },
  {
    version: '1.39.4',
    date: 'Oct 22',
    items: [
      'Stash: the freezer shows only the next bag to thaw; the rest fold under “Show more”.',
      'A premade bottle you have not fed can be undone: its milk goes back on its bags.',
      'Reports › Growth: each weighing is checked against the one before it, the growth chart by age like the doctor’s card (with Zoom in), and how much to feed for her weight.',
      'Night bottles are now called premade bottles.',
    ],
  },
  {
    version: '1.38.1',
    date: 'Oct 21',
    items: ['Your pumps are back in the pump list after the update that hid them.', 'Report cards keep their explanations folded under “About this chart”.'],
  },
  {
    version: '1.37.0',
    date: 'Oct 21',
    items: ['Type a weight in pounds and ounces, the way the hospital writes it.'],
  },
]

/** -1, 0 or 1 for two "1.2.3" versions; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * The releases a phone has not been shown, newest first: those after `seen` up to this build. Signing in records
 * the build a phone starts from (`startWhatsNewAt`), so a phone with no record was signed in before this card
 * existed: it gets the last few, not the whole history. A phone many releases behind gets at most `MAX_SHOWN`.
 */
export function unseenReleases(seen: string | null, current: string, releases: Release[] = RELEASES): Release[] {
  const upTo = releasesUpTo(current, releases)
  if (!seen) return upTo.slice(0, FIRST_SHOWN)
  return upTo.filter((r) => compareVersions(r.version, seen) > 0).slice(0, MAX_SHOWN)
}

/** Releases shown to a phone with no record, and the most shown at once. */
export const FIRST_SHOWN = 4
export const MAX_SHOWN = 6

/** Every release up to this build, newest first (Settings › What's new). */
export function releasesUpTo(current: string, releases: Release[] = RELEASES): Release[] {
  return releases.filter((r) => compareVersions(r.version, current) <= 0)
}

const KEY = 'bramble.whats-new-seen'

export function readSeen(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeSeen(version: string) {
  try {
    localStorage.setItem(KEY, version)
  } catch {
    // Private mode: it shows again next launch, which is harmless.
  }
}

/** An item with `{name}` filled in with the child's first name ("the baby" when there is none). */
export function itemText(item: string, name: string | undefined): string {
  return item.split('{name}').join(name || 'the baby')
}

/** At sign-in: a phone with no record starts from this build (a new caregiver is not shown the history). */
export function startWhatsNewAt(version: string) {
  if (!readSeen()) writeSeen(version)
}
