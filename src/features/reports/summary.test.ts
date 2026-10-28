import { describe, expect, it } from 'vitest'
import { hoursTick } from './SummaryView'

describe('hoursTick', () => {
  it('shows minutes under an hour', () => expect(hoursTick(0.5)).toBe('30m'))
  it('shows whole hours', () => expect(hoursTick(8.02)).toBe('8h'))
  it('shows half hours', () => expect(hoursTick(1.5)).toBe('1.5h'))
  it('shows zero plainly', () => expect(hoursTick(0)).toBe('0'))
})
