import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
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

/**
 * The router-wide error screen, for any route without its own `errorComponent`.
 * A chunk that failed to load offers a reload, since only a reload picks up a
 * new deploy's file names. Try again calls `router.invalidate()`, which re-runs
 * the loaders and replaces the failed match, then `reset()`. The error's own
 * message is shown in development only: in production it can carry server or
 * stack detail that means nothing to the reader.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()

  if (isChunkLoadError(error)) {
    return (
      <RouteErrorCard
        title="A new version is available"
        description="This page was built before the latest update. Reload to get the new version."
      >
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </RouteErrorCard>
    )
  }

  async function retry() {
    await router.invalidate()
    reset()
  }

  return (
    <RouteErrorCard
      title="Something went wrong"
      description="This page could not be shown. Try again, or go back to the start."
      detail={import.meta.env.DEV && error instanceof Error ? error.message : undefined}
    >
      <Button onClick={() => void retry()}>Try again</Button>
      <Link to={ROUTES.home} className={buttonVariants({ variant: 'outline' })}>
        Go home
      </Link>
    </RouteErrorCard>
  )
}

function RouteErrorCard({
  title,
  description,
  detail,
  children,
}: {
  title: string
  description: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="flex justify-center px-4 py-16">
      <Card role="alert" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>{title}</h1>
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
