import { afterEach, describe, expect, it } from 'vitest'
import { caregiverName, caregiverOf, caregiverTag, setCurrentCaregiver, withCaregiverTag } from './caregiver'

afterEach(() => setCurrentCaregiver(null))

describe('caregiver tags', () => {
  it('round-trips a username', () => {
    expect(caregiverOf([caregiverTag('mom')])).toBe('mom')
    expect(caregiverOf(['potty', 'caregiver:dad'])).toBe('dad')
    expect(caregiverOf(['potty'])).toBeNull()
    expect(caregiverOf(undefined)).toBeNull()
  })
  it('adds the current caregiver to a create body without dropping other tags', () => {
    setCurrentCaregiver('mom')
    expect(withCaregiverTag({ child: 1, tags: ['potty'] })).toEqual({ child: 1, tags: ['potty', 'caregiver:mom'] })
    expect(withCaregiverTag({ child: 1 })).toEqual({ child: 1, tags: ['caregiver:mom'] })
  })
  it('leaves the body alone when nobody is signed in or a tag is already there', () => {
    expect(withCaregiverTag({ child: 1 })).toEqual({ child: 1 })
    setCurrentCaregiver('mom')
    expect(withCaregiverTag({ child: 1, tags: ['caregiver:dad'] })).toEqual({ child: 1, tags: ['caregiver:dad'] })
  })
  it('shows the role People gave a login, else the login made presentable', () => {
    expect(caregiverName('sam', { sam: 'Dad' })).toBe('Dad')
    expect(caregiverName('Sam', { sam: 'Dad' })).toBe('Dad') // usernames are matched case-insensitively
    expect(caregiverName('sam', {})).toBe('Sam')
    expect(caregiverName('admin', undefined)).toBe('Admin') // entries from the shared-login days
    expect(caregiverName(' ', {})).toBeNull()
    expect(caregiverName(null, {})).toBeNull()
  })
})
