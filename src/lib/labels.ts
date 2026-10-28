/**
 * Breast-milk storage labels for pumped bottles/bags.
 *
 * Storage windows default to CDC guidance for freshly expressed milk (room temperature up to 4 h,
 * refrigerator up to 4 days, freezer best within 6 months, acceptable to 12 months). They are
 * editable in Settings because NICUs and pediatricians sometimes give tighter rules.
 *
 * Labels are rendered to a PNG on a canvas at a thermal-printer resolution (203 dpi) so the same
 * image can be shared to a Bluetooth label printer's app (Niimbot, Phomemo, Brother iPrint&Label…),
 * printed via AirPrint, or saved to Photos.
 */
import { isColostrum } from './nicu-stash'
import { addHours, format } from 'date-fns'
import QRCode from 'qrcode'
import { expectedExpiry, qrPayload, THAWED_HOURS } from './milk'
import { convertVolume, roundTo, type VolumeUnit } from './units'

export type LabelSizeId = '51x38' | '40x30' | '50x30' | '57x32' | '62x29' | '54x25' | '89x36' | '40x60'

export interface LabelSize {
  id: LabelSizeId
  /** Width × height in millimetres, as the label sits in the printer. */
  w: number
  h: number
  label: string
  hint: string
}

export const LABEL_SIZES: LabelSize[] = [
  { id: '51x38', w: 51, h: 38, label: '51 × 38 mm', hint: '2 × 1.5 in · Zebra GK420d and similar' },
  { id: '50x30', w: 50, h: 30, label: '50 × 30 mm', hint: 'Zebra GK420d, Niimbot B21/B1, Phomemo M110/M220' },
  { id: '40x30', w: 40, h: 30, label: '40 × 30 mm', hint: 'Niimbot D110/B21, Phomemo M110' },
  { id: '40x60', w: 40, h: 60, label: '40 × 60 mm', hint: 'tall bag label, Phomemo M110' },
  { id: '62x29', w: 62, h: 29, label: '62 × 29 mm', hint: 'Brother DK-11209 (QL series, AirPrint)' },
  { id: '57x32', w: 57, h: 32, label: '57 × 32 mm', hint: 'DYMO 11354, Zebra' },
  { id: '54x25', w: 54, h: 25, label: '54 × 25 mm', hint: 'DYMO 11352 return address' },
  { id: '89x36', w: 89, h: 36, label: '89 × 36 mm', hint: 'DYMO 99012, Zebra' },
]

export interface LabelPrefs {
  size: LabelSizeId
  /** Hours a freshly pumped bottle may sit at room temperature. */
  roomHours: number
  fridgeDays: number
  freezerMonths: number
  showName: boolean
  showStorage: boolean
  showNotes: boolean
  /** Print the volume in both units (e.g. "4 oz · 120 mL"). */
  bothUnits: boolean
  /**
   * With a printer on the Bramble server: saving a new pumping entry with a volume registers its bag and
   * prints the label at once, no label sheet needed (the sheet stays for a reprint).
   */
  autoPrint: boolean
  /** True once a size was picked in Settings; until then the old default (50 × 30) moves to 51 × 38 by itself. */
  sizeChosen: boolean
  /**
   * A moon on milk pumped at night, a sun on milk pumped by day. Breast milk melatonin is high at night and
   * near zero by day, and its cortisol peaks in the morning (measured, reviewed); whether matching the milk to
   * the time of the feed helps a baby sleep is not established, so the mark only says when it was pumped.
   */
  dayNight: boolean
  /** Whole hours (0–23): the moon from `nightFrom`, the sun again from `nightTo`. */
  nightFrom: number
  nightTo: number
}

export const DEFAULT_LABEL_PREFS: LabelPrefs = {
  size: '51x38',
  roomHours: 4,
  fridgeDays: 4,
  freezerMonths: 6,
  showName: true,
  showStorage: true,
  showNotes: false,
  bothUnits: true,
  autoPrint: true,
  sizeChosen: false,
  dayNight: true,
  // Milk melatonin rises in the evening and is highest in the small hours; cortisol peaks soon after waking.
  nightFrom: 21,
  nightTo: 6,
}

export type MilkDaypart = 'day' | 'night'

/** Day or night milk by the hour it was pumped, or null when the mark is off. */
export function milkDaypart(pumpedAt: Date, prefs: Pick<LabelPrefs, 'dayNight' | 'nightFrom' | 'nightTo'>): MilkDaypart | null {
  if (!prefs.dayNight) return null
  const h = pumpedAt.getHours()
  const from = prefs.nightFrom
  const to = prefs.nightTo
  if (from === to) return 'day'
  const night = from > to ? h >= from || h < to : h >= from && h < to
  return night ? 'night' : 'day'
}

/** "9 PM–6 AM": the night window as the Settings hint and the text label say it. */
export function nightWindowText(prefs: Pick<LabelPrefs, 'nightFrom' | 'nightTo'>): string {
  const h12 = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
  return `${h12(prefs.nightFrom)}–${h12(prefs.nightTo)}`
}

export interface MilkLabelInput {
  childName: string
  /** When the milk was expressed (the pumping session's start). */
  pumpedAt: Date
  amount: number | null
  unit: VolumeUnit
  notes?: string | null
  /** Stash bag code: printed as a QR code (scan out with the phone camera) and as text under it. */
  code?: string | null
  /**
   * Set for milk that was frozen and has thawed. The label then says THAWED MILK and its use-by dates count
   * from the thaw (2 h room, 24 h fridge, do not refreeze) instead of printing fresh-milk windows.
   */
  thawedAt?: Date | null
  /** The child's birth date: milk pumped in the first days after it is colostrum, said on the sticker (NICUs give it first). */
  birthDate?: string | null
}

