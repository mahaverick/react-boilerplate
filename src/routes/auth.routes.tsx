import { Suspense } from 'react'

import { ForgotPassword, Login, Register, ResetPassword } from '@/routes/lazy.routes'

import SuspenseLoader from '@/components/features/suspense-loader'
import EmailVerification from '@/pages/auth/email-verification.page'
import AuthLayout from '@/pages/layouts/auth.layout'

export const authRoutes = [
  {
    path: '',
    element: <AuthLayout />,
    children: [
      {
        path: 'login',
        element: (
          <Suspense fallback={<SuspenseLoader size="large" text="Loading content..." />}>
            <Login />
          </Suspense>
        ),
      },
      {
        path: 'register',
        element: (
          <Suspense fallback={<SuspenseLoader size="large" text="Loading content..." />}>
            <Register />
          </Suspense>
        ),
      },
      {
        path: 'email/verify',
        element: (
          <Suspense fallback={<SuspenseLoader size="large" text="Verifying email..." />}>
            <EmailVerification />
          </Suspense>
        ),
      },
      {
        path: 'password/forgot',
        element: (
          <Suspense fallback={<SuspenseLoader size="large" text="Loading content..." />}>
            <ForgotPassword />
          </Suspense>
        ),
      },
      {
        path: 'password/reset',
        element: (
          <Suspense fallback={<SuspenseLoader size="large" text="Loading content..." />}>
            <ResetPassword />
          </Suspense>
        ),
      },
    ],
  },
]
