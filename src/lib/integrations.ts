/**
 * Settings › Integrations: the devices and accounts Bramble reads from, as one row on the Settings page
 * and a list behind it. Each integration says where it stands in one word; this turns the lot into the
 * few words the Settings row shows, so one that needs a person is seen without opening the list.
 */

/** Not asked yet · not connected · connected and working · needs a person (sign in again, a choice, a real problem). */
export type IntegrationState = 'loading' | 'off' | 'on' | 'attention'

export interface IntegrationItem<Id extends string = string> {
  id: Id
  title: string
  /** The integration's own line, as its row in the list shows it. */
  value: string
  state: IntegrationState
}

/** "A", "A and B", "A, B and C". */
export function listed(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The value line of the Settings row: what needs attention first, then what is connected. */
export function integrationsSummary(items: Pick<IntegrationItem, 'title' | 'state'>[]): string {
  const titles = (state: IntegrationState) => items.filter((i) => i.state === state).map((i) => i.title)
  const attention = titles('attention')
  const on = titles('on')
  const parts: string[] = []
  if (attention.length) parts.push(`${listed(attention)} ${attention.length === 1 ? 'needs' : 'need'} attention`)
  if (on.length) parts.push(`${listed(on)} connected`)
  if (parts.length) return parts.join(' · ')
  const all = listed(items.map((i) => i.title))
  return items.some((i) => i.state === 'loading') ? all : `Nothing connected · ${all}`
}
