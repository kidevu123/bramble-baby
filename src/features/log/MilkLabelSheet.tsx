import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { PillChoice } from '../../components/ui/Field'
import { ValueField } from './LogFields'
import { Sheet } from '../../components/ui/Sheet'
import { useInvalidateMilk, useMilkWindows, usePrinterStatus } from '../../hooks/useMilk'
import { useNow } from '../../hooks/useNow'
import { usePrefs } from '../../hooks/usePrefs'
import { describeApiError } from '../../lib/api/client'
import { companion, type MilkBag, type MilkLocation } from '../../lib/api/companion'
import type { Id } from '../../lib/api/types'
import { canShareFiles, canvasToPng, drawLabel, LABEL_SIZES, labelFilename, labelText, type MilkLabelInput } from '../../lib/labels'
import { bagLeft, bagState, bagVolume, formatTimeLeft, intakeExpiry, intakeProblem, isPartlyUsed, labelAmountIn, LOCATION_LABEL, nextIntakeDraft, toMl, type IntakeDraft } from '../../lib/milk'
import { volumeLabel } from '../../lib/units'
import { formatAgo, parseDate, toIso } from '../../lib/time'
import { labelSize } from '../../lib/labels'
import { LabelSettingsSheet } from '../more/LabelSettingsSheet'
import { MilkIntakeForm } from './MilkIntakeForm'
import { PrintLabelButton } from './PrintLabelButton'
import { SheetFooter } from './SheetFooter'
import './log.css'
import './milk-label.css'

interface Props {
  open: boolean
  input: MilkLabelInput | null
  onClose: () => void
  /** With a child, opening the sheet records the bag in the household stash ("scan in") and prints its QR code. */
  child?: Id | null
  /** The pumping entry this milk came from, so a reprint finds the same bag. */
  pumpingId?: Id | null
  /** Where the milk goes when the bag registers from a pumping session (the pumping sheet's choice); Fridge by default. */
  location?: MilkLocation
  /** Reprint: an existing bag from the stash. */
  bag?: MilkBag | null
  /** The bag was just registered (so a pumping entry saved afterwards can be linked to it). */
  onRegistered?: (bag: MilkBag) => void
  /** The volume was typed in the label sheet; the pumping sheet mirrors it so it is never typed twice. */
  onAmount?: (amount: number) => void
  /**
   * Milk that already exists and has no pumping entry (opened from the Stash tab). The sheet first asks
   * how much, when it was pumped and where it is now, registers the bag on "Add to stash" (never just by
   * opening), then shows the same label and print actions, with "Add another container" for the next one.
   * `input` supplies the name and unit; its `pumpedAt` and `amount` are replaced by what is typed.
   */
  intake?: boolean
}

/** What the label body needs to run one "add milk you already have" visit; see IntakeRounds. */
interface IntakeSession {
  /** The container this round starts from. */
  start: IntakeDraft
  /** `start` is an earlier attempt whose save never came back. */
  restored: boolean
  added: MilkBag[]
  lastAmountText: string | null
  onAttempt: (draft: IntakeDraft) => void
  onSaved: (bag: MilkBag, draft: IntakeDraft) => void
  onAnother: () => void
  onStartFresh: () => void
}

/**
 * A container whose save was sent but never confirmed (connection dropped, sheet closed mid-request), per
 * child. Opening the sheet again starts from it with the same key, so finishing it cannot make a second bag.
 * Module state on purpose: it has to outlive the sheet and the page for as long as the app stays open.
 */
const unconfirmedIntake = new Map<Id, IntakeDraft>()

/** True when the bag the server answered with is the container just submitted, not an earlier save replayed. */
function matchesDraft(bag: MilkBag, draft: IntakeDraft, unit: MilkLabelInput['unit']): boolean {
  const sameVolume = Math.abs(bag.volume_ml - toMl(Number(draft.amountText), unit)) < 0.01
  const sameTime = Math.abs(parseDate(bag.pumped_at).getTime() - draft.pumpedAt.getTime()) < 1000
  return sameVolume && sameTime && bag.thawed === draft.thawed
}

/**
 * Preview + hand-off of a breast-milk storage label. Prints straight from the server when a label
 * printer is attached there (no phone app); otherwise the PNG leaves the app through the share sheet
 * (printer app), AirPrint, or Photos. iPhone web apps have no Bluetooth, so that is the whole menu.
 */
