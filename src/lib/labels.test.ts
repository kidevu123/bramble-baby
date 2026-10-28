import { describe, expect, it } from 'vitest'
import { DEFAULT_LABEL_PREFS, formatLabelVolume, fridgeUseBy, labelLines, labelPixelSize, labelSize, labelText, milkDaypart, nightWindowText, storageCells, storageDeadlines } from './labels'
import { expectedExpiry } from './milk'

const pumpedAt = new Date(2026, 8, 30, 14, 5) // Sep 30 2026, 2:05 PM local

describe('qrModules', () => {
  it('encodes a bag code into a small QR (version 1–2) so it prints legibly on a 40 mm label', async () => {
    const { qrModules } = await import('./labels')
    const qr = qrModules('ABC234')
    expect(qr).not.toBeNull()
    expect(qr!.size).toBeLessThanOrEqual(25)
    expect(qr!.dark(0, 0)).toBe(true) // finder pattern corner
  })
})

describe('storageDeadlines', () => {
  it('applies CDC defaults from the pump time', () => {
    const d = storageDeadlines(pumpedAt, DEFAULT_LABEL_PREFS)
    expect(d.room).toEqual(new Date(2026, 8, 30, 18, 5))
    expect(d.fridge).toEqual(new Date(2026, 9, 4, 14, 5))
    expect(d.freezer).toEqual(expectedExpiry({ pumpedAt, location: 'freezer' }, { roomHours: 4, fridgeDays: 4, freezerMonths: 6 }))
  })
  it('prints the same use-by moments the stash and the reminders use', () => {
    const w = { roomHours: 4, fridgeDays: 4, freezerMonths: 6 }
    for (const p of [new Date(2026, 0, 1, 10), new Date(2026, 2, 1, 10), new Date(2026, 7, 31, 10)]) {
      const d = storageDeadlines(p, w)
      expect(d.freezer).toEqual(expectedExpiry({ pumpedAt: p, location: 'freezer' }, w))
      expect(d.fridge).toEqual(expectedExpiry({ pumpedAt: p, location: 'fridge' }, w))
      expect(d.room).toEqual(expectedExpiry({ pumpedAt: p, location: 'room' }, w))
    }
  })
  it('honours custom windows', () => {
    const d = storageDeadlines(pumpedAt, { roomHours: 2, fridgeDays: 2, freezerMonths: 12 })
    expect(d.room).toEqual(new Date(2026, 8, 30, 16, 5))
    expect(d.fridge).toEqual(new Date(2026, 9, 2, 14, 5))
    expect(d.freezer).toEqual(new Date(pumpedAt.getTime() + 12 * 30.4375 * 24 * 3_600_000))
  })
})

describe('use-by strip', () => {
  it('prints the fridge clock within a week, so the sticker never outlasts the stash', () => {
    const cells = storageCells({ childName: 'Ada', pumpedAt: new Date(2026, 9, 9, 1, 0), amount: 60, unit: 'ml', code: 'ABCDEF' }, DEFAULT_LABEL_PREFS)
    expect(cells.map((c) => `${c.label} ${c.value}`)).toEqual(['ROOM Fri 5:00 AM', 'FRIDGE Tue 1:00 AM', 'FREEZER Apr 9, 2027'])
    expect(cells[1].value).toBe(fridgeUseBy(expectedExpiry({ pumpedAt: new Date(2026, 9, 9, 1, 0), location: 'fridge' }, DEFAULT_LABEL_PREFS), 4))
    // a fridge window of a week or more prints the date
    expect(fridgeUseBy(new Date(2026, 9, 17, 1, 0), 8)).toBe('Sat Oct 17')
  })
})

describe('formatLabelVolume', () => {
  it('prints both units by default', () => {
    expect(formatLabelVolume(4, 'oz', true)).toBe('4 oz · 118 mL')
    expect(formatLabelVolume(120, 'ml', true)).toBe('120 mL · 4.1 oz')
  })
  it('prints a single unit when asked', () => {
    expect(formatLabelVolume(4.25, 'oz', false)).toBe('4.25 oz')
  })
  it('is empty for missing or zero volume', () => {
    expect(formatLabelVolume(null, 'oz', true)).toBe('')
    expect(formatLabelVolume(0, 'ml', true)).toBe('')
  })
})

describe('labelVolumeParts', () => {
  it('makes the phone unit the hero and the other unit the small print', async () => {
    const { labelVolumeParts } = await import('./labels')
    expect(labelVolumeParts(60, 'ml', true)).toEqual({ primary: '60 mL', secondary: '2 oz' })
    expect(labelVolumeParts(4.25, 'oz', true)).toEqual({ primary: '4.25 oz', secondary: '126 mL' })
    expect(labelVolumeParts(120, 'ml', false)).toEqual({ primary: '120 mL', secondary: null })
  })
  it('prints a dash for a missing volume so the preview shows where it goes', async () => {
    const { labelVolumeParts } = await import('./labels')
    expect(labelVolumeParts(null, 'ml', true)).toEqual({ primary: '— mL', secondary: null })
    expect(labelVolumeParts(0, 'oz', true)).toEqual({ primary: '— oz', secondary: null })
  })
})

