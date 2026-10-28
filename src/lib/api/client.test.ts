import { describe, expect, it } from 'vitest'
import { ApiError, buildQuery, describeApiError } from './client'

describe('buildQuery', () => {
  it('skips empty values', () => expect(buildQuery({ a: 1, b: '', c: undefined, d: 'x' })).toBe('?a=1&d=x'))
  it('returns empty string with no params', () => expect(buildQuery({})).toBe(''))
})

describe('describeApiError', () => {
  it('explains Baby Buddy overlaps in plain words', () => expect(describeApiError(new ApiError(400, { non_field_errors: ['Another entry intersects the specified time period.'] }))).toMatch(/overlap another entry/))
  it('explains auth failures', () => expect(describeApiError(new ApiError(403, {}))).toMatch(/sign in/))
  it('surfaces field errors', () => {
    expect(describeApiError(new ApiError(400, { end: ['End must be after start.'] }))).toBe('end: End must be after start.')
  })
  it('strips HTML from server messages', () => {
    expect(describeApiError(new ApiError(400, { non_field_errors: ['Overlap. Conflicting entry: <a href="/sleep/2/">Sleep (8:12 p.m.)</a>'] }))).toBe('Overlap. Conflicting entry: Sleep (8:12 p.m.)')
  })
  it('explains network failures', () => expect(describeApiError(new TypeError('fetch'))).toMatch(/reach the server/))
})
