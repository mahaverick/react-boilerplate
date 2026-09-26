// Side-effect only, and the FIRST import: module dependencies evaluate in the
// order their import declarations appear, before any of this file's own code
// runs — so this sets Zod's config before `@/router`'s import graph (every
// route's schemas included) evaluates a single one of them. See the file's
// own comment for why that ordering is load-bearing.
import '@/lib/zod-jitless'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
