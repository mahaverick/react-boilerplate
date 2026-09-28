import type { ReactNode } from 'react'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'

/** The signed-out page frame; its `main` takes tabIndex -1 so the skip link can focus it without adding a Tab stop. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-4 sm:p-6">
      <SkipLink />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="w-full max-w-md outline-none">
        {children}
      </main>
    </div>
  )
}