export interface StorageDeadlines {
  room: Date
  fridge: Date
  freezer: Date
}

/** The use-by moments as the stash and the server's reminders compute them (a month is 30.4375 days), so the
 * sticker never says "good until Sep 1" while the app already says expired. */
export function storageDeadlines(pumpedAt: Date, prefs: Pick<LabelPrefs, 'roomHours' | 'fridgeDays' | 'freezerMonths'>): StorageDeadlines {
  const windows = { roomHours: prefs.roomHours, fridgeDays: prefs.fridgeDays, freezerMonths: prefs.freezerMonths }
  return {
    room: expectedExpiry({ pumpedAt, location: 'room' }, windows),
    fridge: expectedExpiry({ pumpedAt, location: 'fridge' }, windows),
    freezer: expectedExpiry({ pumpedAt, location: 'freezer' }, windows),
  }
}

/** The volume as it prints: the phone's unit as the hero, the other unit smaller beside it (when both are on). */
export function labelVolumeParts(amount: number | null, unit: VolumeUnit, both: boolean): { primary: string; secondary: string | null } {
  if (amount === null || !(amount > 0)) return { primary: `— ${unit === 'oz' ? 'oz' : 'mL'}`, secondary: null }
  const primary = unit === 'oz' ? `${roundTo(amount, 2)} oz` : `${Math.round(amount)} mL`
  if (!both) return { primary, secondary: null }
  const other: VolumeUnit = unit === 'oz' ? 'ml' : 'oz'
  const converted = convertVolume(amount, unit, other)
  return { primary, secondary: other === 'oz' ? `${roundTo(converted, 1)} oz` : `${Math.round(converted)} mL` }
}

export function formatLabelVolume(amount: number | null, unit: VolumeUnit, both: boolean): string {
  if (amount === null || !(amount > 0)) return ''
  const { primary, secondary } = labelVolumeParts(amount, unit, both)
  return secondary ? `${primary} · ${secondary}` : primary
}

/** Use-by times for thawed milk, as printed in the text version: room (time only) and fridge (day and time). */
function thawedDeadlines(thawedAt: Date): [room: string, fridge: string] {
  return [format(addHours(thawedAt, THAWED_HOURS.room), 'h:mm a'), format(addHours(thawedAt, THAWED_HOURS.fridge), 'EEE h:mm a')]
}

export interface LabelLine {
  text: string
  /** Relative weight: 1 = body, 2 = emphasis, 3 = headline. */
  weight: 1 | 2 | 3
}

/** The lines printed on the label, top to bottom, already trimmed to what prefs allow. */
export function labelLines(input: MilkLabelInput, prefs: LabelPrefs): LabelLine[] {
  const size = labelSize(prefs.size)
  // Portrait labels (bag labels) are narrow: split the long lines instead of shrinking them.
  const portrait = size.h > size.w
  const lines: LabelLine[] = []
  const name = input.childName.trim()
  if (prefs.showName && name) lines.push({ text: name, weight: 2 })
  if (portrait) {
    lines.push({ text: format(input.pumpedAt, 'EEE MMM d'), weight: 3 }, { text: format(input.pumpedAt, 'h:mm a'), weight: 3 })
  } else {
    lines.push({ text: format(input.pumpedAt, 'EEE MMM d · h:mm a'), weight: 3 })
  }
  const volume = formatLabelVolume(input.amount, input.unit, prefs.bothUnits)
  if (volume) lines.push({ text: volume, weight: 3 })
  const part = milkDaypart(input.pumpedAt, prefs)
  if (isColostrum(input.pumpedAt, input.birthDate)) lines.push({ text: 'Colostrum', weight: 1 })
  if (part) lines.push({ text: part === 'night' ? 'Night milk' : 'Day milk', weight: 1 })
  if (prefs.showStorage && input.thawedAt) {
    const [room, fridge] = thawedDeadlines(input.thawedAt)
    if (portrait) {
      lines.push({ text: `Thawed · Room ${room}`, weight: 1 }, { text: `Fridge ${fridge}`, weight: 1 })
    } else {
      lines.push({ text: `Thawed · Room ${room} · Fridge ${fridge}`, weight: 1 })
    }
    lines.push({ text: 'Do not refreeze', weight: 1 })
  } else if (prefs.showStorage) {
    const d = storageDeadlines(input.pumpedAt, prefs)
    if (portrait) {
      lines.push({ text: `Room ${format(d.room, 'h:mm a')}`, weight: 1 }, { text: `Fridge ${fridgeUseBy(d.fridge, prefs.fridgeDays)}`, weight: 1 })
    } else {
      lines.push({ text: `Room ${format(d.room, 'h:mm a')} · Fridge ${fridgeUseBy(d.fridge, prefs.fridgeDays)}`, weight: 1 })
    }
    lines.push({ text: `Freezer ${format(d.freezer, 'MMM d, yyyy')}`, weight: 1 })
  }
  const notes = (input.notes ?? '').trim().split('\n')[0]
  if (prefs.showNotes && notes) lines.push({ text: notes, weight: 1 })
  return lines
}

/** Plain-text version for the clipboard / printer apps that only take text. */
export function labelText(input: MilkLabelInput, prefs: LabelPrefs): string {
  return labelLines(input, prefs)
    .map((l) => l.text)
    .join('\n')
}

