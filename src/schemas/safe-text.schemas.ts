// Mirrors express's safe-text.validators.ts: a free-text field the app stores
// and renders back must not carry a Unicode control character or a bidi
// override or isolate. Each schema opts in per field, as the API does.
//
// `\p{Cc}` also matches `\n` and `\t`, so a multiline value has those two
// stripped from a copy before the control-character test.
const FORBIDDEN_CONTROL = /\p{Cc}/u
const BIDI_OVERRIDE = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/u
const MULTILINE_ALLOWED = /[\n\t]/g

/**
 * A predicate for zod's `.refine()`: `true` when `value` has no `Cc` control
 * character and no bidi override or isolate. `multiline` allows `\n` and `\t`.
 */
export function safeText(options: { multiline?: boolean } = {}): (value: string) => boolean {
  return (value: string): boolean => {
    const withoutAllowedWhitespace = options.multiline
      ? value.replaceAll(MULTILINE_ALLOWED, '')
      : value
    return !FORBIDDEN_CONTROL.test(withoutAllowedWhitespace) && !BIDI_OVERRIDE.test(value)
  }
}

/**
 * `\r\n` becomes `\n`; a lone `\r` is left for `safeText` to reject. Anything
 * that is not a string passes through unchanged, for zod's type check.
 */
export function normalizeMultilineText<T>(value: T): T {
  return typeof value === 'string' ? (value.replaceAll('\r\n', '\n') as T) : value
}

/** The API's message for a field `safeText` rejects. */
export function notAllowedMessage(label: string): string {
  return `${label} contains characters that are not allowed`
}
