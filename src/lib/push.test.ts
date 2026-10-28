import { describe, expect, it } from 'vitest'
import { pushSupport } from './push'

describe('pushSupport', () => {
  it('reports insecure contexts', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(pushSupport()).toBe('insecure')
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  })
  it('reports unsupported when PushManager is missing', () => {
    expect(['unsupported', 'ok', 'ios-needs-install']).toContain(pushSupport())
  })
})
