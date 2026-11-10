import { describe, expect, it } from 'vitest'
import { integrationsSummary, listed, type IntegrationState } from './integrations'

const items = (...states: IntegrationState[]) => ['Hatch scale', 'Night light', 'Thermometer'].slice(0, states.length).map((title, i) => ({ title, state: states[i] }))

describe('the Integrations row', () => {
  it('lists names the way a person would', () => {
    expect(listed([])).toBe('')
    expect(listed(['A'])).toBe('A')
    expect(listed(['A', 'B'])).toBe('A and B')
    expect(listed(['A', 'B', 'C'])).toBe('A, B and C')
  })

  it('names what is there until the server has answered, and says so when nothing is connected', () => {
    expect(integrationsSummary(items('loading', 'loading', 'loading'))).toBe('Hatch scale, Night light and Thermometer')
    expect(integrationsSummary(items('off', 'loading', 'off'))).toBe('Hatch scale, Night light and Thermometer')
    expect(integrationsSummary(items('off', 'off', 'off'))).toBe('Nothing connected · Hatch scale, Night light and Thermometer')
    expect(integrationsSummary(items('off'))).toBe('Nothing connected · Hatch scale')
  })

  it('says what is connected', () => {
    expect(integrationsSummary(items('on', 'off', 'off'))).toBe('Hatch scale connected')
    expect(integrationsSummary(items('on', 'off', 'on'))).toBe('Hatch scale and Thermometer connected')
    expect(integrationsSummary(items('on', 'on', 'on'))).toBe('Hatch scale, Night light and Thermometer connected')
  })

  it('leads with the one that needs a person, so it is seen without opening the list', () => {
    expect(integrationsSummary(items('on', 'off', 'attention'))).toBe('Thermometer needs attention · Hatch scale connected')
    expect(integrationsSummary(items('attention', 'attention', 'off'))).toBe('Hatch scale and Night light need attention')
    expect(integrationsSummary(items('loading', 'attention', 'on'))).toBe('Night light needs attention · Thermometer connected')
  })
})
