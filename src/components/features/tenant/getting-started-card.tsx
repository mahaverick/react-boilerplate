import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleCheckIcon, CircleIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { canManageTenant, type MembershipRole } from '@/constants/roles'
import { useFocusAfter, type FocusAfter } from '@/hooks/use-focus-after'
import { messageFrom } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { analyticsKey, track, type AnalyticsKey } from '@/observability/analytics'
import { useVariant } from '@/observability/flags/flag-hooks'
import {
  tenantOnboardingQueryOptions,
  useCompleteOnboardingStep,
  useDismissOnboarding,
  useTenantOnboarding,
  useUndismissOnboarding,
} from '@/queries/onboarding.queries'
import type { OnboardingStepView, TenantAccess, TenantOnboarding } from '@/types/api.types'

/** How long "You're all set" stays after the last required step, derived from `completedAt`. */
const ALL_SET_WINDOW_MS = 24 * 60 * 60 * 1000

/** Said to a member who cannot do a step an owner or admin can. */
const OWNER_OR_ADMIN = 'An owner or admin can do this'

/**
 * Where the steps the default registry completes from a page get done, and the
 * analytics key a click on the link sends. Any other step key gets no link.
 */
const STEP_LINKS: ReadonlyMap<
  string,
  { to: '/tenants/$slug/settings' | '/tenants/$slug/members'; label: string; cta: AnalyticsKey }
> = new Map([
  [
    'configure_settings',
    {
      to: '/tenants/$slug/settings',
      label: 'Open settings',
      cta: analyticsKey('onboarding_open_settings'),
    },
  ],
  [
    'invite_teammate',
    {
      to: '/tenants/$slug/members',
      label: 'Open members',
      cta: analyticsKey('onboarding_open_members'),
    },
  ],
])

/** The focus targets this card moves between when an action replaces its own button. */
type CardFocusKey = 'card' | 'all-set' | 'show' | `step:${string}`
type CardFocus = FocusAfter<CardFocusKey>

/** What the viewer may do here: staff through platform access may read, never act. */
interface Viewer {
  /** A real membership, not platform access. */
  isMember: boolean
  /** Owner or admin by membership, so the linked pages are theirs to change. */
  canManage: boolean
  /** Owner by membership: dismiss and undo. */
  isOwner: boolean
}

function viewerFor(role: MembershipRole, access: TenantAccess): Viewer {
  const isMember = access === 'member'
  return {
    isMember,
    canManage: isMember && canManageTenant(role),
    isOwner: isMember && role === 'owner',
  }
}

/** Whether a complete checklist finished recently enough to say so. */
function isRecentlyComplete(onboarding: TenantOnboarding, now: number): boolean {
  if (onboarding.completedAt === null) return false
  const completedAt = new Date(onboarding.completedAt).getTime()
  return !Number.isNaN(completedAt) && now - completedAt < ALL_SET_WINDOW_MS
}

/** Done or not, as an icon with its text equivalent: there is no checkbox, since nothing here toggles. */
function StepMarker({ isDone }: { isDone: boolean }) {
  return (
    <span className="mt-0.5 shrink-0">
      {isDone ? (
        <CircleCheckIcon aria-hidden="true" className="size-5 text-primary" />
      ) : (
        <CircleIcon aria-hidden="true" className="size-5 text-muted-foreground" />
      )}
      <span className="sr-only">{isDone ? 'Done' : 'Not done'}</span>
    </span>
  )
}

/**
 * Mark done for a manual step. `mutateAsync`, because the refetch on settle
 * replaces this button with the done marker, and `mutate`'s callbacks skip an
 * unmounted observer. Focus goes to the step's title while the checklist is
 * still in progress; when this was the last required step the checklist is
 * replaced by "You're all set", so it goes to that card's heading instead (and
 * nowhere when that card renders nothing, which takes a `completedAt` over a
 * day old).
 */
