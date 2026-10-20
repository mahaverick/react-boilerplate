import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { FieldSeparator } from '@/components/ui/field'
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/constants/auth-providers'
import { cn } from '@/lib/utils'

/**
 * The "or" divider and one button per configured provider, or nothing when
 * there is none and no `extra`. `extra` is another way to sign in (the passkey
 * button) and comes first, under the divider. `providers` defaults to `SOCIAL_PROVIDERS`; it is a prop so a
 * test can render the empty and populated cases. `redirect`, already passed
 * through `safeRedirect`, goes into each provider's start URL.
 *
 * Each button is a plain anchor with `buttonVariants` classes, a top-level
 * navigation to a same-origin API route. It stays a link (the keyboard test
 * pins `role="link"`): Base UI's Button with `render={<a/>}` warns, and its
 * `nativeButton={false}` fix would add `role="button"`.
 */
export function SocialSignIn({
  providers = SOCIAL_PROVIDERS,
  redirect,
  extra,
}: {
  providers?: readonly SocialProvider[]
  redirect?: string
  extra?: ReactNode
}) {
  if (providers.length === 0 && !extra) return null
  return (
    <>
      <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">or</FieldSeparator>
      <div className="grid gap-3">
        {extra}
        {providers.map(({ id, label, hrefFor, Icon }) => (
          <a
            key={id}
            href={hrefFor(redirect)}
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
          >
            <Icon aria-hidden="true" />
            Continue with {label}
          </a>
        ))}
      </div>
    </>
  )
}
