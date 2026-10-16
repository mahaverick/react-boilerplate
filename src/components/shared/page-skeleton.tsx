/**
 * @file The route templates: what a route shows while it is pending (the
 * router waits `defaultPendingMs` before showing one). Five page shapes, each
 * at the sizes the boot shell in index.html draws, so a template replaces the
 * shell without a jump, and the named pending components the routes use.
 */
import type { ReactNode } from 'react'
import {
  CardRowsSkeleton,
  FormFieldsSkeleton,
  KpiCardSkeleton,
  TableRowsSkeleton,
} from '@/components/shared/section-skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** The page shapes a route can be pending as. */
export type PageVariant = 'list' | 'detail' | 'dashboard' | 'settings' | 'auth'

/** A page shape, and whether a layout above already draws its heading and tabs. */
interface PageSkeletonProps {
  variant: PageVariant
  /** Leave out the heading, subtitle and tab bar, which the layout route already shows. */
  nested?: boolean
}

/** The page's heading bar (2rem × 12rem, as the shell's), with a subtitle bar on detail and settings pages. */
function Heading({ subtitle }: { subtitle: boolean }) {
  return (
    <div data-slot="page-heading-skeleton" className="grid gap-2">
      <Skeleton className="h-8 w-48" />
      {subtitle && <Skeleton className="h-4 w-40" />}
    </div>
  )
}

/** A card with a title bar over `children`. */
function CardSkeleton({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * A page-shaped skeleton: `list` (heading, a search and two filter controls,
 * eight table rows), `detail` (heading, subtitle, tab bar, two cards),
 * `dashboard` (heading, four KPI cards, two chart blocks) or `settings`
 * (heading, subtitle, three cards of form rows) or `auth` (no heading; the
 * sign-in card: title, subtitle, two fields, a button). One `role="status"`
 * region named "Loading", and no spinner.
 */
export function PageSkeleton({ variant, nested = false }: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      data-variant={variant}
      data-nested={nested}
      className="grid gap-4"
    >
      {!nested && variant !== 'auth' && (
        <Heading subtitle={variant === 'detail' || variant === 'settings'} />
      )}
      {variant === 'list' && (
        <>
          <div data-slot="page-toolbar-skeleton" className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-full max-w-xs" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
          <TableRowsSkeleton rows={8} columns={4} />
        </>
      )}
      {variant === 'detail' && (
        <>
          {!nested && (
            <div data-slot="page-tabs-skeleton" className="flex gap-2 border-b pb-2">
              {[0, 1, 2, 3].map((tab) => (
                <Skeleton key={tab} className="h-6 w-20" />
              ))}
            </div>
          )}
          {[0, 1].map((card) => (
            <CardSkeleton key={card}>
              <CardRowsSkeleton rows={3} />
            </CardSkeleton>
          ))}
        </>
      )}
      {variant === 'dashboard' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((card) => (
              <KpiCardSkeleton key={card} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {[0, 1].map((chart) => (
              <Skeleton key={chart} data-slot="page-chart-skeleton" className="h-74 rounded-xl" />
            ))}
          </div>
        </>
      )}
      {variant === 'settings' &&
        [0, 1, 2].map((card) => (
          <CardSkeleton key={card}>
            <FormFieldsSkeleton fields={2} />
          </CardSkeleton>
        ))}
      {variant === 'auth' && (
        <Card className="mx-auto w-full max-w-sm">
          <CardContent className="grid gap-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
            <FormFieldsSkeleton fields={2} action={false} />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** The router-wide pending template: a list page. */
export function ListPending() {
  return <PageSkeleton variant="list" />
}

/** A detail layout route's pending template. */
export function DetailPending() {
  return <PageSkeleton variant="detail" />
}

/** A tab's pending template, under a detail layout that already draws the heading and tabs. */
export function DetailTabPending() {
  return <PageSkeleton variant="detail" nested />
}

/** A dashboard route's pending template. */
export function DashboardPending() {
  return <PageSkeleton variant="dashboard" />
}

/** The settings layout's pending template. */
export function SettingsPending() {
  return <PageSkeleton variant="settings" />
}

/** A settings page's pending template, under the settings layout's own heading. */
export function SettingsPagePending() {
  return <PageSkeleton variant="settings" nested />
}

/** An auth page's pending template: the sign-in card's shape. */
export function AuthPending() {
  return <PageSkeleton variant="auth" />
}