function MarkDoneButton({
  slug,
  step,
  focus,
}: {
  slug: string
  step: OnboardingStepView
  focus: CardFocus
}) {
  const complete = useCompleteOnboardingStep(slug)
  const queryClient = useQueryClient()
  return (
    <Button
      variant="outline"
      size="sm"
      className="justify-self-start"
      disabled={complete.isPending}
      aria-label={`Mark done: ${step.title}`}
      onClick={() => {
        complete.mutateAsync(step.key).then(
          () => {
            // The refetch has settled, so the cache says which card the step led to.
            const state = queryClient.getQueryData(
              tenantOnboardingQueryOptions(slug).queryKey
            )?.state
            focus.focusAfter(state === 'in_progress' ? `step:${step.key}` : 'all-set')
            toast.success(`“${step.title}” marked done.`)
          },
          (error: unknown) => toast.error(messageFrom(error))
        )
      }}
    >
      Mark done
    </Button>
  )
}

/** A step's link, as `STEP_LINKS` describes it. */
type StepLinkTarget = NonNullable<ReturnType<(typeof STEP_LINKS)['get']>>

/**
 * A step's call to action, styled by the `example_cta_experiment` variant:
 * an underlined link for `control`, a filled button for `bold`. Reading the
 * variant here, where the link renders, reports the exposure only for a
 * viewer who sees a link. A click sends `feature_cta_clicked`, the
 * experiment's metric, which carries `$feature/example_cta_experiment`.
 */
function StepLink({ slug, link }: { slug: string; link: StepLinkTarget }) {
  const variant = useVariant('example_cta_experiment')
  return (
    <Link
      to={link.to}
      params={{ slug }}
      className={cn(
        'justify-self-start',
        variant === 'bold'
          ? buttonVariants({ size: 'sm' })
          : 'text-sm font-medium underline underline-offset-4'
      )}
      onClick={() => track('feature_cta_clicked', { cta: link.cta })}
    >
      {link.label}
    </Link>
  )
}

/**
 * The one thing a pending step offers this viewer: Mark done for a manual
 * step, a link for an auto step the viewer can do from another page, the
 * reason when they cannot, and nothing for a step that completes on its own.
 */
function StepAction({
  slug,
  step,
  viewer,
  focus,
}: {
  slug: string
  step: OnboardingStepView
  viewer: Viewer
  focus: CardFocus
}) {
  if (step.completedAt !== null || !viewer.isMember) return null
  if (step.kind === 'manual') {
    // A tenant-scoped manual step changes the tenant for everyone, so the API wants an owner or admin.
    if (step.scope === 'tenant' && !viewer.canManage) {
      return <p className="text-sm text-muted-foreground">{OWNER_OR_ADMIN}</p>
    }
    return <MarkDoneButton slug={slug} step={step} focus={focus} />
  }
  const link = STEP_LINKS.get(step.key)
  if (!link) return null
  if (!viewer.canManage) return <p className="text-sm text-muted-foreground">{OWNER_OR_ADMIN}</p>
  return <StepLink slug={slug} link={link} />
}

