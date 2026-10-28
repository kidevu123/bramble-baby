import { useAgeBasis } from '../../hooks/useAgeBasis'
import { judgedAge } from '../../lib/preterm'
import type { Child } from '../../lib/api/types'
import {
  diaperNormFor,
  expectedWeightGain,
  feedingNormFor,
  gestationInfo,
  HOSPITAL_BAG,
  IRON,
  KICK_COUNTS,
  LABOR_SIGNS,
  SAFE_SLEEP,
  SCREEN_TIME,
  sleepNormFor,
  SOLIDS_GUIDANCE,
  SOURCE_BY_ID,
  TUMMY_TIME,
  VITAMIN_D,
} from '../../lib/science'
import { formatDurationShort } from '../../lib/time'
import { usePrefs } from '../../hooks/usePrefs'
import { clockRange, ozRange, ozText } from '../reports/format'
import './insights.css'

function Sources({ ids }: { ids: string[] }) {
  const list = [...new Set(ids)].map((id) => SOURCE_BY_ID.get(id)).filter(Boolean)
  if (!list.length) return null
  return (
    <p className="sci-sources">
      Source{list.length > 1 ? 's' : ''}:{' '}
      {list.map((s, i) => (
        <span key={s!.id}>
          {i ? ' · ' : ''}
          <a href={s!.url} target="_blank" rel="noreferrer">
            {s!.org} ({s!.year})
          </a>
        </span>
      ))}
    </p>
  )
}

function Card({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <article className={`insight card cat-${tone}`}>
      <h3>{title}</h3>
      {children}
    </article>
  )
}

