/** `verify_email` -> `Verify email`, for a label a reader can parse. */
export function humanizeNotificationType(type: string): string {
  const spaced = type.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