describe('labelLines', () => {
  const input = { childName: 'Ada', pumpedAt, amount: 4, unit: 'oz' as const, notes: 'left side only\nsecond line' }
  it('includes name, time, volume and storage by default', () => {
    const lines = labelLines(input, DEFAULT_LABEL_PREFS).map((l) => l.text)
    expect(lines).toEqual(['Ada', 'Wed Sep 30 · 2:05 PM', '4 oz · 118 mL', 'Day milk', 'Room 6:05 PM · Fridge Sun 2:05 PM', 'Freezer Apr 1, 2027'])
  })
  it('drops optional parts according to prefs and keeps only the first note line', () => {
    const lines = labelLines(input, { ...DEFAULT_LABEL_PREFS, showName: false, showStorage: false, showNotes: true, bothUnits: false }).map((l) => l.text)
    expect(lines).toEqual(['Wed Sep 30 · 2:05 PM', '4 oz', 'Day milk', 'left side only'])
  })
  it('skips the volume line when there is no amount', () => {
    const lines = labelLines({ ...input, amount: null }, DEFAULT_LABEL_PREFS).map((l) => l.text)
    expect(lines).not.toContain('4 oz · 118 mL')
    expect(lines[1]).toBe('Wed Sep 30 · 2:05 PM')
  })
  it('gives the time and volume the headline weight', () => {
    const lines = labelLines(input, DEFAULT_LABEL_PREFS)
    expect(lines[1].weight).toBe(3)
    expect(lines[2].weight).toBe(3)
    expect(lines[0].weight).toBe(2)
  })
  it('produces clipboard text', () => {
    expect(labelText(input, { ...DEFAULT_LABEL_PREFS, showStorage: false })).toBe('Ada\nWed Sep 30 · 2:05 PM\n4 oz · 118 mL\nDay milk')
  })
  it('prints the real pumped date for milk added days later, with use-by dates counted from it', () => {
    const lines = labelLines({ ...input, pumpedAt: new Date(2026, 9, 2, 21, 0) }, DEFAULT_LABEL_PREFS).map((l) => l.text)
    expect(lines).toEqual(['Ada', 'Fri Oct 2 · 9:00 PM', '4 oz · 118 mL', 'Night milk', 'Room 1:00 AM · Fridge Tue 9:00 PM', 'Freezer Apr 3, 2027'])
  })
  it('counts thawed milk from the thaw and never offers the freezer', () => {
    const thawedAt = new Date(2026, 9, 5, 9, 30) // Mon Oct 5, 9:30 AM
    const lines = labelLines({ ...input, thawedAt }, DEFAULT_LABEL_PREFS).map((l) => l.text)
    expect(lines).toEqual(['Ada', 'Wed Sep 30 · 2:05 PM', '4 oz · 118 mL', 'Day milk', 'Thawed · Room 11:30 AM · Fridge Tue 9:30 AM', 'Do not refreeze'])
    const tall = labelLines({ ...input, thawedAt }, { ...DEFAULT_LABEL_PREFS, size: '40x60' }).map((l) => l.text)
    expect(tall.slice(-3)).toEqual(['Thawed · Room 11:30 AM', 'Fridge Tue 9:30 AM', 'Do not refreeze'])
  })
})

describe('milkDaypart', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 8, h, m)
  it('marks 9 PM to 6 AM as night by default, and the rest as day', () => {
    expect(milkDaypart(at(20, 59), DEFAULT_LABEL_PREFS)).toBe('day')
    expect(milkDaypart(at(21), DEFAULT_LABEL_PREFS)).toBe('night')
    expect(milkDaypart(at(0, 30), DEFAULT_LABEL_PREFS)).toBe('night')
    expect(milkDaypart(at(5, 59), DEFAULT_LABEL_PREFS)).toBe('night')
    expect(milkDaypart(at(6), DEFAULT_LABEL_PREFS)).toBe('day')
    expect(milkDaypart(at(13), DEFAULT_LABEL_PREFS)).toBe('day')
  })
  it('follows a window that starts after midnight, and says nothing when the mark is off', () => {
    const late = { dayNight: true, nightFrom: 0, nightTo: 7 }
    expect(milkDaypart(at(23), late)).toBe('day')
    expect(milkDaypart(at(3), late)).toBe('night')
    expect(milkDaypart(at(7), late)).toBe('day')
    expect(milkDaypart(at(3), { ...DEFAULT_LABEL_PREFS, dayNight: false })).toBeNull()
    expect(nightWindowText(DEFAULT_LABEL_PREFS)).toBe('9 PM–6 AM')
    expect(nightWindowText(late)).toBe('12 AM–7 AM')
  })
  it('puts Night milk or Day milk in the text version, and nothing when off', () => {
    const input = { childName: 'Ada', pumpedAt: at(2, 10), amount: 60, unit: 'ml' as const }
    expect(labelText(input, DEFAULT_LABEL_PREFS)).toContain('Night milk')
    expect(labelText({ ...input, pumpedAt: at(9) }, DEFAULT_LABEL_PREFS)).toContain('Day milk')
    expect(labelText(input, { ...DEFAULT_LABEL_PREFS, dayNight: false })).not.toMatch(/(Day|Night) milk/)
  })
})

describe('label sizes', () => {
  it('renders at 203 dpi', () => {
    expect(labelPixelSize(labelSize('51x38'))).toEqual({ width: 408, height: 304 })
    expect(labelPixelSize(labelSize('50x30'))).toEqual({ width: 400, height: 240 })
    expect(labelPixelSize(labelSize('62x29'))).toEqual({ width: 496, height: 232 })
  })
  it('falls back to the first size for unknown ids', () => {
    expect(labelSize('nope' as never).id).toBe('51x38')
  })
})

describe('portrait labels', () => {
  it('split the date/time and storage lines instead of shrinking them', () => {
    const lines = labelLines({ childName: 'Ada', pumpedAt, amount: 4, unit: 'oz' }, { ...DEFAULT_LABEL_PREFS, size: '40x60' }).map((l) => l.text)
    expect(lines).toEqual(['Ada', 'Wed Sep 30', '2:05 PM', '4 oz · 118 mL', 'Day milk', 'Room 6:05 PM', 'Fridge Sun 2:05 PM', 'Freezer Apr 1, 2027'])
  })
})
