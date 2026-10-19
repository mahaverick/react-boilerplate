import { IconBrandGoogleFilled, type TablerIcon } from '@tabler/icons-react'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'

/** A third-party sign-in the API offers, as the sign-in page shows it. */
export interface SocialProvider {
  /** Stable key for React lists and tests. */
  id: string
  /** Shown as "Continue with {label}". */
  label: string
  /**
   * The API route that starts the provider's flow, a same-origin top-level
   * navigation. `redirect` is a path already passed through `safeRedirect`.
   */
  hrefFor: (redirect?: string) => string
  Icon: TablerIcon
}

/**
 * The providers whose buttons the sign-in page renders, and the only place
 * that decides it. The API exposes no public list of configured providers
 * (its `GET /auth/providers` is the signed-in caller's linked methods), and it
 * mounts `/auth/google` only while Google OAuth is configured, so a deployment
 * without Google removes its entry here. An empty list renders no divider and
 * no buttons. Google's start names this app (`app=web`) so the callback comes
 * back here, and carries the landing path, which the API keeps only when its
 * own redirect rule accepts it.
 */
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
  {
    id: 'google',
    label: 'Google',
    hrefFor: (redirect) =>
      `${GOOGLE_OAUTH_PATH}?app=web${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ''}`,
    Icon: IconBrandGoogleFilled,
  },
]
