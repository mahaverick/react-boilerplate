import { buttonVariants } from '@/components/ui/button'
import { FieldSeparator } from '@/components/ui/field'
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/constants/auth-providers'
import { cn } from '@/lib/utils'

/**
 * The "Or continue with" divider and one button per configured provider, or
 * nothing when there is none. `providers` defaults to `SOCIAL_PROVIDERS`; it
 * is a prop so a test can render the empty and populated cases.
 *
 * Each button is a plain anchor with `buttonVariants` classes, a top-level
 * navigation to a same-origin API route. It stays a link (the keyboard test
 * pins `role="link"`): Base UI's Button with `render={<a/>}` warns, and its
 * `nativeButton={false}` fix would add `role="button"`.
 */
export function SocialSignIn({
  providers = SOCIAL_PROVIDERS,
}: {
  providers?: readonly SocialProvider[]
}) {
  if (providers.length === 0) return null
  return (
    <>
      <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
        Or continue with
      </FieldSeparator>
      <div className="grid gap-3">
        {providers.map(({ id, label, href, Icon }) => (
          <a key={id} href={href} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
            <Icon aria-hidden="true" />
            Continue with {label}
          </a>
        ))}
      </div>
    </>
  )
}