function StepItem({
  slug,
  step,
  viewer,
  focus,
}: {
  slug: string
  step: OnboardingStepView
  viewer: Viewer
  focus: CardFocus
}) {
  return (
    <li className="flex gap-3 rounded-lg border p-4">
      <StepMarker isDone={step.completedAt !== null} />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            ref={focus.target(`step:${step.key}`)}
            tabIndex={-1}
            className="font-medium outline-none"
          >
            {step.title}
          </span>
          {!step.required && <Badge variant="outline">Optional</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{step.description}</p>
        <StepAction slug={slug} step={step} viewer={viewer} focus={focus} />
      </div>
    </li>
  )
}

/** Dismiss, behind a confirmation, since it hides the checklist for every member. */
function DismissButton({ slug, focus }: { slug: string; focus: CardFocus }) {
  const dismiss = useDismissOnboarding(slug)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Dismiss
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dismiss getting started?</AlertDialogTitle>
          <AlertDialogDescription>
            The checklist is hidden for everyone in this tenant. An owner can show it again from
            this page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={dismiss.isPending}
            onClick={() => {
              dismiss.mutateAsync().then(
                () => {
                  setIsOpen(false)
                  focus.focusAfter('show')
                  toast.success('Getting started dismissed.')
                },
                (error: unknown) => {
                  setIsOpen(false)
                  toast.error(messageFrom(error))
                }
              )
            }}
          >
            Dismiss
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The owner's way back from a dismissal; nobody else sees anything while dismissed. */
function ShowGettingStarted({ slug, focus }: { slug: string; focus: CardFocus }) {
  const undismiss = useUndismissOnboarding(slug)
  return (
    <section
      aria-label="Getting started"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
    >
      <p className="text-sm text-muted-foreground">Getting started is hidden for this tenant.</p>
      <Button
        variant="outline"
        size="sm"
        ref={focus.target('show')}
        disabled={undismiss.isPending}
        onClick={() => {
          undismiss.mutateAsync().then(
            () => {
              focus.focusAfter('card')
              toast.success('Getting started shown.')
            },
            (error: unknown) => toast.error(messageFrom(error))
          )
        }}
      >
        Show getting started
      </Button>
    </section>
  )
}

function AllSetCard({ focus }: { focus: CardFocus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={focus.target('all-set')} tabIndex={-1} className="outline-none">
            You’re all set
          </h2>
        </CardTitle>
        <CardDescription>Every required getting started step is done.</CardDescription>
      </CardHeader>
    </Card>
  )
}

/**
 * The in-progress checklist. It sends `onboarding_checklist_opened` once per
 * mount: marking a step done changes the counts, not whether it was opened.
 */
function ChecklistCard({
  slug,
  onboarding,
  viewer,
  focus,
}: {
  slug: string
  onboarding: TenantOnboarding
  viewer: Viewer
  focus: CardFocus
}) {
  const hasTracked = useRef(false)
  const { requiredDone, requiredTotal } = onboarding

  useEffect(() => {
    if (hasTracked.current) return
    hasTracked.current = true
    track('onboarding_checklist_opened', {
      required_done: requiredDone,
      required_total: requiredTotal,
    })
  }, [requiredDone, requiredTotal])

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={focus.target('card')} tabIndex={-1} className="outline-none">
            Getting started
          </h2>
        </CardTitle>
        <CardDescription>
          {onboarding.requiredDone} of {onboarding.requiredTotal} required
        </CardDescription>
        {viewer.isOwner && (
          <CardAction>
            <DismissButton slug={slug} focus={focus} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {onboarding.steps.map((step) => (
            <StepItem key={step.key} slug={slug} step={step} viewer={viewer} focus={focus} />
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * The tenant overview's Getting started checklist, rendering the steps the
 * server registry serves in its order. In progress: the checklist. Complete:
 * "You're all set" for 24 hours after the last required step, then nothing.
 * Dismissed: the owner's undo, nothing for anyone else. Not tracked: nothing.
 *
 * Renders nothing while loading or when the first load fails: an API older
 * than 1.4.0 answers this route 404, and the overview below is the tab's content.
 * `role` and `access` come from `useMyRole`, so staff through platform access
 * read the checklist and act on nothing. The 24-hour window is measured from
 * the mount time, read once, because render must stay pure.
 */
export function GettingStartedCard({
  slug,
  role,
  access,
}: {
  slug: string
  role: MembershipRole
  access: TenantAccess
}) {
  const onboarding = useTenantOnboarding(slug)
  const [mountedAt] = useState(() => Date.now())
  const focus = useFocusAfter<CardFocusKey>()
  if (!onboarding.data) return null

  const viewer = viewerFor(role, access)
  switch (onboarding.data.state) {
    case 'in_progress':
      return (
        <ChecklistCard slug={slug} onboarding={onboarding.data} viewer={viewer} focus={focus} />
      )
    case 'complete':
      return isRecentlyComplete(onboarding.data, mountedAt) ? <AllSetCard focus={focus} /> : null
    case 'dismissed':
      return viewer.isOwner ? <ShowGettingStarted slug={slug} focus={focus} /> : null
    case 'not_tracked':
      return null
  }
}
