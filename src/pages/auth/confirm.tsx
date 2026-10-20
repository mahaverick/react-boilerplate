import '@/lib/zod-jitless'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { SigningInStatus, VerifyFailedPanel } from '@/components/features/auth/link-panels'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { buttonVariants } from '@/components/ui/button'
import { APP_NAME, pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { actionMessageFrom } from '@/lib/action-message'
import { statusFrom } from '@/lib/api-error'
import { isStepUpWaitHeld } from '@/lib/step-up-presence'
import { cn } from '@/lib/utils'
import { useConfirmStepUpLink } from '@/queries/step-up.queries'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where "Confirm it's you" finishes: the emailed link
 * (`/auth/confirm?token=…`). Top level, under neither `_auth` nor `_app`: the
 * link must open signed in, and a signed-out browser must hear where it works.
 * It renders `AuthLayout` itself. `.catch` drops any other value, since the
 * router JSON-parses search values.
 */
export const Route = createFileRoute('/auth/confirm')({
  validateSearch: z.object({
    token: z.string().optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: pageTitle('Confirm it’s you') }] }),
  component: ConfirmPage,
  pendingComponent: AuthPagePending,
})

/** Every state's frame: one `<main>` (AuthLayout) and one `<h1>`. */
function ConfirmCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <AuthLayout>
      <AuthCard title={title} description={description}>
        {children}
      </AuthCard>
    </AuthLayout>
  )
}

/** A full-width link styled as the card's one button. */
function linkButton(): string {
  return cn(buttonVariants(), 'w-full')
}

/** The way back into the app, for a state with nothing left to do here. */
function DashboardLink() {
  return (
    <Link to={ROUTES.dashboard} className={linkButton()}>
      Go to Dashboard
    </Link>
  )
}

/**
 * Picks the state from the emailed link's token. The query is read once, at
 * mount: the link state drops `token` from the URL once it settles, and the
 * outcome must stay on screen.
 */
function ConfirmPage() {
  const search = Route.useSearch()
  const [{ token }] = useState(search)
  if (!token) {
    return (
      <ConfirmCard
        title="This link is incomplete"
        description="Open the most recent confirmation email and use its link."
      />
    )
  }
  return <LinkConfirm token={token} />
}

/**
 * Whether a tab is still waiting to hear the confirmation: the step-up wait
 * lock, or `null` where the browser cannot say.
 */
async function waitingTab(): Promise<boolean | null> {
  // Without BroadcastChannel the waiting tab can never hear, so it is told to retry itself.
  if (typeof BroadcastChannel === 'undefined') return false
  return isStepUpWaitHeld()
}

/** The failures a reload cannot change: the dead link and the ended session. */
const FINAL_FAILURES: ReadonlySet<number | undefined> = new Set([400, 401])

/**
 * Drops `token` from the address bar and this history entry, keeping the rest
 * of the URL, `utm_*` included. The router hears the replace and re-reads its
 * location; the page keeps its outcome because it read the query at mount.
 */
function forgetToken() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('token')) return
  url.searchParams.delete('token')
  // The router's own state object (its key and index) rides along, so Back and Forward keep working.
  window.history.replaceState(window.history.state, '', url.href)
}

/** A verify's settled answer; the page renders from this, never from the mutation's live state. */
type Outcome = { confirmed: true } | { confirmed: false; error: unknown }

/**
 * Confirms an emailed link in the session that asked for it, once per page
 * load. Whether someone is signed in is read once, at mount. Signed out,
 * nothing is posted: the link is bound to a session, and this browser has
 * none. Signed in, a ref-guarded effect posts the token, so StrictMode's
 * second run never spends it twice; Try again posts again on purpose.
 *
 * Each post first asks whether a tab holds the wait lock, before the request
 * leaves: once the broadcast lands, the waiting tab retries and lets go, and a
 * later read would tell a person whose action already ran to try it again.
 *
 * A 400 is the one dead link, whatever its cause (expired, used, or another
 * session's), and leaves the session as it was. A 401 is the
 * session's end: the verify has already refreshed an expired access token
 * once, without the interceptor, so the token never travels into
 * `/login?redirect=`. Anything else leaves the link usable.
 *
 * Once an outcome is final, the token leaves the address bar, so a reload
 * shows the incomplete-link card instead of posting a spent link. A failure
 * that offers Try again keeps it, so a reload tries again.
 */
