import { Link } from '@tanstack/react-router'
import { CircleCheckIcon, CircleIcon } from 'lucide-react'
import { useState } from 'react'
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
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { canManageTenant, type MembershipRole } from '@/constants/roles'
import { messageFrom } from '@/lib/api-error'
import {
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

/** Where the steps the default registry completes from a page get done. Any other step key gets no link. */
const STEP_LINKS: ReadonlyMap<
  string,
  { to: '/tenants/$slug/settings' | '/tenants/$slug/members'; label: string }
> = new Map([
  ['configure_settings', { to: '/tenants/$slug/settings', label: 'Open settings' }],
  ['invite_teammate', { to: '/tenants/$slug/members', label: 'Open members' }],
])

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
 * unmounted observer.
 */
function MarkDoneButton({ slug, step }: { slug: string; step: OnboardingStepView }) {
  const complete = useCompleteOnboardingStep(slug)
  return (
    <Button
      variant="outline"
      size="sm"
      className="justify-self-start"
      disabled={complete.isPending}
      aria-label={`Mark “${step.title}” done`}
      onClick={() => {
        complete.mutateAsync(step.key).then(
          () => toast.success(`“${step.title}” marked done.`),
          (error: unknown) => toast.error(messageFrom(error))
        )
      }}
    >
      Mark done
    </Button>
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
}: {
  slug: string
  step: OnboardingStepView
  viewer: Viewer
}) {
  if (step.completedAt !== null || !viewer.isMember) return null
  if (step.kind === 'manual') return <MarkDoneButton slug={slug} step={step} />
  const link = STEP_LINKS.get(step.key)
  if (!link) return null
  if (!viewer.canManage) return <p className="text-sm text-muted-foreground">{OWNER_OR_ADMIN}</p>
  return (
    <Link
      to={link.to}
      params={{ slug }}
      className="justify-self-start text-sm font-medium underline underline-offset-4"
    >
      {link.label}
    </Link>
  )
}

function StepItem({
  slug,
  step,
  viewer,
}: {
  slug: string
  step: OnboardingStepView
  viewer: Viewer
}) {
  return (
    <li className="flex gap-3 rounded-lg border p-4">
      <StepMarker isDone={step.completedAt !== null} />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{step.title}</span>
          {!step.required && <Badge variant="outline">Optional</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{step.description}</p>
        <StepAction slug={slug} step={step} viewer={viewer} />
      </div>
    </li>
  )
}

/** Dismiss, behind a confirmation, since it hides the checklist for every member. */
function DismissButton({ slug }: { slug: string }) {
  const dismiss = useDismissOnboarding(slug)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={dismiss.isPending}>
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
function ShowGettingStarted({ slug }: { slug: string }) {
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
        disabled={undismiss.isPending}
        onClick={() => {
          undismiss.mutateAsync().then(
            () => undefined,
            (error: unknown) => toast.error(messageFrom(error))
          )
        }}
      >
        Show getting started
      </Button>
    </section>
  )
}

function AllSetCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>You’re all set</h2>
        </CardTitle>
        <CardDescription>Every required getting started step is done.</CardDescription>
      </CardHeader>
    </Card>
  )
}

function ChecklistCard({
  slug,
  onboarding,
  viewer,
}: {
  slug: string
  onboarding: TenantOnboarding
  viewer: Viewer
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Getting started</h2>
        </CardTitle>
        <CardDescription>
          {onboarding.requiredDone} of {onboarding.requiredTotal} required
        </CardDescription>
        {viewer.isOwner && (
          <CardAction>
            <DismissButton slug={slug} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {onboarding.steps.map((step) => (
            <StepItem key={step.key} slug={slug} step={step} viewer={viewer} />
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
  if (!onboarding.data) return null

  const viewer = viewerFor(role, access)
  switch (onboarding.data.state) {
    case 'in_progress':
      return <ChecklistCard slug={slug} onboarding={onboarding.data} viewer={viewer} />
    case 'complete':
      return isRecentlyComplete(onboarding.data, mountedAt) ? <AllSetCard /> : null
    case 'dismissed':
      return viewer.isOwner ? <ShowGettingStarted slug={slug} /> : null
    case 'not_tracked':
      return null
  }
}
