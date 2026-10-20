import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ROUTES } from '@/constants/routes'
import { isChunkLoadError } from '@/lib/chunk-load-error'
import { noteError } from '@/observability/errors'

/**
 * The router-wide error screen, for any route without its own `errorComponent`.
 * A chunk that failed to load offers a reload, since only a reload picks up a
 * new deploy's file names. Any other error offers Try again, which runs
 * `router.invalidate()` to re-run the loaders, then `reset()`. The error's own
 * message is shown in development only: in production it can carry server or
 * stack detail that means nothing to the reader. The error is noted on mount
 * because a loader error can reach this screen without passing React's root
 * error hooks; `noteError` ignores one those hooks already noted. The title
 * is an `h1` unless `heading` says otherwise (see `SettingsRouteError`).
 */
export function RouteError({
  error,
  reset,
  heading = 'h1',
}: ErrorComponentProps & { heading?: RouteErrorHeading }) {
  const router = useRouter()

  useEffect(() => {
    noteError(error, isChunkLoadError(error) ? 'chunk_load' : 'router', true)
  }, [error])

  if (isChunkLoadError(error)) {
    return (
      <RouteErrorCard
        heading={heading}
        title="A new version is available"
        description="Reload to get the latest version."
      >
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </RouteErrorCard>
    )
  }

  /** Try again: clears the error boundary only after the loaders have re-run. */
  async function retry() {
    await router.invalidate()
    reset()
  }

  return (
    <RouteErrorCard
      heading={heading}
      title="This page didn’t load"
      description="Try again, or go home."
      detail={import.meta.env.DEV && error instanceof Error ? error.message : undefined}
    >
      <Button onClick={() => void retry()}>Try again</Button>
      <Link to={ROUTES.home} className={buttonVariants({ variant: 'outline' })}>
        Go home
      </Link>
    </RouteErrorCard>
  )
}

/** The error screen for a route under a layout that owns the page's h1: the same screen, titled `h2`. */
export function SettingsRouteError(props: ErrorComponentProps) {
  return <RouteError {...props} heading="h2" />
}

/** The level the error screen's title takes: `h1` when it is the page, `h2` under a layout's `h1`. */
type RouteErrorHeading = 'h1' | 'h2'

/** The shared frame of both error screens, so the reload and retry variants look alike; `detail` is shown only in development. */
function RouteErrorCard({
  heading: Heading,
  title,
  description,
  detail,
  children,
}: {
  heading: RouteErrorHeading
  title: string
  description: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="flex justify-center px-4 py-16">
      {/* Capped: a standalone centred card. */}
      <Card role="alert" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Heading>{title}</Heading>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {detail && (
          <CardContent>
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {detail}
            </pre>
          </CardContent>
        )}
        <CardFooter className="gap-2">{children}</CardFooter>
      </Card>
    </div>
  )
}
