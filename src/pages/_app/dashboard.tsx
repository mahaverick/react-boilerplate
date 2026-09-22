import { createFileRoute } from '@tanstack/react-router'

// STUB — Task 6 replaces this file wholesale with the real dashboard.
// Same reason as src/pages/_auth/login.tsx: a childless pathless layout route
// cannot be generated, and `redirect({ to: ROUTES.dashboard })` needs a typed
// target to point at.
export const Route = createFileRoute('/_app/dashboard')({})
