import { createFileRoute } from '@tanstack/react-router'

// STUB — Task 5 replaces this file wholesale with the real login page.
// It exists now because the route generator refuses a pathless layout route
// with no children: `_auth`'s full path collapses to "/", which collides with
// `_app`'s and with index.tsx ("Conflicting configuration paths ... '/'").
// One child per layout is the minimum that generates. It is also what makes
// `redirect({ to: ROUTES.login })` a typed target in _app and index.
export const Route = createFileRoute('/_auth/login')({})
