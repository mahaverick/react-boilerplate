// First import: must run before any module builds a Zod schema (see the file).
import '@/lib/zod-jitless'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Devtools } from '@/components/dev/devtools'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'

/**
 * `router.load()` resolves the first match set (running the root route's
 * `beforeLoad`, so `bootstrapSession`) before React ever touches `#root`.
 * `createRoot(...).render(...)` clears whatever is already in the container
 * on its first commit, and until a match is offered `MatchesInner` renders
 * null — so rendering before the load resolves replaces index.html's static
 * splash with nothing, then the router's own pending screen, then the page.
 * Waiting here means the first commit already has a real match (or an error
 * match), so the splash stays up as a single piece of static markup the
 * whole time. `finally`, not `then`: it mounts React whether `load()`
 * resolves or rejects. A `beforeLoad` or loader error instead resolves
 * `load()` normally with an error match, and the first commit renders
 * `RouteError` for it; the trailing `catch` covers two different failures —
 * a genuine rejection of `load()` itself, which `finally` re-throws after
 * running, and a synchronous throw from `createRoot(...).render(...)` inside
 * `finally` (for example `#root` missing from the DOM). The second case is
 * the one that strands the splash forever: React never gets to clear it, so
 * nothing else on the page will ever say why. The first case has already
 * mounted whatever `finally` produced by the time it reaches this catch, but
 * would otherwise have been swallowed here with no trace at all, exactly as
 * the empty `catch(() => {})` this replaced did for both cases. Either way,
 * logging it is strictly better than dropping it on the floor.
 */
void router
  .load()
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Devtools />
        </QueryClientProvider>
      </StrictMode>
    )
  })
  .catch((error: unknown) => {
    console.error(error)
  })
