/**
 * The `app` value every request that names its frontend sends: the sign-in
 * link, passkey registration, passkey sign-in and the step-up link all take it
 * so express builds links and policy for this app. A derived project changes it
 * here.
 */
export const FRONTEND_APP = 'web' as const
