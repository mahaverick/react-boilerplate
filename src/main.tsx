/**
 * @file The entry point. React mounts only after `router.load()` settles, so
 * index.html's static boot shell stays up until the first commit already has a
 * real match (or an error match). `createRoot().render()` clears `#root` on
 * its first commit and the router renders nothing until a match exists, so
 * mounting earlier would blank the shell. `finally` mounts React whether `load()`
 * resolves or rejects, and the trailing `catch` logs a rejection of `load()`
 * or a throw from the mount (say `#root` missing), which would otherwise
 * strand the shell with nothing saying why. Analytics starts after that
 * first load, so the restored session's identity is queued before posthog-js
 * loads.
 */
// First import: must run before any module builds a Zod schema (see the file).
import '@/lib/zod-jitless'
// Second: the error listeners, before the rest of the app's modules evaluate.
import '@/observability/errors/install'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Devtools } from '@/components/dev/devtools'
import { rootErrorOptions } from '@/observability/errors'
import { initAnalytics } from '@/observability/telemetry'
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
