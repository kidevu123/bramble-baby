import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beginPrintNotice, currentPrintNotice, dismissPrintNotice, resetPrintNotices, subscribePrintNotice, updatePrintNotice } from './print-notice'

describe('print notice store', () => {
  beforeEach(() => resetPrintNotices())
  it('starts as sending and tells listeners of every change', () => {
    const seen: (string | null)[] = []
    subscribePrintNotice((n) => seen.push(n?.state ?? null))
    const id = beginPrintNotice('60 mL')
    expect(currentPrintNotice()?.volumeText).toBe('60 mL')
    updatePrintNotice(id, { state: 'sent', bagCode: 'ABC234' })
    expect(currentPrintNotice()?.bagCode).toBe('ABC234')
    dismissPrintNotice(id)
    expect(seen).toEqual(['sending', 'sent', null])
  })
  it('ignores updates and dismissals for a print that was replaced', () => {
    const first = beginPrintNotice('60 mL')
    const second = beginPrintNotice('90 mL')
    updatePrintNotice(first, { state: 'failed', error: 'late' })
    expect(currentPrintNotice()?.state).toBe('sending')
    dismissPrintNotice(first)
    expect(currentPrintNotice()?.id).toBe(second)
  })
  it('stops telling a listener after it unsubscribes', () => {
    const l = vi.fn()
    const off = subscribePrintNotice(l)
    beginPrintNotice('60 mL')
    off()
    beginPrintNotice('90 mL')
    expect(l).toHaveBeenCalledTimes(1)
  })
})
