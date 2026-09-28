import { createFileRoute } from '@tanstack/react-router'
import { RouteNotFound } from '@/components/features/route-not-found'
import { MAIN_CONTENT_ID } from '@/components/features/skip-link'
import { pageTitle } from '@/constants/app'

/**
 * The splat route, for a URL nothing else matches. No layout rendered above
 * it, so it supplies its own `<main>`. `RouteNotFound` stays bare because it
 * is also `defaultNotFoundComponent`, rendered inside a matched layout that
 * already has one.
 */
export const Route = createFileRoute('/$')({
  head: () => ({ meta: [{ title: pageTitle('Page not found') }] }),
  component: () => (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
      <RouteNotFound />
    </main>
  ),
})
