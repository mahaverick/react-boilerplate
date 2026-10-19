import { describe, expect, it } from 'vitest'
import { AuthPagePending, AuthPending } from '@/components/shared/pending-templates'
import { Route as authRoute } from '@/pages/_auth'
import { Route as forgotPassword } from '@/pages/_auth/forgot-password'
import { Route as login } from '@/pages/_auth/login'
import { Route as register } from '@/pages/_auth/register'
import { Route as callback } from '@/pages/auth/callback'
import { Route as accept } from '@/pages/invitations/accept'
import { Route as resetPassword } from '@/pages/reset-password'
import { Route as verifyEmail } from '@/pages/verify-email'
import { Route as welcome } from '@/pages/welcome'

describe('the auth routes name their own pending template', () => {
  it.each([
    ['login', login],
    ['register', register],
    ['forgot-password', forgotPassword],
  ])('%s, inside the _auth layout, uses the card alone', (_name, route) => {
    expect(route.options.pendingComponent).toBe(AuthPending)
  })

  it.each([
    ['_auth', authRoute],
    ['reset-password', resetPassword],
    ['verify-email', verifyEmail],
    ['invitations/accept', accept],
    ['auth/callback', callback],
    ['welcome', welcome],
  ])('%s, which draws its own frame, uses the framed template', (_name, route) => {
    expect(route.options.pendingComponent).toBe(AuthPagePending)
  })
})
