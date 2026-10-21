import { describe, expect, it } from 'vite-plus/test'
import { AuthPagePending, AuthPending } from '@/components/shared/pending-templates'
import { Route as authRoute } from '@/pages/_auth'
import { Route as login } from '@/pages/_auth/login'
import { Route as callback } from '@/pages/auth/callback'
import { Route as authLink } from '@/pages/auth/link'
import { Route as accept } from '@/pages/invitations/accept'
import { Route as confirm } from '@/pages/invitations/confirm'
import { Route as welcome } from '@/pages/welcome'

describe('the auth routes name their own pending template', () => {
  it.each([['login', login]])(
    '%s, inside the _auth layout, uses the card alone',
    (_name, route) => {
      expect(route.options.pendingComponent).toBe(AuthPending)
    }
  )

  it.each([
    ['_auth', authRoute],
    ['invitations/accept', accept],
    ['invitations/confirm', confirm],
    ['auth/callback', callback],
    ['auth/link', authLink],
    ['welcome', welcome],
  ])('%s, which draws its own frame, uses the framed template', (_name, route) => {
    expect(route.options.pendingComponent).toBe(AuthPagePending)
  })
})
