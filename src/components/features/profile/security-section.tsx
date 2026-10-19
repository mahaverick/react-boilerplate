import { useId } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { messageFrom } from '@/lib/api-error'
import { toast } from '@/lib/toast'
import { useAuthProviders, useRevokeOtherSessions } from '@/queries/auth.queries'
import { useAuthStore } from '@/states/auth.store'
import type { AuthProviders } from '@/types/api.types'

const PROVIDERS_ERROR = 'We could not load your sign-in methods.'

/** What the other-sessions control says it does. */
const OTHER_SESSIONS_HINT =
  'This ends every other browser and device session. You stay signed in here.'

/**
 * The toast after other sessions were signed out.
 * @param revoked - How many sessions the API ended.
 */
function revokedMessage(revoked: number): string {
  if (revoked === 0) return 'You have no other sessions.'
  return `Signed out ${String(revoked)} other ${revoked === 1 ? 'session' : 'sessions'}.`
}

/** Display names by provider id. An id not listed here shows as itself. */
const PROVIDER_LABELS: Record<string, string> = { google: 'Google' }

/**
 * Sign-in methods and signing out other sessions, for whichever account page
 * hosts it. Signing out other sessions is offered on every account. The heading is `sr-only`: it
 * names the region for assistive tech, and the page's h1 already says Security.
 */
export function SecuritySection() {
  const providers = useAuthProviders()
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="grid gap-6">
      <h2 id={headingId} className="sr-only">
        Security
      </h2>
      <QueryState
        query={providers}
        name="Sign-in methods"
        errorMessage={PROVIDERS_ERROR}
        className="gap-6"
        skeleton={
          <div className="grid gap-6">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-32" />
              <CardRowsSkeleton rows={2} rowHeight="1.25rem" />
            </div>
          </div>
        }
      >
        {(data) => <SignInMethods {...data} />}
      </QueryState>
      <OtherSessions />
    </section>
  )
}

/**
 * The account's sign-in methods. Read-only: the API has no endpoint to unlink
 * a method. "Email link" is always first, because every account has an email
 * address; the 'email' provider row is not listed again.
 */
function SignInMethods({ providers }: AuthProviders) {
  const email = useAuthStore((s) => s.user?.email)
  const linked = providers.filter((link) => link.provider !== 'email')

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Sign-in methods</h3>
      <ItemGroup className="gap-1 has-data-[size=xs]:gap-1">
        <Item size="xs" role="listitem" className="p-0">
          <ItemContent>
            <ItemTitle className="line-clamp-none font-normal">
              Email link
              {email ? (
                <>
                  {' '}
                  (<Pii>{email}</Pii>)
                </>
              ) : null}
            </ItemTitle>
          </ItemContent>
        </Item>
        {linked.map((link) => (
          <Item key={link.provider} size="xs" role="listitem" className="p-0">
            <ItemContent>
              <ItemTitle className="line-clamp-none font-normal">
                {PROVIDER_LABELS[link.provider] ?? link.provider}
              </ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  )
}

/**
 * "Sign out other sessions": one button, confirmed by a toast with the count.
 * A failure shows the server's message.
 */
function OtherSessions() {
  const revokeOthers = useRevokeOtherSessions()
  const hintId = useId()

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Other sessions</h3>
      <p id={hintId} className="text-sm text-muted-foreground">
        {OTHER_SESSIONS_HINT}
      </p>
      <div>
        <BusyButton
          busy={revokeOthers.isPending}
          busyLabel="Signing out…"
          variant="outline"
          aria-describedby={hintId}
          onClick={() => {
            revokeOthers.mutate(undefined, {
              onSuccess: ({ revoked }) => toast.success(revokedMessage(revoked)),
              onError: (error) => toast.error(messageFrom(error)),
            })
          }}
        >
          Sign out other sessions
        </BusyButton>
      </div>
    </div>
  )
}