export function MilkLabelSheet({ open, input, onClose, child = null, pumpingId = null, location = 'fridge', bag = null, onRegistered, onAmount, intake = false }: Props) {
  const adding = intake && child !== null
  return (
    <Sheet open={open && input !== null} title={adding ? 'Add milk you already have' : 'Milk label'} onClose={onClose}>
      {!input ? null : adding ? (
        <IntakeRounds input={input} child={child} />
      ) : (
        <LabelBody input={input} child={child} pumpingId={pumpingId} place={location} existing={bag} onRegistered={onRegistered} onAmount={onAmount} intake={null} />
      )}
    </Sheet>
  )
}

/**
 * One visit to "add milk you already have": container after container, each its own round of the label
 * body (own bag, code and label). The next round keeps when it was pumped and where it is kept.
 */
function IntakeRounds({ input, child }: { input: MilkLabelInput; child: Id }) {
  const [round, setRound] = useState(0)
  const [start, setStart] = useState<IntakeDraft>(() => unconfirmedIntake.get(child) ?? nextIntakeDraft(new Date()))
  const [restored, setRestored] = useState(() => unconfirmedIntake.has(child))
  const [added, setAdded] = useState<MilkBag[]>([])
  const [last, setLast] = useState<IntakeDraft | null>(null)
  const begin = (draft: IntakeDraft) => {
    unconfirmedIntake.delete(child)
    setStart(draft)
    setRestored(false)
    setRound((r) => r + 1)
  }
  const session: IntakeSession = {
    start,
    restored,
    added,
    lastAmountText: last?.amountText ?? null,
    onAttempt: (draft) => unconfirmedIntake.set(child, draft),
    onSaved: (bag, draft) => {
      unconfirmedIntake.delete(child)
      setAdded((list) => (list.some((b) => b.id === bag.id) ? list : [...list, bag]))
      setLast(draft)
    },
    onAnother: () => begin(nextIntakeDraft(new Date(), last)),
    onStartFresh: () => begin(nextIntakeDraft(new Date())),
  }
  return <LabelBody key={round} input={input} child={child} pumpingId={null} existing={null} intake={session} />
}

interface BodyProps {
  input: MilkLabelInput
  child: Id | null
  pumpingId: Id | null
  place?: MilkLocation
  existing: MilkBag | null
  onRegistered?: (bag: MilkBag) => void
  onAmount?: (amount: number) => void
  intake: IntakeSession | null
}

