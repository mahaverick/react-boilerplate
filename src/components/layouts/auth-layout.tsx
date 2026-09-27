import type { ReactNode } from 'react'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-4 sm:p-6">
      <SkipLink />
      {/* tabIndex -1: focusable by the skip link, not a Tab stop. */}
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="w-full max-w-md outline-none">
        {children}
      </main>
    </div>
  )
}
