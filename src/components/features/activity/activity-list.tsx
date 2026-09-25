import type { ReactNode } from 'react'
import { LoadError } from '@/components/features/load-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { actorName, auditSentence } from '@/constants/audit-actions'
import { absoluteTime, relativeTime } from '@/lib/relative-time'
import type { AuditEntry } from '@/types/api.types'

/** Said of the request, not of the log: a failed load is not an empty one. */
const ACTIVITY_ERROR =
  'We could not load the activity, so none is listed here. This is not a sign that there is none.'
const MORE_ERROR =
  'We could not load more activity. What is listed above is correct, but it may not be all of it.'
/**
 * `staleTime: 0` (audit.queries.ts) makes a background refetch of the pages
 * already loaded common, and that failure is not the same event as a failed
 * "Load more": nothing new was being appended, so what's on screen is not
 * necessarily complete or current, but it is not wrong either.
 */
const REFETCH_ERROR = 'We could not refresh the activity. What is listed above may be out of date.'

export interface ActivityListProps<T extends AuditEntry> {
  entries: T[]
  isPending: boolean
  isError: boolean
  onRetry: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** True only when the FAILED fetch was a next-page one, not a refetch of an already-loaded page. */
  isFetchNextPageError: boolean
  onLoadMore: () => void
  /** Filters decide whether "nothing has happened" is true, so the page says it. */
  emptyMessage: string
  /** The tenant, for the platform-wide view. Omitted inside a tenant. */
  renderTenant?: (entry: T) => ReactNode
}

function ActivityRow<T extends AuditEntry>({
  entry,
  renderTenant,
}: {
  entry: T
  renderTenant?: (entry: T) => ReactNode
}) {
  const absolute = absoluteTime(entry.occurredAt)
  return (
    <li className="grid gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{actorName(entry.actor)}</span>
        {entry.access === 'platform' && <Badge variant="outline">Staff</Badge>}
        {renderTenant && <span>in {renderTenant(entry)}</span>}
      </div>
      <p className="text-sm">{auditSentence(entry)}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {entry.actor && entry.actor.name !== '' && (
          <span className="break-all">{entry.actor.email}</span>
        )}
        {/* Base UI's Tooltip is not announced, so the absolute time is also
            in the trigger's own text, visually hidden. */}
        <Tooltip>
          <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
            <time dateTime={entry.occurredAt}>{relativeTime(entry.occurredAt)}</time>
            <span className="sr-only">, {absolute}</span>
          </TooltipTrigger>
          <TooltipContent>{absolute}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  )
}

/**
 * An audit log, newest first: one tenant's (the Activity tab) or every
 * tenant's (the platform page). The same states as every list here: in
 * flight, failed, empty, and loaded with a keyboard-reachable Load more.
 */
export function ActivityList<T extends AuditEntry>({
  entries,
  isPending,
  isError,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
  emptyMessage,
  renderTenant,
}: ActivityListProps<T>) {
  if (isPending) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  // The error branch BEFORE the empty one: `[]` is what both look like.
  if (entries.length === 0) {
    return isError ? (
      <LoadError message={ACTIVITY_ERROR} onRetry={onRetry} />
    ) : (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    )
  }

  return (
    <div className="grid gap-3">
      <ul aria-label="Activity" className="divide-y">
        {entries.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} renderTenant={renderTenant} />
        ))}
      </ul>
      {isFetchNextPageError ? (
        <LoadError message={MORE_ERROR} onRetry={onLoadMore} />
      ) : (
        isError && <LoadError message={REFETCH_ERROR} onRetry={onRetry} />
      )}
      {hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={isFetchingNextPage}
          onClick={onLoadMore}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more activity'}
        </Button>
      )}
    </div>
  )
}
