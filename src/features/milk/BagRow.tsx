import type { ReactElement } from 'react'
import { BottleIcon, DayIcon, FridgeIcon, NightIcon, SnowflakeIcon, ThermoIcon } from '../../components/icons'
import { usePrefs } from '../../hooks/usePrefs'
import type { MilkBag, MilkLocation } from '../../lib/api/companion'
import { milkDaypart } from '../../lib/labels'
import { bagLeft, bagStamp, bagState, formatMl, isNightBottle, isPartlyUsed, LOCATION_LABEL } from '../../lib/milk'
import { STASH_KEY_LABEL, type StashKeyItem } from '../../lib/stash-key'
import { formatAgo, parseDate } from '../../lib/time'
import type { VolumeUnit } from '../../lib/units'
import './milk.css'

const PLACE_ICON: Record<MilkLocation, { tone: string; icon: ReactElement }> = {
  room: { tone: 'tone-feeding', icon: <ThermoIcon /> },
  fridge: { tone: 'tone-pumping', icon: <FridgeIcon /> },
  freezer: { tone: 'tone-sleep', icon: <SnowflakeIcon /> },
}

/**
 * One stash bag, the same on the Stash tab and in the bottle sheet's picker. Two lines and a deadline on the right:
 * the volume and code; the sticker's sun or moon with when it was pumped; "Good until" and the moment (or "Use first"
 * over it on the bag to use first). The place is the icon; the picker also says it in words (`place`), the Stash
 * tab does not (its sections are the places).
 */
export function BagRow({ bag, unit, now, onOpen, disabledWhenExpired = false, picked, useFirst = false, place = true, colostrum = false }: { bag: MilkBag; unit: VolumeUnit; now: Date; onOpen: () => void; disabledWhenExpired?: boolean; /** In a multi-select list: whether this bag is in the bottle (undefined outside one). */ picked?: boolean; /** The usable bag that expires first: tagged "Use first" (Stash tab). */ useFirst?: boolean; /** Say the place in words on the second line. */ place?: boolean; /** Pumped in the first days after the birth (Settings › Born early's NICU stash): tagged, it goes in first. */ colostrum?: boolean }) {
  const { prefs } = usePrefs()
  const state = bagState(bag, now)
  const expires = parseDate(bag.expires_at)
  const pumped = parseDate(bag.pumped_at)
  const expired = state === 'expired'
  // A freezer deadline is months out: the date says enough. Fridge and room deadlines are hours or days: the clock matters.
  // Today is the bare clock ("Good until 4:05 PM"); other days carry a weekday or a date.
  const until = bagStamp(expires, now, { time: bag.location !== 'freezer', today: '' })
  const when = expired ? (disabledWhenExpired ? 'Expired — discard it from the stash' : `Expired ${formatAgo(bag.expires_at, now)}`) : `Good until ${until}`
  const disabled = disabledWhenExpired && expired
  const bottle = isNightBottle(bag)
  // A premade bottle mixes milk from several pumps: no sun or moon, and its name is its spot.
  const part = bottle ? null : milkDaypart(pumped, prefs.labels)
  const where = bottle ? { tone: 'tone-feeding', icon: <BottleIcon /> } : PLACE_ICON[bag.location]
  return (
    <li>
      <button type="button" className={`bag-row state-${state}${picked ? ' is-picked' : ''}`} onClick={onOpen} disabled={disabled} aria-pressed={picked === undefined ? undefined : picked} aria-label={`${bottle ? `Premade bottle ${bag.spot}, ${formatMl(bag.remaining_ml, unit)}` : `Bag ${bag.code}, ${bagLeft(bag, unit)}${isPartlyUsed(bag) ? ' left' : ''}`}, ${LOCATION_LABEL[bag.location]}${bag.thawed ? ', thawed' : ''}${colostrum ? ', colostrum' : ''}${part ? `, ${part} milk` : ''}, ${when}${useFirst ? ', use first' : ''}`}>
        {picked !== undefined ? (
          <span className={`bag-check${picked ? ' on' : ''}`} aria-hidden>
            {picked ? '✓' : ''}
          </span>
        ) : null}
        <span className={`icon-circle sm ${where.tone}`} aria-hidden>
          {where.icon}
        </span>
        <span className="grow bag-main" aria-hidden>
          {bottle ? (
            <span className="bag-vol">
              {formatMl(bag.remaining_ml, unit)} <span className="xs muted">· premade bottle {bag.spot}</span>
            </span>
          ) : (
            <span className="bag-vol">
              {bagLeft(bag, unit)}
              {isPartlyUsed(bag) ? <> <span className="bag-left-tag">left</span></> : null} <span className="xs muted">· {bag.code}</span>
              {colostrum ? <> <span className="bag-colostrum-tag">Colostrum</span></> : null}
            </span>
          )}
          <span className="xs muted bag-pumped">
            {part ? <span className={`bag-part is-${part}`}>{part === 'night' ? <NightIcon /> : <DayIcon />}</span> : null}
            <span>
              {bottle ? 'Oldest milk' : 'Pumped'} {bagStamp(pumped, now, { today: '' })}
              {place ? ` · ${LOCATION_LABEL[bag.location]}` : ''}
              {bag.thawed ? ' · thawed' : ''}
            </span>
          </span>
        </span>
        <span className="bag-due" aria-hidden>
          {useFirst && !expired ? <span className="bag-first-tag">Use first</span> : <span className="xs muted">{expired ? 'Expired' : 'Good until'}</span>}
          <span className={`xs bag-when ${expired ? 'text-health' : state === 'soon' ? 'text-pumping' : ''}`}>{expired ? (disabledWhenExpired ? 'discard it' : formatAgo(bag.expires_at, now)) : until}</span>
        </span>
      </button>
    </li>
  )
}

/**
 * What the symbols on the rows mean, drawn exactly as the rows draw them: the place in its coloured circle, the
 * premade bottle, the sun or moon. Only what the list is showing (`stashKeyItems`).
 */
export function StashKey({ items }: { items: StashKeyItem[] }) {
  if (!items.length) return null
  // Two lines when both are there: where the milk is, then when it was pumped.
  const groups = [items.filter((i) => i !== 'day' && i !== 'night'), items.filter((i) => i === 'day' || i === 'night')].filter((g) => g.length)
  return (
    <div className="stash-key" role="group" aria-label="Key" data-testid="stash-key">
      {groups.map((group) => (
        <ul key={group[0]} className="stash-key-line">
          {group.map((item) => (
            <li key={item} className={`stash-key-item is-${item}`}>
              {item === 'day' || item === 'night' ? (
                <span className={`bag-part is-${item}`} aria-hidden>
                  {item === 'night' ? <NightIcon /> : <DayIcon />}
                </span>
              ) : (
                <span className={`icon-circle stash-key-dot ${item === 'bottle' ? 'tone-feeding' : PLACE_ICON[item].tone}`} aria-hidden>
                  {item === 'bottle' ? <BottleIcon /> : PLACE_ICON[item].icon}
                </span>
              )}
              <span>{STASH_KEY_LABEL[item]}</span>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}
