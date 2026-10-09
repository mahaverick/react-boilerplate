/**
 * @file Mirrors express's safe-text.validators.ts: a free-text field the app
 * stores and renders back must not carry a Unicode control character, an
 * invisible format character or a line or paragraph separator. The two joiners
 * some scripts and emoji need are allowed inside a word or emoji sequence only.
 */

const FORBIDDEN_CONTROL = /\p{Cc}/u
const INVISIBLE_FORMAT = /[\p{Cf}\u{2028}\u{2029}]/u
/**
 * The joiners real text needs, removed before the `Cf` test: U+200C (ZWNJ,
 * Persian and Indic words) between two letters or marks, and U+200D (ZWJ,
 * Indic conjuncts and emoji sequences) after a letter, mark, pictograph or
 * skin-tone modifier and before a letter, mark or pictograph. U+FE0F, the
 * emoji presentation selector, is a mark (`Mn`). A ZWJ is also allowed, in
 * Malayalam's older chillu spelling, after a virama at a word's end. A joiner
 * beside a space, punctuation, another joiner or a non-letter, non-mark,
 * non-pictograph character stays refused, and so does one with nothing beside it.
 */
const IN_WORD_JOINER =
  /(?<=[\p{L}\p{M}])\u{200C}(?=[\p{L}\p{M}])|(?<=[\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Modifier}])\u{200D}(?=[\p{L}\p{M}\p{Extended_Pictographic}])|(?<=\p{L}\u{0D4D})\u{200D}/gu
const MULTILINE_ALLOWED = /[\n\t]/g

/**
 * A predicate for zod's `.refine()`: `true` when `value` has no `Cc` control
 * character, no `Cf` format character (except a joiner inside a word or emoji
 * sequence) and no U+2028/U+2029 separator. `multiline` allows `\n` and `\t`,
 * which `\p{Cc}` would otherwise match.
 */
export function safeText(options: { multiline?: boolean } = {}): (value: string) => boolean {
  return (value: string): boolean => {
    const withoutAllowedWhitespace = options.multiline
      ? value.replaceAll(MULTILINE_ALLOWED, '')
      : value
    return (
      !FORBIDDEN_CONTROL.test(withoutAllowedWhitespace) &&
      !INVISIBLE_FORMAT.test(value.replaceAll(IN_WORD_JOINER, ''))
    )
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