export function labelSize(id: LabelSizeId): LabelSize {
  return LABEL_SIZES.find((s) => s.id === id) ?? LABEL_SIZES[0]
}

export const LABEL_DPI = 203
const PX_PER_MM = LABEL_DPI / 25.4

export function labelPixelSize(size: LabelSize): { width: number; height: number } {
  return { width: Math.round(size.w * PX_PER_MM), height: Math.round(size.h * PX_PER_MM) }
}

const FONT = "'Nunito', 'Helvetica Neue', Arial, sans-serif"

/** Black-and-white QR modules for a bag code; null when the encoder is unavailable. */
export function qrModules(code: string): { size: number; dark: (row: number, col: number) => boolean } | null {
  try {
    const qr = QRCode.create(qrPayload(code), { errorCorrectionLevel: 'M' })
    const m = qr.modules
    return { size: m.size, dark: (row, col) => Boolean(m.get(row, col)) }
  } catch {
    return null
  }
}

/** A bag code is a version-2 QR (25 modules); the placeholder is laid out for one before the code exists. */
const QR_MODULES_EXPECTED = 25
/** White modules kept around the code on every side (the scanner's quiet zone), inside its frame. */
const QR_QUIET = 4

type Ctx = CanvasRenderingContext2D

/** Draws the modules at `cell` pixels each with the top-left module at (x, y), pixel-aligned for a thermal head. */
function drawQr(ctx: Ctx, qr: NonNullable<ReturnType<typeof qrModules>>, x: number, y: number, cell: number) {
  ctx.fillStyle = '#000000'
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.dark(r, c)) ctx.fillRect(Math.round(x) + c * cell, Math.round(y) + r * cell, cell, cell)
}

/** A text run fitted to a width: shrinks the font, never wraps. Returns the size used. */
function fitText(ctx: Ctx, text: string, weight: number, px: number, maxW: number, minPx = 8, face = FONT): number {
  let size = px
  ctx.font = `${weight} ${size}px ${face}`
  while (size > minPx && ctx.measureText(text).width > maxW) {
    size -= 1
    ctx.font = `${weight} ${size}px ${face}`
  }
  return size
}

/** Height of the glyphs above the baseline, for lines placed by their cap height (the volume). Measured on
 *  the alphabetic baseline whatever the context's current one (with 'top' the ascent is from the em box's
 *  top, near zero, and the digits rose into the caption above them), never less than `floor` of the size. */
function ascentOf(ctx: Ctx, text: string, px: number, floor = 0.72): number {
  const prev = ctx.textBaseline
  ctx.textBaseline = 'alphabetic'
  const a = ctx.measureText(text).actualBoundingBoxAscent
  ctx.textBaseline = prev
  return Math.max(Number.isFinite(a) && a > 0 ? a : 0, px * floor)
}

/** Like fitText for a letter-spaced run: shrinks until the spaced width fits. Returns the size used. */
function fitSpaced(ctx: Ctx, text: string, weight: number, px: number, spacing: number, maxW: number, minPx = 8, face = FONT): number {
  let size = px
  ctx.font = `${weight} ${size}px ${face}`
  while (size > minPx && spacedWidth(ctx, text, size, spacing) > maxW) {
    size -= 1
    ctx.font = `${weight} ${size}px ${face}`
  }
  return size
}

/** Width of a run drawn with `spacing` em of letter-spacing, in the current font. */
function spacedWidth(ctx: Ctx, text: string, px: number, spacing: number): number {
  return ctx.measureText(text).width + Math.max(0, text.length - 1) * px * spacing
}

/** Draws letter-spaced small caps (canvas letterSpacing is too new for every phone): one glyph at a time. */
function drawSpaced(ctx: Ctx, text: string, x: number, y: number, px: number, spacing: number, align: 'left' | 'center' | 'right' = 'left') {
  const w = spacedWidth(ctx, text, px, spacing)
  let cx = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + px * spacing
  }
  ctx.textAlign = prev
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

// ---- Icons: simple shapes that survive a 203 dpi thermal head. Each fills a `size` square at (x, y).
type Icon = 'heart' | 'drop' | 'clock' | 'room' | 'fridge' | 'freezer' | 'thaw' | 'sun' | 'moon'

