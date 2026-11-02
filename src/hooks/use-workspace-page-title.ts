import { useEffect } from 'react'
import { pageTitle } from '@/constants/app'
import { sendTitleAs } from '@/observability/telemetry/sent-title'
import { useTenant } from '@/queries/tenant.queries'

/**
 * Puts the workspace's name in a workspace page's document title: `Members`
 * in Acme Corp becomes `Members · Acme Corp · React Boilerplate`.
 *
 * The route's `head` gives the page name alone (`Members · React
 * Boilerplate`), never the slug: `head` runs before the page renders and
 * cannot wait for the tenant read without holding the navigation, and reading
 * the query cache there would pull `tenant.queries` into chunks of its own on
 * first visit (pnpm check:bundle). This hook writes the full title once the
 * name is known, and again after a rename, and registers the page-only title
 * as what analytics sends in its place (`sendTitleAs`): a workspace name is
 * customer text, which events never carry (SECURITY.md). Pages render only inside
 * `TenantGate`, so the name is there by the first effect.
 *
 * On unmount, or when the name changes, it puts back the `head` title, but
 * only if the document still shows this hook's title: moving to another
 * workspace's Members page keeps the same `head` title, so the router would
 * not replace the old name, while a page with a different title has already
 * replaced it and must not be overwritten.
 * @param page - The page's name, as its route's `head` gives it.
 * @param slug - The workspace's slug.
 */
export function useWorkspacePageTitle(page: string, slug: string): void {
  const name = useTenant(slug).data?.name
  const title = name ? pageTitle(`${page} · ${name}`) : undefined
  useEffect(() => {
    if (!title) return
    sendTitleAs(title, pageTitle(page))
    document.title = title
    // The next workspace's page has the same `head` title, so the router does not rewrite it: put it back.
    return () => {
      if (document.title === title) document.title = pageTitle(page)
    }
  }, [page, title])
}
