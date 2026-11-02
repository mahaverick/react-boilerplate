import { describe, expect, it } from 'vite-plus/test'
import { ROLE_ERROR } from '@/components/features/tenant/role-error'

describe('ROLE_ERROR', () => {
  it('words the failed role lookup with its effect and the next step', () => {
    expect(ROLE_ERROR).toBe(
      'We couldn’t load your role in this workspace, so its controls are hidden. Select Try again to show them.'
    )
  })
})
