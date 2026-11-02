/**
 * The message the workspace tabs show when the role lookup they gate on
 * fails. One definition, so every tab words the same failure the same way.
 * It lives here, not in the shared `load-error.tsx`, because apex words it for
 * staff ("tenant") and this app for customers ("workspace").
 */
export const ROLE_ERROR =
  'We couldn’t load your role in this workspace, so its controls are hidden. Select Try again to show them.'
