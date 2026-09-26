import { Link } from '@tanstack/react-router'
import { MAIN_CONTENT_ID } from '@/components/features/skip-link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES } from '@/constants/routes'

/**
 * The router-wide screen for a URL that matches no route.
 *
 * `defaultNotFoundComponent` fires for a URL with no matching route at all,
 * so — unlike a page nested under `_app` or `_auth` — nothing upstream has
 * rendered a layout, and so no `<main>`. It carries its own, exactly like
 * `AppLayout` and `AuthLayout` do for the pages that DO match a route, so a
 * mistyped URL still lands on a page with exactly one main landmark.
 */
export function RouteNotFound() {
  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
      <div className="flex justify-center px-4 py-16">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              <h1>Page not found</h1>
            </CardTitle>
            <CardDescription>
              The address may be mistyped, or the page may have moved.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            {/* `/` sends a signed-in reader to the dashboard and anyone else to sign-in. */}
            <Link to={ROUTES.home} className={buttonVariants({ variant: 'outline' })}>
              Go home
            </Link>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
