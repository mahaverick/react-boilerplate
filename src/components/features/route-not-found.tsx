import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES } from '@/constants/routes'

/** The router-wide screen for a URL that matches no route. */
export function RouteNotFound() {
  return (
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
  )
}
