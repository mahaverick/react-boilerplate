import { createFileRoute } from '@tanstack/react-router'
import { RouteNotFound } from '@/components/features/route-not-found'
import { MAIN_CONTENT_ID } from '@/components/features/skip-link'
import { pageTitle } from '@/constants/app'

export const Route = createFileRoute('/$')({
  head: () => ({ meta: [{ title: pageTitle('Page not found') }] }),
  // This splat route matches when nothing else does, so — unlike a page
  // nested under `_app` or `_auth` — nothing upstream rendered a layout, and
  // so no `<main>`. This route supplies its own, the way `AppLayout` and
  // `AuthLayout` do for pages that DO match, so a mistyped URL still lands
  // on a page with exactly one main landmark. `RouteNotFound` itself stays
  // bare: it also serves as `defaultNotFoundComponent`, which renders in
  // place of a MATCHED route's own component when that route throws
  // `notFound()` — inside whichever layout already matched, which already
  // has a `<main>`. Wrapping `RouteNotFound` itself as well would double it.
  component: () => (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
      <RouteNotFound />
    </main>
  ),
})