const range = (r: [number, number], unit = '') => (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}–${r[1]}${unit}`)

/** Age-specific, cited pediatric guidance, free. */
export function SciencePanel({ child }: { child: Child }) {
  const ctx = judgedAge(useAgeBasis(child), new Date()) // corrected age for a baby born early
  const { prefs } = usePrefs()
  if (ctx.expecting) {
    const g = gestationInfo(ctx.gestationWeeks ?? 0)
    return (
      <div className="stack">
        <Card title={`Week ${Math.floor(ctx.gestationWeeks ?? 0)} · trimester ${g.trimester}`} tone="expecting">
          <p className="small">Baby is about the size of {g.babySize}.</p>
          <ul className="insight-steps">
            {g.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
          <Sources ids={['nhs-pregnancy-weeks', 'acog-labor']} />
        </Card>
        <Card title="Kick counts" tone="expecting">
          <p className="small">{KICK_COUNTS.text}</p>
          <Sources ids={KICK_COUNTS.sources} />
        </Card>
        <Card title="When to call: labor signs" tone="expecting">
          <ul className="insight-steps">
            {LABOR_SIGNS.map((l, i) => (
              <li key={i}>{l.text}</li>
            ))}
          </ul>
          <Sources ids={LABOR_SIGNS.flatMap((l) => l.sources)} />
        </Card>
        <Card title="Safe sleep, ready before day one" tone="sleep">
          <ul className="insight-steps">
            {SAFE_SLEEP.map((l, i) => (
              <li key={i}>{l.text}</li>
            ))}
          </ul>
          <Sources ids={SAFE_SLEEP.flatMap((l) => l.sources)} />
        </Card>
        <Card title="Hospital bag" tone="expecting">
          <ul className="insight-steps">
            {HOSPITAL_BAG.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Card>
      </div>
    )
  }

  const m = ctx.ageMonths
  const units = prefs.units
  const sleep = sleepNormFor(m)
  const feed = feedingNormFor(m, ctx.dayOfLife)
  const diaper = diaperNormFor(ctx.dayOfLife)
  const gain = expectedWeightGain(m)
  const tummy = [...TUMMY_TIME].reverse().find((t) => m >= t.minMonths) ?? TUMMY_TIME[0]
  const solids = SOLIDS_GUIDANCE.filter((g) => m >= g.minMonths - 1.5)

  return (
    <div className="stack">
      <p className="small muted">Ranges are for {child.first_name}'s age right now. Every number links to its source. Guidance, not diagnosis: your pediatrician knows your baby.</p>

      <Card title="Sleep at this age" tone="sleep">
        <dl className="sci-facts">
          <div>
            <dt>Total per day</dt>
            <dd>{range(sleep.totalHours, 'h')}</dd>
          </div>
          <div>
            <dt>Night</dt>
            <dd>{range(sleep.nightHours, 'h')}</dd>
          </div>
          <div>
            <dt>Naps</dt>
            <dd>
              {range(sleep.napsPerDay)} · {range(sleep.napHours, 'h')}
            </dd>
          </div>
          <div>
            <dt>Wake window</dt>
            <dd>
              {formatDurationShort(sleep.wakeWindowMinutes[0] * 60)}–{formatDurationShort(sleep.wakeWindowMinutes[1] * 60)}
            </dd>
          </div>
          <div>
            <dt>Typical bedtime</dt>
            <dd>
              {clockRange(sleep.typicalBedtime)}
            </dd>
          </div>
        </dl>
        <p className="small">{sleep.notes}</p>
        <Sources ids={sleep.sources} />
      </Card>

      <Card title="Feeding at this age" tone="feeding">
        <dl className="sci-facts">
          <div>
            <dt>Feeds per day</dt>
            <dd>{range(feed.feedsPerDay)}</dd>
          </div>
          {feed.ozPerFeed ? (
            <div>
              <dt>Per bottle</dt>
              <dd>{ozRange(feed.ozPerFeed, units.volume)}</dd>
            </div>
          ) : null}
          {feed.ozPerDay ? (
            <div>
              <dt>Per day</dt>
              <dd>{ozRange(feed.ozPerDay, units.volume)}</dd>
            </div>
          ) : null}
          {feed.nursingMinutesPerSide ? (
            <div>
              <dt>Nursing per side</dt>
              <dd>{range(feed.nursingMinutesPerSide, ' min')}</dd>
            </div>
          ) : null}
          {feed.maxGapHoursDay ? (
            <div>
              <dt>Longest daytime gap</dt>
              <dd>~{feed.maxGapHoursDay}h</dd>
            </div>
          ) : null}
        </dl>
        <p className="small">{ozText(feed.notes, units.volume)}</p>
        <Sources ids={feed.sources} />
      </Card>

      {m < 12 ? (
        <Card title="Diapers at this age" tone="diaper">
          <dl className="sci-facts">
            <div>
              <dt>Wet per day</dt>
              <dd>{range(diaper.wetPerDay)}</dd>
            </div>
            <div>
              <dt>Dirty per day</dt>
              <dd>{range(diaper.dirtyPerDay)}</dd>
            </div>
            <div className="wide">
              <dt>Stool</dt>
              <dd>{diaper.stoolColor}</dd>
            </div>
          </dl>
          <p className="small">{diaper.notes}</p>
          <Sources ids={diaper.sources} />
        </Card>
      ) : null}

      <Card title="Growth" tone="development">
        <p className="small">{gain.text}</p>
        <p className="small">Set boy/girl on the Child tab to see WHO percentiles for every weight, length, and head measurement you log.</p>
        <Sources ids={[...gain.sources, 'who-growth-2006']} />
      </Card>

      {solids.map((g) => (
        <Card key={g.title} title={g.title} tone="feeding">
          <p className="small">{g.body}</p>
          <Sources ids={g.sources} />
        </Card>
      ))}

      {m < 12 ? (
        <Card title="Tummy time" tone="activity">
          <p className="small">
            Aim for {range(tummy.minutesPerDay, ' min')} a day. {tummy.text}
          </p>
          <Sources ids={tummy.sources} />
        </Card>
      ) : null}

      <Card title="Vitamin D and iron" tone="health">
        <p className="small">{VITAMIN_D.text}</p>
        <p className="small">{IRON.text}</p>
        <Sources ids={[...VITAMIN_D.sources, ...IRON.sources]} />
      </Card>

      <Card title="Screens" tone="activity">
        <p className="small">{SCREEN_TIME.text}</p>
        <Sources ids={SCREEN_TIME.sources} />
      </Card>

      {m < 12 ? (
        <Card title="Safe sleep (AAP 2022)" tone="sleep">
          <ul className="insight-steps">
            {SAFE_SLEEP.map((l, i) => (
              <li key={i}>{l.text}</li>
            ))}
          </ul>
          <Sources ids={SAFE_SLEEP.flatMap((l) => l.sources)} />
        </Card>
      ) : null}
    </div>
  )
}
