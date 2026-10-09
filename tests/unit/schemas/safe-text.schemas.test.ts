import { describe, expect, it } from 'vitest'
import { normalizeMultilineText, safeText } from '@/schemas/safe-text.schemas'

// The same cases as express's tests/unit/validators/safe-text.validators.test.ts.
describe('safeText', () => {
  it('rejects a Cc control character', () => {
    expect(safeText()('a\u{0}b')).toBe(false)
    expect(safeText()('a\u{1B}b')).toBe(false)
    expect(safeText()('a\u{85}b')).toBe(false)
  })

  it('rejects a bidi override/isolate character', () => {
    expect(safeText()('a\u{202E}b')).toBe(false)
    expect(safeText()('a\u{2066}b')).toBe(false)
  })

  it('rejects the nine bidi embedding/override/isolate code points', () => {
    const bidi = [0x20_2a, 0x20_2b, 0x20_2c, 0x20_2d, 0x20_2e, 0x20_66, 0x20_67, 0x20_68, 0x20_69]
    for (const codePoint of bidi) {
      expect(safeText()(`a${String.fromCodePoint(codePoint)}b`)).toBe(false)
    }
    // Visible neighbours: a narrow no-break space and an unassigned code point.
    for (const neighbour of [0x20_2f, 0x20_65]) {
      expect(safeText()(`a${String.fromCodePoint(neighbour)}b`)).toBe(true)
    }
  })

  it.each([
    ['ZERO WIDTH SPACE', 'Ad\u{200B}min'],
    ['ZERO WIDTH NON-JOINER', '\u{200C}Admin'],
    ['ZERO WIDTH JOINER', 'Admin\u{200D}'],
    ['LEFT-TO-RIGHT MARK', 'Admin\u{200E}'],
    ['RIGHT-TO-LEFT MARK', 'Admin\u{200F}'],
    ['ARABIC LETTER MARK', 'Admin\u{61C}'],
    ['LINE SEPARATOR', 'Ad\u{2028}min'],
    ['PARAGRAPH SEPARATOR', 'Ad\u{2029}min'],
    ['WORD JOINER', 'Ad\u{2060}min'],
    ['BYTE ORDER MARK', '\u{FEFF}Admin'],
  ])('rejects the invisible format character %s', (_label, value) => {
    expect(safeText()(value)).toBe(false)
    expect(safeText({ multiline: true })(value)).toBe(false)
  })

  it('accepts plain text with accents or emoji', () => {
    expect(safeText()('Zoë 👋')).toBe(true)
  })

  it(String.raw`single-line mode rejects \n and \t too`, () => {
    expect(safeText()('a\nb')).toBe(false)
    expect(safeText()('a\tb')).toBe(false)
  })

  it(String.raw`multiline mode accepts \n and \t, still rejects other Cc characters`, () => {
    expect(safeText({ multiline: true })('a\nb\tc')).toBe(true)
    expect(safeText({ multiline: true })('a\u{0}b')).toBe(false)
  })

  it(String.raw`multiline mode rejects a lone \r`, () => {
    expect(safeText({ multiline: true })('a\rb')).toBe(false)
  })

  it('multiline mode still rejects a bidi override', () => {
    expect(safeText({ multiline: true })('a\u{202E}b')).toBe(false)
  })

  it('accepts real names in any script, with emoji and combining accents', () => {
    for (const name of ['Ὀδυσσεύς', 'محمد', 'שָׁלוֹם', 'Zoe\u{0308}', 'Zoë', 'Zoë 👋']) {
      expect(safeText()(name)).toBe(true)
    }
  })

  // The same strings express's joiner rule was checked against.
  it.each([
    ['a Persian word with a non-joiner', 'می\u{200C}خواهم'],
    ['a Devanagari conjunct with a joiner', 'क\u{94D}\u{200D}ष'],
    ['a Bengali conjunct with a joiner', 'ক\u{9CD}\u{200D}ষ'],
    [
      'a Malayalam word ending in a chillu spelt with a joiner',
      '\u{D2E}\u{D4B}\u{D39}\u{D28}\u{D4D}\u{200D}',
    ],
    ['a family emoji', '👨\u{200D}👩\u{200D}👧'],
    ['a skin-tone emoji', '👍🏽'],
    ['a rainbow flag', '🏳\u{FE0F}\u{200D}🌈'],
    ['a toned profession emoji', '👩🏽\u{200D}💻'],
    ['people holding hands', '🧑\u{200D}🤝\u{200D}🧑'],
    ['a Latin name', 'Zoë'],
    ['an Arabic name', 'محمد'],
    ['a Greek name', 'Ὀδυσσεύς'],
  ])('accepts a joiner inside a word or emoji sequence: %s', (_label, value) => {
    expect(safeText()(value)).toBe(true)
  })

  it.each([
    '\u{200D}abc',
    'abc\u{200C}',
    'a \u{200C} b',
    'a\u{200D}\u{200D}b',
    'a\u{200C}\u{200D}b',
    '👨\u{200D}',
    '\u{200D}👩',
    'a\u{200D}.b',
    'a.\u{200C}b',
    '1\u{200D}2',
    'a\u{200D} ',
    '\u{D4D}\u{200D}',
    'abc\u{D4D}\u{200D}\u{200D}',
    'abc\u{202E}def',
    'abc\u{200E}def',
    'abc\u{200F}def',
    'Ali\u{200E}a',
    'a\u{2066}b',
    'Ad\u{200B}min',
    'Admin\u{61C}',
    '\u{FEFF}Admin',
    'Ad\u{AD}min',
    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'Ad\u{2060}min',
  ])('refuses a joiner at a word edge, or any other format character (case %#)', (value) => {
    expect(safeText()(value)).toBe(false)
  })

  // Not format characters, so the API takes them too: the rule is Cc, Cf and the two separators.
  it.each([
    ['HANGUL FILLER', 'Ad\u{3164}min'],
    ['COMBINING GRAPHEME JOINER', 'Ad\u{34F}min'],
    ['BRAILLE PATTERN BLANK', 'Ad\u{2800}min'],
  ])('accepts %s, which is not a format character', (_label, value) => {
    expect(safeText()(value)).toBe(true)
  })
})

describe('normalizeMultilineText', () => {
  it('turns CRLF into LF', () => {
    expect(normalizeMultilineText('a\r\nb')).toBe('a\nb')
  })

  it(String.raw`leaves a lone \r for safeText to reject`, () => {
    expect(normalizeMultilineText('a\rb')).toBe('a\rb')
  })

  it('leaves a non-string value alone, for zod to reject on type', () => {
    expect(normalizeMultilineText(42)).toBe(42)
  })
})
