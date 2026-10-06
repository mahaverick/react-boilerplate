import { Wrench } from 'lucide-react'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'

/** What the page says when the owner's message has not arrived yet. */
export const DEFAULT_MAINTENANCE_MESSAGE = 'We’re carrying out scheduled maintenance.'

/**
 * The screen that replaces every route while maintenance is `full`, the
 * sign-in and sign-up pages included. The owner's message is rendered as
 * text, never as markup. It has its own skip link, `main` and `h1`, since it
 * stands in for a whole layout. Nothing here navigates: the session and the URL are
 * kept, and the app returns to the page underneath when the mode ends.
 */
export function MaintenancePage({
  message,
  since,
}: {
  message: string | null
  since: string | null
}) {
  const started = since ? formatDateTime(since) : null

  return (
    <>
      <SkipLink />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex min-h-svh items-center justify-center bg-background p-4 outline-none sm:p-6"
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            <Wrench aria-hidden="true" className="mb-2 size-6 text-muted-foreground" />
            <CardTitle>
              <h1>We’ll be back soon</h1>
            </CardTitle>
            {started && <CardDescription>Maintenance started {started}.</CardDescription>}
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <p className="whitespace-pre-line">{message ?? DEFAULT_MAINTENANCE_MESSAGE}</p>
            <p className="text-muted-foreground">This page will refresh when we’re back.</p>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