function LinkConfirm({ token }: { token: string }) {
  const [signedIn] = useState(() => useAuthStore.getState().isAuthenticated)
  const confirm = useConfirmStepUpLink()
  /** The wait lock as it stood before the last post; undefined until that read settles. */
  const [waiting, setWaiting] = useState<boolean | null | undefined>(undefined)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const started = useRef(false)
  // isPending re-renders a tick late, so a second fast Try again would post the token again.
  const inFlight = useRef(false)

  /** Reads the wait lock, then posts the token; the outcome alone decides what shows next. */
  const post = () => {
    if (inFlight.current) return
    inFlight.current = true
    setWaiting(undefined)
    void waitingTab().then(setWaiting)
    confirm.mutate(token, {
      onSuccess: () => {
        forgetToken()
        setOutcome({ confirmed: true })
      },
      onError: (error) => {
        if (FINAL_FAILURES.has(statusFrom(error))) forgetToken()
        setOutcome({ confirmed: false, error })
      },
      onSettled: () => {
        inFlight.current = false
      },
    })
  }

  const start = useEffectEvent(() => {
    if (signedIn) post()
  })

  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  }, [])

  if (!signedIn) {
    return (
      <ConfirmCard
        title="Sign in to confirm"
        description="This link works only in the browser and session that asked for it. If you signed out here, sign in and repeat the action."
      >
        <Link to={ROUTES.login} className={linkButton()}>
          Sign in
        </Link>
      </ConfirmCard>
    )
  }

  if (outcome?.confirmed && waiting !== undefined) return <Confirmed waiting={waiting} />

  if (outcome && !outcome.confirmed) {
    const status = statusFrom(outcome.error)
    if (status === 400) {
      return (
        <ConfirmCard
          title="This link didn’t confirm it’s you"
          description="Open the link in the browser where you asked for it, within 15 minutes. For a new link, try the action again."
        />
      )
    }
    if (status === 401) {
      return (
        <ConfirmCard
          title="Your session ended"
          description="Sign in again, then repeat the action."
        >
          {/* A full load, not a router link: it re-runs the session restore, while a store still signed in would be bounced to the dashboard by `_auth`. */}
          <a href={ROUTES.login} className={linkButton()}>
            Sign in
          </a>
        </ConfirmCard>
      )
    }
    return (
      <ConfirmCard title="We couldn’t confirm it’s you">
        <VerifyFailedPanel
          message={actionMessageFrom(outcome.error)}
          retrying={confirm.isPending}
          onRetry={post}
        />
      </ConfirmCard>
    )
  }

  return (
    <ConfirmCard title="Confirming it’s you">
      <SigningInStatus label="Confirming it’s you…" />
    </ConfirmCard>
  )
}

/**
 * The confirmed card, worded by whether a tab was waiting: that tab retries
 * the action itself, a closed one cannot, and without Web Locks the page
 * cannot tell which.
 */
function Confirmed({ waiting }: { waiting: boolean | null }) {
  if (waiting === true)
    return <ConfirmCard title="Confirmed" description="You can close this tab." />
  if (waiting === false) {
    return (
      <ConfirmCard
        title="Confirmed"
        description={`Go back to ${APP_NAME} and try the action again.`}
      >
        <DashboardLink />
      </ConfirmCard>
    )
  }
  return (
    <ConfirmCard
      title="Confirmed"
      description={`Return to the ${APP_NAME} tab where you started. If you closed it, try the action again.`}
    />
  )
}
