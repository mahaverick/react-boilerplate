import type { ReactNode } from 'react'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'

/**
 * The signed-out page frame: a muted page with the card centred. `main` is
 * narrow on phones and wide enough for `AuthCard`'s two columns from `md`
 * up. It takes tabIndex -1 so the skip link can focus it without adding a Tab
 * stop.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <SkipLink />
      {/* Capped: the sign-in card stays a narrow, centred column. */}
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex w-full max-w-sm flex-col gap-6 outline-none md:max-w-3xl"
      >
        {children}
      </main>
    </div>
  )
}
