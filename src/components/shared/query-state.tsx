/**
 * @file One query-backed section's states, in one place, so no section
 * renders nothing: the skeleton until data arrives, a role refusal, a
 * retryable error, an empty state, or the content inside its own render
 * boundary.
 */
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { SectionBoundary } from '@/components/shared/section-boundary'
import { isRoleDenied } from '@/lib/role-denied'
import { cn } from '@/lib/utils'

/** One section: its query, what it shows in each state, and its name. */
interface QueryStateProps<T> {
  query: UseQueryResult<T>
  /** Shown until the first data arrives, sized like the content. */
  skeleton: ReactNode
  /** Treat this value as empty and render `empty`. */
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  /** Section name, for the boundary and LoadError copy. */
  name: string
  /** LoadError's message, where the section has its own; `{name} didn’t load. Try again.` otherwise. */
  errorMessage?: string
  className?: string
  children: (data: T) => ReactNode
}

/** Throws `error` while rendering, so the `SectionBoundary` around it catches what a section's `children` threw. */
function Rethrow({ error }: { error: Error }): never {
  throw error
}

/**
 * What the section shows for `data`: `empty` when `isEmpty` holds, else
 * `children(data)`, with `undefined` and `false` read as null (nothing to
 * show). A throw from `isEmpty` or `children` becomes a `Rethrow`, which
 * throws again inside the section's boundary, so a section that throws
 * still fails alone.
 */
function shownOf<T>(
  data: T,
  children: (data: T) => ReactNode,
  isEmpty: ((data: T) => boolean) | undefined,
  empty: ReactNode
): { isEmptyValue: boolean; shown: ReactNode } {
  try {
    if (isEmpty?.(data)) return { isEmptyValue: true, shown: empty ?? null }
    const content = children(data)
    return {
      isEmptyValue: false,
      shown: content === undefined || content === false ? null : content,
    }
  } catch (error) {
    return {
      isEmptyValue: false,
      shown: <Rethrow error={error instanceof Error ? error : new Error(String(error))} />,
    }
  }
}

/**
 * Renders the first state that applies: no data yet, the skeleton; a read
 * refused for the role (`isRoleDenied`), `RoleDenied`, which also replaces
 * data already shown; a failed read, `LoadError` whose Try again calls
 * `query.refetch()`, above the data when a refetch failed with data on screen;
 * an empty value, `empty`; otherwise the content in a `SectionBoundary`. A
 * `keepPreviousData` placeholder counts as data. The wrapper is `aria-busy`
 * while the skeleton or a placeholder is up. With data, no failure and
 * nothing to show (the content is null, or the value is empty with no
 * `empty`), it renders nothing at all, so a section that has nothing to say
 * leaves no gap in its parent's grid. A disabled query never leaves its
 * skeleton, so pass only queries the section will run.
 */
export function QueryState<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  name,
  errorMessage,
  className,
  children,
}: QueryStateProps<T>) {
  const { data, error, isError, isPlaceholderData } = query
  const denied = isError && isRoleDenied(error)
  const failure = denied ? (
    <RoleDenied />
  ) : isError ? (
    <LoadError
      message={errorMessage ?? `${name} didn’t load. Try again.`}
      onRetry={() => void query.refetch()}
    />
  ) : null
  const isLoading = data === undefined && !isError

  let body: ReactNode
  if (denied || (isError && data === undefined)) body = failure
  else if (data === undefined) body = skeleton
  else {
    const { isEmptyValue, shown } = shownOf(data, children, isEmpty, empty)
    if (shown === null && failure === null) return null
    body = (
      <>
        {failure}
        {isEmptyValue || shown === null ? (
          shown
        ) : (
          <SectionBoundary name={name}>{shown}</SectionBoundary>
        )}
      </>
    )
  }

  return (
    <div
      data-slot="query-state"
      aria-busy={isLoading || isPlaceholderData || undefined}
      className={cn('grid gap-4', className)}
    >
      {body}
    </div>
  )
}
