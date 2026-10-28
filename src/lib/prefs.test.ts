import { afterEach, describe, expect, it } from 'vitest'
import { loadPrefs } from './prefs'

afterEach(() => localStorage.clear())

describe('loadPrefs', () => {
  it('moves a phone still on the old 50 × 30 default to the household stock, once', () => {
    localStorage.setItem('bramble.prefs', JSON.stringify({ labels: { size: '50x30' } }))
    expect(loadPrefs().labels.size).toBe('51x38')
    expect(loadPrefs().labels.sizeChosen).toBe(false)
  })
  it('keeps 50 × 30 when it was picked in Settings', () => {
    localStorage.setItem('bramble.prefs', JSON.stringify({ labels: { size: '50x30', sizeChosen: true } }))
    expect(loadPrefs().labels.size).toBe('50x30')
  })
  it('leaves every other size alone and fills the new fields', () => {
    localStorage.setItem('bramble.prefs', JSON.stringify({ labels: { size: '62x29' } }))
    const p = loadPrefs()
    expect(p.labels.size).toBe('62x29')
    expect(p.labels.autoPrint).toBe(true)
    localStorage.clear()
    expect(loadPrefs().labels.size).toBe('51x38') // nothing stored → the default
  })
})
