import { IconBrandGoogleFilled, type TablerIcon } from '@tabler/icons-react'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'

/** A third-party sign-in the API offers, as the sign-in and registration pages show it. */
export interface SocialProvider {
  /** Stable key for React lists and tests. */
  id: string
  /** Shown as "Continue with {label}". */
  label: string
  /** The API route that starts the provider's flow: a same-origin top-level navigation. */
  href: string
  Icon: TablerIcon
}

/**
 * The providers whose buttons the signed-out pages render, and the only place
 * that decides it. The API exposes no public list of configured providers
 * (its `GET /auth/providers` is the signed-in caller's linked methods), and it
 * mounts `/auth/google` only while Google OAuth is configured, so a deployment
 * without Google removes its entry here. An empty list renders no divider and
 * no buttons.
 */
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
  { id: 'google', label: 'Google', href: GOOGLE_OAUTH_PATH, Icon: IconBrandGoogleFilled },
]