function drawIcon(ctx: Ctx, icon: Icon, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2.6
  switch (icon) {
    case 'heart':
      ctx.beginPath()
      ctx.moveTo(12, 21)
      ctx.bezierCurveTo(5, 15, 2, 11.5, 2, 7.6)
      ctx.bezierCurveTo(2, 4.6, 4.3, 2.5, 7, 2.5)
      ctx.bezierCurveTo(9.1, 2.5, 10.9, 3.7, 12, 5.5)
      ctx.bezierCurveTo(13.1, 3.7, 14.9, 2.5, 17, 2.5)
      ctx.bezierCurveTo(19.7, 2.5, 22, 4.6, 22, 7.6)
      ctx.bezierCurveTo(22, 11.5, 19, 15, 12, 21)
      ctx.closePath()
      ctx.fill()
      break
    case 'drop':
      ctx.beginPath()
      ctx.moveTo(12, 2.5)
      ctx.bezierCurveTo(12, 2.5, 4.5, 11, 4.5, 15.2)
      ctx.bezierCurveTo(4.5, 19.3, 7.9, 22, 12, 22)
      ctx.bezierCurveTo(16.1, 22, 19.5, 19.3, 19.5, 15.2)
      ctx.bezierCurveTo(19.5, 11, 12, 2.5, 12, 2.5)
      ctx.closePath()
      ctx.fill()
      break
    case 'clock':
      ctx.beginPath()
      ctx.arc(12, 12, 9.3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(12, 6.5)
      ctx.lineTo(12, 12)
      ctx.lineTo(16, 14.5)
      ctx.stroke()
      break
    case 'room': // a thermometer
      ctx.beginPath()
      ctx.moveTo(9.5, 4.5)
      ctx.arcTo(9.5, 2, 12, 2, 2.5)
      ctx.arcTo(14.5, 2, 14.5, 4.5, 2.5)
      ctx.lineTo(14.5, 13.3)
      ctx.arc(12, 16.8, 4.4, -Math.PI / 2 + 0.6, Math.PI * 1.5 - 0.6)
      ctx.closePath()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(12, 16.8, 2.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(12, 8)
      ctx.lineTo(12, 14)
      ctx.stroke()
      break
    case 'fridge':
      roundedRect(ctx, 5, 2.2, 14, 19.6, 2.5)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(5, 9.5)
      ctx.lineTo(19, 9.5)
      ctx.moveTo(8.5, 5)
      ctx.lineTo(8.5, 7)
      ctx.moveTo(8.5, 12.5)
      ctx.lineTo(8.5, 16)
      ctx.stroke()
      break
    case 'freezer': // a snowflake
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 3) * i
        const dx = Math.cos(a) * 9.5
        const dy = Math.sin(a) * 9.5
        ctx.beginPath()
        ctx.moveTo(12 - dx, 12 - dy)
        ctx.lineTo(12 + dx, 12 + dy)
        ctx.stroke()
        for (const sgn of [1, -1]) {
          const tx = 12 + dx * 0.62 * sgn
          const ty = 12 + dy * 0.62 * sgn
          const b = a + (Math.PI / 6) * sgn
          const c = a - (Math.PI / 6) * sgn
          ctx.beginPath()
          ctx.moveTo(tx + Math.cos(b) * 3.2 * sgn, ty + Math.sin(b) * 3.2 * sgn)
          ctx.lineTo(tx, ty)
          ctx.lineTo(tx + Math.cos(c) * 3.2 * sgn, ty + Math.sin(c) * 3.2 * sgn)
          ctx.stroke()
        }
      }
      break
    case 'sun': // a solid disc and eight short rays
      ctx.beginPath()
      ctx.arc(12, 12, 5.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 2.4
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i
        ctx.beginPath()
        ctx.moveTo(12 + Math.cos(a) * 8, 12 + Math.sin(a) * 8)
        ctx.lineTo(12 + Math.cos(a) * 10.8, 12 + Math.sin(a) * 10.8)
        ctx.stroke()
      }
      break
    case 'moon': {
      // A fat crescent opening to the upper right with a five-point star in the opening: a thin crescent alone
      // reads as a "C" at 4 mm on a thermal head. The crescent is the disc minus an offset disc, clipped to the
      // disc (no white paint, so nothing under it is erased).
      ctx.save()
      ctx.beginPath()
      ctx.arc(10.2, 13, 9.6, 0, Math.PI * 2)
      ctx.clip()
      ctx.beginPath()
      ctx.arc(10.2, 13, 9.6, 0, Math.PI * 2)
      ctx.moveTo(16 + 7.6, 8.6)
      ctx.arc(16, 8.6, 7.6, 0, Math.PI * 2, true)
      ctx.fill('evenodd')
      ctx.restore()
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (Math.PI / 5) * i
        const r = i % 2 ? 2.2 : 5.1
        const px = 18.7 + Math.cos(a) * r
        const py = 5.9 + Math.sin(a) * r
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'thaw': // a snowflake crossed out: never refreeze
      drawIcon(ctx, 'freezer', 0, 0, 24, color)
      ctx.lineWidth = 3.2
      ctx.beginPath()
      ctx.moveTo(3.5, 20.5)
      ctx.lineTo(20.5, 3.5)
      ctx.stroke()
      break
  }
  ctx.restore()
}

interface StorageCell {
  icon: Icon
  label: string
  value: string
}

/** The fridge use-by as printed: within a week the weekday and the clock ("Tue 1:00 AM", the moment the stash
 *  and the reminders expire it, never a whole day more), the date beyond that. */
export function fridgeUseBy(fridge: Date, fridgeDays: number): string {
  return fridgeDays < 7 ? format(fridge, 'EEE h:mm a') : format(fridge, 'EEE MMM d')
}

/** The use-by strip: when each place stops being safe, counted from the pump (or the thaw). */
export function storageCells(input: MilkLabelInput, prefs: LabelPrefs): StorageCell[] {
  if (input.thawedAt) {
    return [
      { icon: 'room', label: 'ROOM', value: format(addHours(input.thawedAt, THAWED_HOURS.room), 'EEE h:mm a') },
      { icon: 'fridge', label: 'FRIDGE', value: format(addHours(input.thawedAt, THAWED_HOURS.fridge), 'EEE h:mm a') },
      { icon: 'thaw', label: 'FREEZER', value: 'never refreeze' },
    ]
  }
  const d = storageDeadlines(input.pumpedAt, prefs)
  return [
    { icon: 'room', label: 'ROOM', value: format(d.room, 'EEE h:mm a') },
    { icon: 'fridge', label: 'FRIDGE', value: fridgeUseBy(d.fridge, prefs.fridgeDays) },
    { icon: 'freezer', label: 'FREEZER', value: format(d.freezer, 'MMM d, yyyy') },
  ]
}

/** The display face for the name and the number: a soft serif, loaded with the app's fonts (index.html). */
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"

/** Design dimensions: the 51 × 38 mm label at 203 dpi (408 × 304). Everything scales from here. */
const D = { w: 408, h: 304, margin: 12 }

/**
 * Draws the label onto a canvas, black on white at thermal resolution, like a small piece of
 * packaging rather than a shipping label:
 *
 *   (A)  Ada                                   ID J23PFX    monogram, the name in a serif, the bag code large
 *   ─────────────────────────────────────────────────────     hairline
 *   BREAST MILK                                               tracked small caps
 *
 *   VOLUME                                 ▣▣▣▣▣▣▣
 *   60 mL  2 oz                            ▣  QR  ▣           serif numeral, sans unit
 *   PUMPED · NIGHT                         ▣▣▣▣▣▣▣           (DAY by day; off in Settings)
 *   ☾ Thu Oct 8 · 12:23 AM                                    a moon or a sun before the date
 *   ─────────────────────────────────────────────────────     hairline
 *     🌡 ROOM           ▯ FRIDGE           ❄ FREEZER
 *     Thu 4:23 AM       Mon Oct 12         Apr 8, 2027
 *
 * No frames: one monogram, two hairlines, and air. The design is drawn for 51 × 38 mm; other
 * landscape sizes scale from their height, portrait bag labels stack the QR under the text and the
 * use-by places as rows. Without a bag code the QR area holds a dashed placeholder, so the preview
 * is always the sticker that prints.
 */
export function drawLabel(canvas: HTMLCanvasElement, input: MilkLabelInput, prefs: LabelPrefs): boolean {
  const size = labelSize(prefs.size)
  const { width, height } = labelPixelSize(size)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'

  const portrait = height > width
  const s = portrait ? width / D.w : height / D.h
  const px = (v: number) => Math.round(v * s)
  const m = px(D.margin)
  const left = m
  const right = width - m
  const code = input.code?.trim().toUpperCase() || null
  const qr = code ? qrModules(code) : null
  const hair = Math.max(1, px(1.5))

  // ---- content
  const name = prefs.showName ? input.childName.trim() : ''
  const colostrum = isColostrum(input.pumpedAt, input.birthDate)
  const kind = input.thawedAt ? (colostrum ? 'THAWED COLOSTRUM' : 'THAWED MILK') : colostrum ? 'COLOSTRUM' : 'BREAST MILK'
  const volume = labelVolumeParts(input.amount, input.unit, prefs.bothUnits)
  const pumped = format(input.pumpedAt, 'EEE MMM d · h:mm a')
  const part = milkDaypart(input.pumpedAt, prefs)
  const cells = prefs.showStorage ? storageCells(input, prefs) : []
  const notes = prefs.showNotes && input.notes?.trim() ? input.notes.trim().split('\n')[0] : ''

  // ---- header: monogram and the name
  const mono = px(36)
  let y = m
  ctx.beginPath()
  ctx.arc(left + mono / 2, y + mono / 2, mono / 2, 0, Math.PI * 2)
  ctx.fill()
  if (name) {
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 ${px(22)}px ${SERIF}`
    ctx.fillText(name.charAt(0).toUpperCase(), left + mono / 2, y + mono / 2 + px(1))
    ctx.fillStyle = '#000000'
  } else {
    drawIcon(ctx, 'heart', left + mono * 0.25, y + mono * 0.27, mono * 0.5, '#ffffff')
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // The bag code, large at the right: it is typed and looked up more than anything else here.
  const codeText = code ?? '······'
  const codePx = px(22)
  const idPx = px(10)
  ctx.font = `800 ${codePx}px ${FONT}`
  const codeW = spacedWidth(ctx, codeText, codePx, 0.12)
  ctx.font = `700 ${idPx}px ${FONT}`
  const idW = spacedWidth(ctx, 'ID', idPx, 0.16) + px(6)
  const baseline = y + mono / 2 + px(8)
  drawSpaced(ctx, 'ID', right - codeW - idW, baseline, idPx, 0.16)
  ctx.font = `800 ${codePx}px ${FONT}`
  drawSpaced(ctx, codeText, right - codeW, baseline, codePx, 0.12)
  const nameX = left + mono + px(12)
  const nameText = name || 'Breast milk'
  const namePx = fitSpaced(ctx, nameText, 900, px(36), 0.02, right - codeW - idW - px(14) - nameX, px(14), SERIF)
  ctx.font = `900 ${namePx}px ${SERIF}`
  drawSpaced(ctx, nameText, nameX, y + mono / 2 + Math.round(ascentOf(ctx, nameText, namePx) / 2), namePx, 0.02)
  y += mono + px(6)
  ctx.fillRect(left, y, right - left, hair)
  const headRule = y + hair
  y += hair + px(6)
  ctx.textBaseline = 'top'
  const kindPx = px(10.5)
  ctx.font = `700 ${kindPx}px ${FONT}`
  drawSpaced(ctx, kind, left, y, kindPx, 0.24)
  if (notes) {
    ctx.font = `600 ${kindPx}px ${FONT}`
    const notePx = fitText(ctx, notes, 600, kindPx, right - left - spacedWidth(ctx, kind, kindPx, 0.24) - px(16), px(8))
    ctx.font = `600 ${notePx}px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(notes, right, y)
    ctx.textAlign = 'left'
  }
  y += kindPx + px(8)

  // ---- body: text column, QR on the right (landscape) or below (portrait)
  // One module more than the earlier designs: the code fills the right of the body (white space there
  // was the owner's note), kept at least three modules clear of the hairlines above and below it.
  const cell = Math.max(2, Math.floor(5 * s + 0.2))
  const modules = qr?.size ?? QR_MODULES_EXPECTED
  const qrCode = modules * cell
  const qrBox = qrCode + QR_QUIET * cell * 2
  const qrBlockH = qrBox
  const stripH = cells.length ? (portrait ? px(30) * cells.length + px(8) : px(66)) : 0
  const bodyTop = y
  const bodyBottom = height - m - stripH - (cells.length ? hair + px(8) : 0)
  const colW = portrait ? right - left : right - left - qrCode - px(12)
  /** Draws the code with its top-left module at (x, top); the caller leaves the white around it. */
  const drawQrCode = (x: number, top: number) => {
    if (qr) drawQr(ctx, qr, x, top, cell)
    else {
      ctx.save()
      ctx.setLineDash([px(6), px(4)])
      ctx.lineWidth = Math.max(1.5, px(2))
      ctx.strokeRect(x, top, qrCode, qrCode)
      ctx.restore()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `800 ${px(22)}px ${FONT}`
      ctx.fillText('QR', x + qrCode / 2, top + qrCode / 2 - px(6))
      ctx.font = `600 ${px(9)}px ${FONT}`
      ctx.fillText('prints with the bag', x + qrCode / 2, top + qrCode / 2 + px(12))
      ctx.textAlign = 'left'
    }
  }
  if (!portrait) {
    // Between the hairlines, centred, never closer than three modules to either.
    const clear = 3 * cell
    const lo = headRule + clear
    const hi = bodyBottom + px(8) - clear - qrCode
    const centred = Math.round((headRule + bodyBottom + px(8) - qrCode) / 2)
    drawQrCode(right - qrCode, Math.max(lo, Math.min(centred, hi)))
  }

  // The column: VOLUME caption, the number in the serif with its unit in the sans, PUMPED caption, the date.
  const capPx = px(10)
  const unitPx = px(28)
  const subPx = px(19)
  const datePx = px(24)
  ctx.font = `800 ${unitPx}px ${FONT}`
  const [num, unit] = splitVolume(volume.primary)
  const unitW = ctx.measureText(unit).width + px(6)
  ctx.font = `600 ${subPx}px ${FONT}`
  const subW = volume.secondary ? ctx.measureText(volume.secondary).width + px(10) : 0
  // No volume yet: a light dash on the digits' baseline where the number goes, in the space a number takes.
  const placeholder = !(input.amount !== null && input.amount > 0)
  const numPx = fitText(ctx, placeholder ? '000' : num, 900, px(80), colW - unitW - subW, px(20), SERIF)
  // Placed by the height of the digits themselves (not of the text, so the dash does not move the layout);
  // Fraunces 900 lining figures stand about 0.74 em, the floor if the measure is not to be trusted.
  const numAscent = Math.ceil(ascentOf(ctx, '0123456789', numPx, 0.74))
  // Day/night milk: a sun or a moon a little taller than the date, in front of it.
  const markPx = part ? px(34) : 0
  const markGap = part ? px(8) : 0
  const date = fitText(ctx, pumped, 800, datePx, colW - markPx - markGap)
  const blocks = capPx + px(6) + numAscent + px(12) + capPx + px(5) + Math.max(date, markPx - px(4)) + (portrait ? qrBlockH + px(28) : 0)
  const spare = Math.max(0, bodyBottom - bodyTop - blocks)
  const lead = Math.min(px(14), Math.floor(spare / 3))
  y = bodyTop + Math.max(0, Math.floor((spare - lead * 2) / 2))
  ctx.textBaseline = 'top'
  ctx.font = `700 ${capPx}px ${FONT}`
  drawSpaced(ctx, 'VOLUME', left, y, capPx, 0.2)
  y += capPx + px(6) + lead
  ctx.textBaseline = 'alphabetic'
  y += numAscent
  ctx.font = `900 ${numPx}px ${SERIF}`
  let x: number
  if (placeholder) {
    const dashW = Math.round(numPx * 0.9)
    const dashH = Math.max(2, px(3))
    ctx.fillRect(left, y - dashH, dashW, dashH)
    x = left + dashW + px(10)
  } else {
    ctx.fillText(num, left, y)
    x = left + ctx.measureText(num).width + px(6)
  }
  ctx.font = `800 ${unitPx}px ${FONT}`
  ctx.fillText(unit, x, y)
  x += ctx.measureText(unit).width + px(10)
  if (volume.secondary) {
    ctx.font = `600 ${subPx}px ${FONT}`
    ctx.fillText(volume.secondary, x, y)
  }
  y += px(12) + lead
  ctx.textBaseline = 'top'
  ctx.font = `700 ${capPx}px ${FONT}`
  drawSpaced(ctx, part === 'night' ? 'PUMPED · NIGHT' : part === 'day' ? 'PUMPED · DAY' : 'PUMPED', left, y, capPx, 0.2)
  y += capPx + px(5)
  ctx.font = `800 ${date}px ${FONT}`
  if (part) {
    // Centred on the date's digits (a top-baselined run's ink sits in roughly its upper 0.8 em).
    drawIcon(ctx, part === 'night' ? 'moon' : 'sun', left, y + Math.round(date * 0.42 - markPx / 2) + px(3), markPx, '#000000')
  }
  ctx.fillText(pumped, left + markPx + markGap, y)
  y += Math.max(date, markPx - px(4))
  if (portrait) {
    y += px(14)
    drawQrCode(Math.round((width - qrCode) / 2), y + QR_QUIET * cell)
    y += qrBlockH + px(14)
  } else {
    y = bodyBottom
  }

  // ---- use-by: a hairline, then one cell per place with its icon
  if (cells.length) {
    const top = portrait ? Math.min(y, height - m - stripH - hair - px(8)) : bodyBottom + px(8)
    ctx.fillRect(left, top, right - left, hair)
    const sy = top + hair + px(7)
    if (!portrait) {
      const cw = (right - left) / cells.length
      const iconPx = px(18)
      const labelPx = px(10)
      const valuePx = Math.min(...cells.map((c) => fitText(ctx, c.value, 800, px(16), cw - px(10))))
      cells.forEach((c, i) => {
        const mid = left + cw * i + cw / 2
        drawIcon(ctx, c.icon, mid - iconPx / 2, sy, iconPx, '#000000')
        ctx.textBaseline = 'top'
        ctx.font = `700 ${labelPx}px ${FONT}`
        drawSpaced(ctx, c.label, mid, sy + iconPx + px(4), labelPx, 0.2, 'center')
        ctx.textAlign = 'center'
        ctx.font = `800 ${valuePx}px ${FONT}`
        ctx.fillText(c.value, mid, sy + iconPx + px(4) + labelPx + px(4))
        ctx.textAlign = 'left'
      })
    } else {
      const rowH = px(30)
      const iconPx = px(18)
      const labelPx = px(11)
      const valuePx = Math.min(...cells.map((c) => fitText(ctx, c.value, 800, px(16), right - left - px(110))))
      cells.forEach((c, i) => {
        const ry = sy - px(4) + rowH * i
        if (i) ctx.fillRect(left + iconPx + px(8), ry, right - left - iconPx - px(8), Math.max(1, px(1)))
        drawIcon(ctx, c.icon, left, ry + (rowH - iconPx) / 2, iconPx, '#000000')
        ctx.textBaseline = 'middle'
        ctx.font = `700 ${labelPx}px ${FONT}`
        drawSpaced(ctx, c.label, left + iconPx + px(8), ry + rowH / 2 + px(1), labelPx, 0.2)
        ctx.textAlign = 'right'
        ctx.font = `800 ${valuePx}px ${FONT}`
        ctx.fillText(c.value, right, ry + rowH / 2 + px(1))
        ctx.textAlign = 'left'
      })
    }
  }
  return true
}

/** "60 mL" → ["60", "mL"]; "— oz" → ["—", "oz"]: the number and its unit are set in different faces. */
/**
 * A fridge-spot sticker, printed once and stuck where a premade bottle stands: the spot's number as large as the
 * sticker allows, a milk drop, and PREMADE BOTTLE beside it (under it on a tall sticker). Same stock and size as the
 * milk labels, so it prints on whatever is loaded. 1-bit shapes only, like the milk label.
 */
export function drawSpotLabel(canvas: HTMLCanvasElement, spot: number, prefs: Pick<LabelPrefs, 'size'>): boolean {
  const size = labelSize(prefs.size)
  const { width, height } = labelPixelSize(size)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  const digit = String(spot)
  const portrait = height > width
  const m = Math.round(Math.min(width, height) * 0.07)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  // The numeral: as tall as the space allows, never wider than its share.
  const boxH = portrait ? Math.round((height - 2 * m) * 0.62) : height - 2 * m
  const boxW = portrait ? width - 2 * m : Math.round((width - 2 * m) * 0.5)
  let px = Math.round(boxH * 1.4)
  const fits = () => {
    ctx.font = `900 ${px}px ${SERIF}`
    return ascentOf(ctx, digit, px, 0.6) <= boxH && ctx.measureText(digit).width <= boxW
  }
  while (px > 20 && !fits()) px -= 2
  const ascent = ascentOf(ctx, digit, px, 0.6)
  const numW = ctx.measureText(digit).width
  const captionW = portrait ? width - 2 * m : width - 3 * m - Math.max(numW, boxW * 0.7)
  if (portrait) {
    ctx.fillText(digit, (width - numW) / 2, m + ascent)
    const top = m + boxH + m
    const icon = Math.round(Math.min(captionW * 0.3, (height - top - m) * 0.4))
    drawIcon(ctx, 'drop', (width - icon) / 2, top, icon, '#000000')
    const cap = fitSpaced(ctx, 'PREMADE BOTTLE', 900, Math.round(icon * 0.7), 0.12, captionW, 10)
    drawSpaced(ctx, 'PREMADE BOTTLE', width / 2, top + icon + m * 0.6 + cap * 0.8, cap, 0.12, 'center')
    return true
  }
  const numX = m + (Math.max(numW, boxW * 0.7) - numW) / 2
  ctx.fillText(digit, numX, (height + ascent) / 2)
  const colX = width - m - captionW
  const cx = colX + captionW / 2
  const icon = Math.round(Math.min(captionW * 0.38, height * 0.3))
  const cap = fitSpaced(ctx, 'PREMADE', 900, Math.round(height * 0.17), 0.12, captionW, 10)
  const block = icon + m * 0.5 + cap * 0.8 + m * 0.35 + cap * 0.8
  let y = (height - block) / 2
  drawIcon(ctx, 'drop', cx - icon / 2, y, icon, '#000000')
  y += icon + m * 0.5 + cap * 0.8
  ctx.font = `900 ${cap}px ${FONT}`
  drawSpaced(ctx, 'PREMADE', cx, y, cap, 0.12, 'center')
  y += m * 0.35 + cap * 0.8
  drawSpaced(ctx, 'BOTTLE', cx, y, cap, 0.12, 'center')
  return true
}

/**
 * A travel sticker: printed ahead at home (the printer stays home) and taken along. Its QR is a code with no milk
 * yet; scanned in the pumping sheet when the session is logged, the bag takes that code. Besides the QR, the code
 * large enough to read off, and two lines to write the volume and the time on by hand until then.
 */
export function drawTravelLabel(canvas: HTMLCanvasElement, code: string, prefs: Pick<LabelPrefs, 'size'>, childName = ''): boolean {
  const size = labelSize(prefs.size)
  const { width, height } = labelPixelSize(size)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'
  const portrait = height > width
  const m = Math.round(Math.min(width, height) * 0.05)
  const qr = qrModules(code)
  // The QR: as many whole pixels a module as fit in the short side with its quiet zone.
  const modules = (qr?.size ?? QR_MODULES_EXPECTED) + QR_QUIET * 2
  const room = portrait ? width - 2 * m : height - 2 * m
  const cell = Math.max(2, Math.floor(Math.min(room, portrait ? height * 0.5 : width * 0.52) / modules))
  const qrBox = modules * cell
  const qrX = portrait ? Math.round((width - qrBox) / 2) : width - m - qrBox + cell * 2
  const qrY = portrait ? m : Math.round((height - qrBox) / 2)
  if (qr) drawQr(ctx, qr, qrX + QR_QUIET * cell, qrY + QR_QUIET * cell, cell)
  // The words: a column beside the QR, or under it on a tall sticker.
  const colX = m
  const colW = portrait ? width - 2 * m : qrX + cell * 2 - m * 2
  let y = portrait ? qrY + qrBox + m * 0.5 : m * 1.4
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const head = name(childName)
  const capPx = fitSpaced(ctx, head, 900, Math.round(height * (portrait ? 0.045 : 0.075)), 0.14, colW, 9)
  y += capPx
  drawSpaced(ctx, head, colX, y, capPx, 0.14)
  const codePx = fitText(ctx, code, 900, Math.round(height * (portrait ? 0.09 : 0.19)), colW, 12)
  y += m * 0.5 + codePx * 0.8
  ctx.fillText(code, colX, y)
  // Two write-in lines: what is in it and when it was pumped, by hand until the session is logged.
  const linePx = Math.max(10, Math.round(capPx * 0.95))
  // The two lines share what is left under the code: room to write above each, the last one near the bottom.
  const rest = height - m - y
  const top = y
  ctx.lineWidth = Math.max(1, Math.round(height / 150))
  for (const [i, label] of ['AMOUNT', 'PUMPED'].entries()) {
    y = top + rest * (i === 0 ? 0.45 : 0.92)
    ctx.font = `800 ${linePx}px ${FONT}`
    ctx.fillText(label, colX, y)
    const x0 = colX + ctx.measureText(label).width + m * 0.4
    ctx.beginPath()
    ctx.moveTo(x0, y + 1)
    ctx.lineTo(colX + colW, y + 1)
    ctx.stroke()
  }
  return true

  function name(child: string): string {
    const n = child.trim()
    return n ? `${n.toUpperCase()}'S MILK · TRAVEL` : 'BREAST MILK · TRAVEL'
  }
}

/** A test label for a newly set printer: a frame at the sticker's edge, what it is and the size, so a wrong size shows. */
export function drawTestLabel(canvas: HTMLCanvasElement, prefs: Pick<LabelPrefs, 'size'>): boolean {
  const size = labelSize(prefs.size)
  const { width, height } = labelPixelSize(size)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#000000'
  const t = Math.max(2, Math.round(height / 60))
  ctx.lineWidth = t
  ctx.strokeRect(t, t, width - 2 * t, height - 2 * t)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const big = fitText(ctx, 'BRAMBLE', 900, Math.round(height * 0.22), width * 0.8)
  ctx.fillText('BRAMBLE', width / 2, height * 0.36)
  fitText(ctx, 'TEST LABEL', 800, Math.round(big * 0.45), width * 0.8)
  ctx.fillText('TEST LABEL', width / 2, height * 0.58)
  fitText(ctx, size.label, 700, Math.round(big * 0.4), width * 0.8)
  ctx.fillText(size.label, width / 2, height * 0.76)
  return true
}

export function splitVolume(primary: string): [number: string, unit: string] {
  const i = primary.lastIndexOf(' ')
  return i < 0 ? [primary, ''] : [primary.slice(0, i), primary.slice(i + 1)]
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render the label image.'))), 'image/png')
  })
}

const HANDOFF_KEY = 'bramble.milkLabel'

/** One-shot hand-off from the pumping timer to Home: survives any extra navigation in between. */
export function stashLabelHandoff(entry: unknown) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(entry))
  } catch {
    /* private mode: the user can still open the label from the timeline row */
  }
}

/**
 * Read the hand-off without consuming it. State initialisers can run more than once per mount
 * (StrictMode, restarted transitions), so the read and the clear are separate steps.
 */
export function peekLabelHandoff<T>(): T | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function clearLabelHandoff() {
  try {
    sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    /* ignore */
  }
}

export function labelFilename(input: MilkLabelInput): string {
  const who = input.childName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'milk'
  return `${who}-milk-${format(input.pumpedAt, 'yyyy-MM-dd-HHmm')}.png`
}

/** True when this browser can hand an image file to another app (iOS share sheet, Android share). */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}
