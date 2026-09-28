/**
 * @file The entry point. React mounts only after `router.load()` settles, so
 * index.html's static splash stays up until the first commit already has a
 * real match (or an error match): `createRoot().render()` clears the
 * container on its first commit, and the router renders nothing until a match
 * exists. `finally` mounts React whether `load()` resolves or rejects, and the
 * trailing `catch` logs both a rejection of `load()` and a synchronous throw
 * from the mount (say `#root` missing), which would otherwise strand the
 * splash with nothing saying why.
 */
// First import: must run before any module builds a Zod schema (see the file).
import '@/lib/zod-jitless'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Devtools } from '@/components/dev/devtools'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'

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
