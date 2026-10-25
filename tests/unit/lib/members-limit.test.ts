import { describe, expect, it } from 'vite-plus/test'
import { membersLimitLine } from '@/lib/members-limit'

describe('membersLimitLine', () => {
  it('names the limit at the limit', () => {
    expect(membersLimitLine(3, 3, 'Free')).toBe(
      "You've used 3 of 3 members on Free. Upgrade to add more."
    )
  })

  it('says “member” for a limit of one', () => {
    expect(membersLimitLine(1, 1, 'Free')).toBe(
      "You've used 1 of 1 member on Free. Upgrade to add more."
    )
  })

  it('says how many to remove over the limit', () => {
    expect(membersLimitLine(5, 3, 'Free')).toBe(
      '5 of 3 members on Free. Upgrade to add more, or remove 2.'
    )
    expect(membersLimitLine(2, 1, 'Free')).toBe(
      '2 of 1 member on Free. Upgrade to add more, or remove 1.'
    )
  })
})
