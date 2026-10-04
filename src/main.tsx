/**
 * @file The entry point. React mounts only after `router.load()` settles, so
 * index.html's static splash stays up until the first commit already has a
 * real match (or an error match): `createRoot().render()` clears the
 * container on its first commit, and the router renders nothing until a match
 * exists. `finally` mounts React whether `load()` resolves or rejects, and the
 * trailing `catch` logs both a rejection of `load()` and a synchronous throw
 * from the mount (say `#root` missing), which would otherwise strand the
 * splash with nothing saying why. Analytics starts after the first load, so
 * the restored session's identity is queued before posthog-js loads. The
 * error listeners are installed before anything else can throw, and the root
 * hands React's caught and uncaught errors to error tracking.
 */
// First import: must run before any module builds a Zod schema (see the file).
import '@/lib/zod-jitless'
// Second: the error listeners, before any other module evaluates.
import '@/observability/errors/install'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Devtools } from '@/components/dev/devtools'
import { initAnalytics } from '@/observability/analytics'
import { rootErrorOptions } from '@/observability/errors'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'

void router
  .load()
  .finally(() => {
    createRoot(document.getElementById('root')!, rootErrorOptions).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Devtools />
        </QueryClientProvider>
      </StrictMode>
    )
    void initAnalytics()
  })
  .catch((error: unknown) => {
    console.error(error)
  })