function LabelBody({ input: given, child, pumpingId, place = 'fridge', existing, onRegistered, onAmount, intake }: BodyProps) {
  // The volume is part of the label: without it there is no bag, no QR and no expiry alert, so it is
  // entered right here when the caller did not have it yet (label opened before the pumping volume).
  const [amountText, setAmountText] = useState(() => (given.amount && given.amount > 0 ? String(given.amount) : ''))
  // The volume the bag is registered with: the caller's, or the typed one once "Add to stash" is tapped.
  // Never the live text: a phone types "120" as "1", "12", "120", and the first keystroke used to make the bag.
  const [confirmed, setConfirmed] = useState<number | null>(() => (given.amount && given.amount > 0 ? given.amount : null))
  // Milk that already exists: what the pumping entry would have supplied is typed here instead.
  const [draft, setDraft] = useState<IntakeDraft | null>(intake?.start ?? null)
  const [bag, setBag] = useState<MilkBag | null>(existing)
  // The server answered with a bag saved earlier under this container's key, and it is not what was typed.
  const [replayed, setReplayed] = useState(false)
  const now = useNow(30_000)
  const typed = Number(draft ? draft.amountText : amountText)
  const input: MilkLabelInput = useMemo(() => {
    // The label follows the bag once there is one (moving it out of the freezer makes it a thawed label).
    const thawedAt = bag ? (bag.thawed && bag.thawed_at ? parseDate(bag.thawed_at) : null) : draft?.thawed ? draft.thawedAt : null
    // Before the bag exists the label follows the form; afterwards it prints what the stash holds, so a
    // sticker never carries one volume beside the QR code of a bag registered with another.
    if (bag) return { ...given, pumpedAt: parseDate(bag.pumped_at), amount: labelAmountIn(bag, given.unit), thawedAt }
    if (!draft) return { ...given, amount: typed > 0 ? typed : null, thawedAt }
    return { ...given, pumpedAt: draft.pumpedAt, amount: typed > 0 ? typed : null, thawedAt }
  }, [given, typed, draft, bag])
  const { prefs } = usePrefs()
  const labels = prefs.labels
  const windows = useMilkWindows()
  const invalidateMilk = useInvalidateMilk()
  const printer = usePrinterStatus()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Settings open nested over the label (same sheet as Settings › Milk labels & printer); closing returns here.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [png, setPng] = useState<{ url: string; blob: Blob } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shareable = useMemo(() => canShareFiles(), [])
  // With a child in play, a label is only printable once its bag exists: no volume → no bag → no label.
  const canPrint = png !== null && (!child || bag !== null)
  // The pumping sheet's fields moved away from the bag (a corrected volume or start): the label still prints
  // the bag, and saving the entry is what corrects it.
  const formAhead =
    intake === null && bag !== null && confirmed !== null && (Math.abs(toMl(confirmed, given.unit) - bag.volume_ml) >= 0.5 || Math.abs(given.pumpedAt.getTime() - parseDate(bag.pumped_at).getTime()) >= 60_000)

  // Scan in: the bag exists in the stash from the moment the label is made, whether or not it prints.
  // This is the one place a bag is created. From a pumping session it runs as soon as the volume is known;
  // for milk that already exists it runs on "Add to stash" with the container the owner described (`saving`).
  const register = useMutation({
    mutationFn: (saving: IntakeDraft | undefined) =>
      companion.milk.create(
        saving
          ? {
              child: child!,
              pumped_at: toIso(saving.pumpedAt),
              volume_ml: toMl(Number(saving.amountText), given.unit),
              location: saving.location,
              thawed: saving.thawed,
              thawed_at: saving.thawed && saving.thawedAt ? toIso(saving.thawedAt) : undefined,
              client_key: saving.key,
              notes: given.notes ?? '',
              windows,
            }
          : {
              child: child!,
              pumped_at: toIso(input.pumpedAt),
              volume_ml: toMl(confirmed!, input.unit),
              location: place,
              pumping_id: pumpingId,
              notes: input.notes ?? '',
              windows,
            },
      ),
    onSuccess: (created, saving) => {
      setBag(created)
      onRegistered?.(created)
      if (child) invalidateMilk(child)
      if (saving) {
        setReplayed(!matchesDraft(created, saving, given.unit))
        intake?.onSaved(created, saving)
      }
    },
  })
  const registered = useRef(false)
  useEffect(() => {
    if (intake || registered.current || bag || !child || !confirmed || confirmed <= 0) return
    registered.current = true
    onAmount?.(confirmed)
    register.mutate(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child, confirmed, bag])
  /** The volume typed in this sheet is final: the bag registers with it and the pumping sheet mirrors it. */
  function confirmAmount() {
    if (typed > 0 && confirmed === null) setConfirmed(typed)
  }

  const problem = draft ? intakeProblem(draft, now) : null
  function addToStash() {
    if (!intake || !draft || bag || register.isPending || intakeProblem(draft, new Date())) return
    intake.onAttempt(draft) // remembered until the server confirms, so a retry reuses this container's key
    register.mutate(draft)
  }

  const move = useMutation({
    mutationFn: (location: MilkLocation) => companion.milk.update(bag!.id, { location, windows }),
    onSuccess: (next) => {
      setBag(next)
      if (child) invalidateMilk(child)
    },
  })

  const drawn: MilkLabelInput = useMemo(() => ({ ...input, code: bag?.code ?? input.code ?? null }), [input, bag?.code])
  const text = labelText(drawn, labels)

  // Re-render the PNG whenever the label content or layout prefs change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let objectUrl: string | null = null
    setError(null)
    const render = async () => {
      try {
        await Promise.all([document.fonts?.load?.("800 32px 'Nunito'"), document.fonts?.load?.("900 32px 'Fraunces'")])
      } catch {
        /* font loading is best-effort */
      }
      if (cancelled) return
      if (!drawLabel(canvas, drawn, labels)) {
        setError('This browser cannot draw the label image.')
        return
      }
      try {
        const blob = await canvasToPng(canvas)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPng({ url: objectUrl, blob })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not render the label.')
      }
    }
    void render()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [drawn, labels])

  async function share() {
    if (!canPrint || !png) return
    setStatus(null)
    setError(null)
    const file = new File([png.blob], labelFilename(input), { type: 'image/png' })
    try {
      await navigator.share({ files: [file], title: 'Milk label', text })
      setStatus('Sent to the share sheet. Pick your printer app.')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError('Sharing failed here. Try Save image, then print from your printer app.')
    }
  }

  function save() {
    if (!canPrint || !png) return
    const a = document.createElement('a')
    a.href = png.url
    a.download = labelFilename(input)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setStatus('Saved. On iPhone, long-press the image to save it to Photos, then print it from your printer app.')
  }

  function airprint() {
    if (!canPrint || !png) return
    const size = LABEL_SIZES.find((s) => s.id === labels.size) ?? LABEL_SIZES[0]
    const w = window.open('', '_blank')
    if (!w) {
      setError('Pop-ups are blocked. Use Share or Save image instead.')
      return
    }
    w.document.write(
      `<!doctype html><html><head><title>Milk label</title><style>@page{size:${size.w}mm ${size.h}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${size.w}mm;height:${size.h}mm}</style></head><body><img src="${png.url}" alt="Milk label"></body></html>`,
    )
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Label text copied.')
    } catch {
      setError('Could not copy. Select the text below instead.')
    }
  }

  const serverPrinter = printer.data?.configured ? printer.data : null
  // Adding milk that already exists: the form comes first; the bag card and print actions follow once it is saved.
  const entering = intake !== null && draft !== null && bag === null
  const bagExpired = bag !== null && bagState(bag, now) === 'expired'
  const expiry = entering ? intakeExpiry(draft, windows) : null
  const wouldBeExpired = expiry !== null && expiry.getTime() <= now.getTime()
  // Said next to the button, where it cannot scroll out of sight: why it is off, or that this milk is expired.
  const timeProblem = entering ? intakeProblem({ ...draft, amountText: '1' }, now) : null
  const footerNote = register.isError
    ? `Could not add this container: ${describeApiError(register.error)}`
    : (timeProblem ?? (wouldBeExpired ? 'This milk has already expired. Best to throw it out. If you add it anyway, it is marked expired in the stash.' : null))
  // Once the container is saved its label is the thing to look at: back to the top of the sheet.
  const rootRef = useRef<HTMLDivElement>(null)
  const justSaved = intake !== null && bag !== null
  useEffect(() => {
    if (justSaved) rootRef.current?.closest('.sheet-body')?.scrollTo({ top: 0 })
  }, [justSaved])

  return (
    <>
    <div ref={rootRef} className="stack milk-label">
      {entering ? (
        <MilkIntakeForm
          draft={draft}
          onChange={setDraft}
          unit={given.unit}
          windows={windows}
          now={now}
          added={intake.added}
          lastAmountText={intake.lastAmountText}
          restored={intake.restored}
          onStartFresh={intake.onStartFresh}
          disabled={register.isPending}
        />
      ) : null}

      <div className="label-preview card">
        <canvas ref={canvasRef} className="label-canvas" aria-label="Label preview" />
      </div>
      {/* The preview is drawn at the label's own proportions; its size is named on the settings row below. */}
      {entering ? (
        <p className="xs muted" style={{ textAlign: 'center', margin: 0 }}>
          The label this container gets.
        </p>
      ) : null}

      {child && !entering ? (
        <section className="card card-pad stack stash-card">
          {bag ? (
            <>
              <p className="small">
                <span className="strong">Bag {bag.code}</span> is in the stash{isPartlyUsed(bag) ? <> · <span className="strong">{bagLeft(bag, given.unit)} left</span></> : null} · {LOCATION_LABEL[bag.location]}
                {bag.thawed ? ', thawed' : ''}{' '}
                {bagExpired ? (
                  <span className="text-health strong">· expired {formatAgo(bag.expires_at, now)}</span>
                ) : (
                  <>
                    until {format(parseDate(bag.expires_at), 'EEE MMM d, h:mm a')} · <span className="strong">{formatTimeLeft(parseDate(bag.expires_at).getTime() - now.getTime())}</span>
                  </>
                )}
              </p>
              {formAhead ? (
                <p className="intake-note small" role="status">
                  This label prints what bag {bag.code} holds: {bagVolume(bag, given.unit)}, pumped {format(parseDate(bag.pumped_at), 'h:mm a')}. Save the pumping entry and the bag follows it ({confirmed} {volumeLabel(given.unit)}, pumped {format(given.pumpedAt, 'h:mm a')}); then print the label again.
                </p>
              ) : null}
              {replayed ? (
                <p className="intake-note small" role="status">
                  This container was already saved earlier, with the details shown here, so nothing new was added. For a different container, tap Add another container.
                </p>
              ) : null}
              <PillChoice tone="teal" value={bag.location} onChange={(v) => move.mutate(v as MilkLocation)} options={[{ value: 'fridge', label: 'Fridge' }, { value: 'freezer', label: 'Freezer' }, { value: 'room', label: 'Room temp' }]} />
              {bagExpired ? (
                <p className="log-error" role="alert">
                  This milk is past its storage window. It stays in the stash marked expired until you discard it there.
                </p>
              ) : null}
              {move.isError ? (
                <p className="log-error" role="alert">
                  {describeApiError(move.error)}
                </p>
              ) : null}
            </>
          ) : register.isError ? (
            <>
              <p className="log-error" role="alert">
                Could not add this bag to the stash: {describeApiError(register.error)}
              </p>
              <Button variant="secondary" onClick={() => register.mutate(undefined)}>
                Try again
              </Button>
            </>
          ) : confirmed === null ? (
            <>
              <p className="small muted">How much is in this bag? The volume goes on the label, the bag joins the stash and gets its QR code.</p>
              <ValueField
                label="Volume"
                unit={volumeLabel(given.unit)}
                name={`Volume in ${volumeLabel(given.unit)}`}
                type="number"
                inputMode="decimal"
                step="0.25"
                min={0}
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmAmount()}
                placeholder="0"
                data-autofocus=""
              />
              <Button variant="secondary" block onClick={confirmAmount} disabled={!(typed > 0)}>
                Add to stash
              </Button>
            </>
          ) : (
            <p className="small muted">Adding to the stash…</p>
          )}
        </section>
      ) : null}

      {error ? (
        <p className="log-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? <p className="small text-pumping label-status">{status}</p> : null}

      {entering ? null : (
        <div className="stack label-actions">
          {serverPrinter ? (
            <PrintLabelButton png={png?.blob ?? null} canPrint={canPrint} bagCode={bag?.code ?? null} />
          ) : shareable ? (
            <Button size="lg" block onClick={share} disabled={!canPrint}>
              Share to printer app
            </Button>
          ) : null}
          <div className="row">
            {serverPrinter && shareable ? (
              <Button variant="secondary" block onClick={share} disabled={!canPrint}>
                Share
              </Button>
            ) : (
              <Button variant="secondary" block onClick={airprint} disabled={!canPrint}>
                AirPrint
              </Button>
            )}
            <Button variant="secondary" block onClick={save} disabled={!canPrint}>
              Save image
            </Button>
          </div>
          {child && !bag ? (
            <p className="xs muted" style={{ textAlign: 'center', margin: 0 }} role="status">
              {confirmed ? 'Adding the bag to the stash…' : 'Printing starts once the bag is in the stash: enter the volume above and tap Add to stash.'}
            </p>
          ) : null}
          <p className="xs muted" style={{ textAlign: 'center', margin: 0 }}>
            {serverPrinter ? `Print goes straight to the label printer connected to the Bramble server. ` : shareable ? 'Share sends the image to your printer’s app. AirPrint needs an AirPrint label printer. ' : 'AirPrint needs an AirPrint label printer. '}
            Save puts it in Photos.
          </p>
          <Button variant="ghost" onClick={copy} disabled={!canPrint}>
            Copy as text
          </Button>
        </div>
      )}

      <button type="button" className="label-settings-link" onClick={() => setSettingsOpen(true)}>
        <span className="strong">Milk labels &amp; printer</span>
        <span className="xs muted">
          {labelSize(labels.size).label} · {labels.showStorage ? 'use-by dates' : 'no use-by dates'} · {labels.bothUnits ? 'oz + mL' : 'one unit'} · printer
        </span>
      </button>
      <LabelSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
      {/* Direct children of the sheet body, like every other sheet's sticky Save footer. */}
      {entering ? (
        <SheetFooter
          label={wouldBeExpired ? 'Add it anyway' : 'Add to stash'}
          onSave={addToStash}
          busy={register.isPending}
          disabled={problem !== null}
          error={footerNote}
        />
      ) : intake ? (
        <div className="sheet-save">
          <Button variant="secondary" size="lg" block onClick={intake.onAnother}>
            Add another container
          </Button>
        </div>
      ) : null}
    </>
  )
}
