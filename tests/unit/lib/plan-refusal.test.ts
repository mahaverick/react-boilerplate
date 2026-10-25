import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vite-plus/test'
import { planRefusalFrom } from '@/lib/plan-refusal'

/** An Axios error answering `status` with a body of `code` and `details`. */
function refused(status: number, code?: string, details?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const data = { success: false, message: 'Refused.', statusCode: status, code, details }
  return new AxiosError('Refused.', String(status), config, null, {
    data,
    status,
    statusText: 'Error',
    headers: {},
    config,
  })
}

describe('planRefusalFrom', () => {
  it('maps a 402 limit refusal', () => {
    expect(
      planRefusalFrom(refused(402, 'PLAN_LIMIT_REACHED', { key: 'members', used: 3, limit: 3 }))
    ).toEqual({ kind: 'limit', key: 'members', used: 3, limit: 3 })
  })

  it('maps a 402 feature refusal', () => {
    expect(
      planRefusalFrom(refused(402, 'PLAN_FEATURE_REQUIRED', { key: 'advanced_example' }))
    ).toEqual({ kind: 'feature', key: 'advanced_example' })
  })

  it('ignores a 403, a 402 with another code, and a non-axios error', () => {
    expect(
      planRefusalFrom(refused(403, 'PLAN_LIMIT_REACHED', { key: 'members', used: 3, limit: 3 }))
    ).toBeUndefined()
    expect(
      planRefusalFrom(refused(402, 'SOMETHING_ELSE', { key: 'members', used: 3, limit: 3 }))
    ).toBeUndefined()
    expect(planRefusalFrom(new Error('x'))).toBeUndefined()
  })

  it('returns undefined for a 402 without details (an invitee refused on a full workspace)', () => {
    expect(planRefusalFrom(refused(402, 'PLAN_LIMIT_REACHED'))).toBeUndefined()
    expect(planRefusalFrom(refused(402, 'PLAN_FEATURE_REQUIRED'))).toBeUndefined()
  })

  it('returns undefined for malformed details', () => {
    expect(
      planRefusalFrom(refused(402, 'PLAN_LIMIT_REACHED', { key: 'members', used: '3', limit: 3 }))
    ).toBeUndefined()
    expect(
      planRefusalFrom(refused(402, 'PLAN_LIMIT_REACHED', { key: 'members', used: 3 }))
    ).toBeUndefined()
    expect(
      planRefusalFrom(refused(402, 'PLAN_LIMIT_REACHED', { used: 3, limit: 3 }))
    ).toBeUndefined()
    expect(planRefusalFrom(refused(402, 'PLAN_FEATURE_REQUIRED', { key: 5 }))).toBeUndefined()
    expect(planRefusalFrom(refused(402, 'PLAN_LIMIT_REACHED', 'members'))).toBeUndefined()
  })
})
