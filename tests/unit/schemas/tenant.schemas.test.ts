import { describe, expect, it } from 'vitest'
import {
  inviteMemberSchema,
  metadataTextSchema,
  newTenantSchema,
  slugSchema,
  tenantSettingsFormSchema,
  updateTenantSchema,
  updateTenantSettingsSchema,
} from '@/schemas/tenant.schemas'

describe('slugSchema', () => {
  it('accepts a lowercase, hyphenated slug', () => {
    expect(slugSchema.parse('acme-corp')).toBe('acme-corp')
    expect(slugSchema.parse('  acme-corp  ')).toBe('acme-corp')
  })

  it('REJECTS mixed case rather than lowercasing it', () => {
    // The slug is a routing identifier. Rewriting "MyOrg" to "myorg" would address a different tenant than the one the user typed.
    const result = slugSchema.safeParse('MyOrg')
    expect(result.success).toBe(false)
  })

  it('rejects a leading or trailing hyphen', () => {
    expect(slugSchema.safeParse('-lead').success).toBe(false)
    expect(slugSchema.safeParse('trail-').success).toBe(false)
  })

  it('rejects anything shorter than 3 or longer than 100 characters', () => {
    expect(slugSchema.safeParse('ab').success).toBe(false)
    expect(slugSchema.safeParse('a'.repeat(101)).success).toBe(false)
    expect(slugSchema.safeParse('a'.repeat(100)).success).toBe(true)
  })

  it('rejects a reserved slug', () => {
    for (const reserved of ['admin', 'tenants', 'members', 'localhost', 'undefined']) {
      expect(slugSchema.safeParse(reserved).success).toBe(false)
    }
  })

  it('rejects underscores, spaces and other punctuation', () => {
    for (const bad of ['acme_corp', 'acme corp', 'acme.corp', 'acme/corp']) {
      expect(slugSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('newTenantSchema', () => {
  it('drops blank optional fields instead of posting an empty string', () => {
    // The backend's own `.min(1)` refuses '', and an untouched input submits exactly that.
    const parsed = newTenantSchema.parse({
      name: '  Acme  ',
      slug: 'acme',
      description: '',
      logo: '',
      website: '',
    })
    expect(parsed).toEqual({ name: 'Acme', slug: 'acme' })
    // Asserted through JSON, which is what actually goes over the wire: Zod keeps the key present with an `undefined` value, and `JSON.stringify` (axios' serializer) is what drops it. `''` reaching the API would be a 400 on a field the user never filled in.
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({ name: 'Acme', slug: 'acme' })
  })

  it('requires a name', () => {
    expect(newTenantSchema.safeParse({ name: '   ', slug: 'acme' }).success).toBe(false)
  })

  it('caps name at 255 and description at 1000', () => {
    const base = { name: 'Acme', slug: 'acme' }
    expect(newTenantSchema.safeParse({ ...base, name: 'a'.repeat(256) }).success).toBe(false)
    expect(newTenantSchema.safeParse({ ...base, description: 'a'.repeat(1001) }).success).toBe(
      false
    )
    expect(newTenantSchema.safeParse({ ...base, description: 'a'.repeat(1000) }).success).toBe(true)
  })

  it('rejects the platform slug, the same as any other reserved slug', () => {
    const platform = newTenantSchema.safeParse({ name: 'Acme', slug: 'platform' })
    const admin = newTenantSchema.safeParse({ name: 'Acme', slug: 'admin' })

    expect(platform.success).toBe(false)
    expect(platform.error?.issues[0]?.path).toEqual(['slug'])
    expect(platform.error?.issues[0]?.message).toBe(admin.error?.issues[0]?.message)
  })
})

describe('updateTenantSchema', () => {
  it('has no slug key — the API does not allow renaming it', () => {
    expect(Object.hasOwn(updateTenantSchema.shape, 'slug')).toBe(false)
    const parsed = updateTenantSchema.parse({ name: 'Acme', slug: 'somethingelse' })
    expect(Object.hasOwn(parsed, 'slug')).toBe(false)
  })

  it('sends null, not undefined, for a cleared field', () => {
    // null CLEARS the column; undefined would mean "leave it alone", and the old value the user just deleted would come straight back.
    expect(updateTenantSchema.parse({ description: '' })).toEqual({ description: null })
  })
})

describe('inviteMemberSchema', () => {
  it('normalises the email and keeps the role', () => {
    expect(inviteMemberSchema.parse({ email: '  ADA@B.COM ', role: 'viewer' })).toEqual({
      email: 'ada@b.com',
      role: 'viewer',
    })
  })

  it('rejects a role the server does not know', () => {
    expect(inviteMemberSchema.safeParse({ email: 'a@b.com', role: 'superuser' }).success).toBe(
      false
    )
  })

  it('caps the address at 320, the same ceiling as registration', () => {
    const at320 = `${'a'.repeat(314)}@b.com`
    expect(at320).toHaveLength(320)
    expect(inviteMemberSchema.safeParse({ email: at320, role: 'viewer' }).success).toBe(true)
    expect(inviteMemberSchema.safeParse({ email: `a${at320}`, role: 'viewer' }).success).toBe(false)
  })
})

describe('metadataTextSchema', () => {
  it('reads blank as "clear it"', () => {
    expect(metadataTextSchema.parse('   ')).toBeNull()
  })

  it('parses a JSON object', () => {
    expect(metadataTextSchema.parse('{"tier":"pro"}')).toEqual({ tier: 'pro' })
  })

  it('refuses invalid JSON and non-objects', () => {
    expect(metadataTextSchema.safeParse('{oops').success).toBe(false)
    expect(metadataTextSchema.safeParse('[1,2]').success).toBe(false)
    expect(metadataTextSchema.safeParse('"a string"').success).toBe(false)
  })
})

describe('tenantSettingsFormSchema', () => {
  it('produces exactly the PATCH body', () => {
    expect(
      tenantSettingsFormSchema.parse({ timezone: 'UTC', locale: 'en', metadata: '{"a":1}' })
    ).toEqual({ timezone: 'UTC', locale: 'en', metadata: { a: 1 } })
  })

  it('refuses a blank timezone or locale instead of dropping the key', () => {
    // Both columns are NOT NULL with a default and the form always shows the current value, so an emptied box cannot mean "clear it" — and dropping it from the payload would report success while the old value came back.
    const base = { timezone: 'UTC', locale: 'en', metadata: '' }
    expect(tenantSettingsFormSchema.safeParse({ ...base, timezone: '  ' }).success).toBe(false)
    expect(tenantSettingsFormSchema.safeParse({ ...base, locale: '' }).success).toBe(false)
  })

  it('caps locale at 10 characters and timezone at 64', () => {
    const base = { timezone: 'UTC', locale: 'en', metadata: '' }
    expect(tenantSettingsFormSchema.safeParse({ ...base, locale: 'a'.repeat(11) }).success).toBe(
      false
    )
    expect(tenantSettingsFormSchema.safeParse({ ...base, timezone: 'a'.repeat(65) }).success).toBe(
      false
    )
  })
})

describe('tenant text fields: the API safeText rule', () => {
  const base = { name: 'Acme', slug: 'acme' }

  /** Each failing field and its message, in order. */
  function issuesOf(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
    return result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])
  }

  it("rejects a control or bidi character in each field, with the API's message", () => {
    const result = newTenantSchema.safeParse({
      ...base,
      name: 'Acme\u{202E}',
      description: 'a\rb',
      logo: 'https://acme.example/logo\u{85}',
      website: 'https://acme.example/\u{2066}',
    })
    expect(issuesOf(result)).toEqual([
      ['name', 'Name contains characters that are not allowed'],
      ['description', 'Description contains characters that are not allowed'],
      ['logo', 'Logo contains characters that are not allowed'],
      ['website', 'Website contains characters that are not allowed'],
    ])
  })

  it(String.raw`keeps \n and \t in a description, and normalises CRLF on update`, () => {
    expect(newTenantSchema.parse({ ...base, description: 'one\ntwo\tthree' }).description).toBe(
      'one\ntwo\tthree'
    )
    expect(updateTenantSchema.parse({ description: 'one\r\ntwo' }).description).toBe('one\ntwo')
  })

  it('turns pasted CRLF in a description into LF before it is sent', () => {
    const parsed = newTenantSchema.parse({
      name: 'Acme',
      slug: 'acme',
      description: 'line one\r\nline two',
    })
    expect(parsed.description).toBe('line one\nline two')
  })

  it('applies the same rule on update', () => {
    const result = updateTenantSchema.safeParse({
      name: 'Acme\u{0}',
      website: 'https://acme.example/\u{202A}',
    })
    expect(issuesOf(result)).toEqual([
      ['name', 'Name contains characters that are not allowed'],
      ['website', 'Website contains characters that are not allowed'],
    ])
  })
})

describe('tenant settings: timezone and locale', () => {
  const base = { timezone: 'Europe/London', locale: 'en-GB', metadata: '' }

  /** The messages for one field, from the form schema and the PATCH body schema. */
  function messagesFor(field: 'timezone' | 'locale', value: string) {
    const form = tenantSettingsFormSchema.safeParse({ ...base, [field]: value })
    const body = updateTenantSettingsSchema.safeParse({ [field]: value })
    return [form, body].map((result) => result.error?.issues.map((issue) => issue.message))
  }

  it.each([
    ['timezone', 'Etc/\u{202E}gnp', 'Timezone contains characters that are not allowed'],
    ['timezone', 'UTC\nX', 'Timezone contains characters that are not allowed'],
    ['locale', 'en\u{7}', 'Locale contains characters that are not allowed'],
  ])('refuses a control or bidi character in %s', (field, value, message) => {
    for (const messages of messagesFor(field as 'timezone' | 'locale', value)) {
      expect(messages?.[0]).toBe(message)
    }
  })

  it.each([
    ['timezone', 'Not a zone', 'Timezone must be a time zone name such as Europe/Paris.'],
    ['timezone', 'Mars/Olympus_Mons', 'Timezone must be a time zone name such as Europe/Paris.'],
    ['timezone', '+05:30', 'Timezone must be a time zone name such as Europe/Paris.'],
    ['locale', 'english', 'Locale must be a language tag such as en or en-US.'],
    ['locale', 'en_GB', 'Locale must be a language tag such as en or en-US.'],
    // The tag's shape passes; Intl refuses the repeated region subtag.
    ['locale', 'en-GB-GB', 'Locale must be a language tag such as en or en-US.'],
  ])('refuses %s %j by its shape', (field, value, message) => {
    for (const messages of messagesFor(field as 'timezone' | 'locale', value)) {
      expect(messages).toEqual([message])
    }
  })

  it.each(['UTC', 'Europe/London', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5', '+0530'])(
    'accepts the time zone %s',
    (timezone) => {
      expect(tenantSettingsFormSchema.safeParse({ ...base, timezone }).success).toBe(true)
    }
  )

  it.each(['en', 'en-GB', 'zh-Hant-TW', 'es-419'])('accepts the locale %s', (locale) => {
    expect(tenantSettingsFormSchema.safeParse({ ...base, locale }).success).toBe(true)
  })
})

describe('tenant settings: metadata is bounded', () => {
  /** An object nested `depth` levels deep: `{ a: { a: … {} } }`. */
  function nested(depth: number): Record<string, unknown> {
    let value: Record<string, unknown> = {}
    for (let level = 1; level < depth; level += 1) value = { a: value }
    return value
  }

  it('refuses metadata over 16 KB as JSON', () => {
    const big = JSON.stringify({ blob: 'x'.repeat(16_384) })
    expect(metadataTextSchema.safeParse(big).error?.issues[0]?.message).toBe(
      'Metadata must be at most 16384 characters as JSON.'
    )
    expect(
      updateTenantSettingsSchema.safeParse({ metadata: { blob: 'x'.repeat(16_384) } }).success
    ).toBe(false)
  })

  it('accepts exactly 16 384 characters as JSON, and refuses one more', () => {
    // {"blob":"…"} is 11 characters of frame.
    const atCap = { blob: 'x'.repeat(16_384 - 11) }
    const overCap = { blob: 'x'.repeat(16_384 - 10) }
    expect(updateTenantSettingsSchema.safeParse({ metadata: atCap }).success).toBe(true)
    expect(metadataTextSchema.safeParse(JSON.stringify(atCap)).success).toBe(true)
    expect(updateTenantSettingsSchema.safeParse({ metadata: overCap }).success).toBe(false)
  })

  it('refuses metadata nested more than 10 levels deep, and accepts 10', () => {
    expect(metadataTextSchema.safeParse(JSON.stringify(nested(11))).error?.issues[0]?.message).toBe(
      'Metadata must be nested at most 10 levels deep.'
    )
    expect(updateTenantSettingsSchema.safeParse({ metadata: nested(11) }).success).toBe(false)
    expect(metadataTextSchema.safeParse(JSON.stringify(nested(10))).success).toBe(true)
    expect(updateTenantSettingsSchema.safeParse({ metadata: nested(10) }).success).toBe(true)
  })

  it('reports only the depth for metadata both too deep and too large, as the API does', () => {
    const deepAndLarge = { ...nested(11), blob: 'x'.repeat(16_384) }
    expect(
      metadataTextSchema
        .safeParse(JSON.stringify(deepAndLarge))
        .error?.issues.map((issue) => issue.message)
    ).toEqual(['Metadata must be nested at most 10 levels deep.'])
  })

  it('refuses a NUL in a key or a string value', () => {
    expect(metadataTextSchema.safeParse('{"a\\u0000b":1}').error?.issues[0]?.message).toBe(
      'Metadata contains characters that are not allowed'
    )
    expect(updateTenantSettingsSchema.safeParse({ metadata: { a: 'x\u{0}' } }).success).toBe(false)
  })

  it('counts an array as a level', () => {
    expect(metadataTextSchema.safeParse(JSON.stringify({ a: [[[[[[[[[[1]]]]]]]]]] })).success).toBe(
      false
    )
  })
})

describe('tenant logo and website: http or https URLs only', () => {
  const base = { name: 'Acme', slug: 'acme' }

  it.each([
    ['website', 'javascript:alert(document.domain)', 'Website must be an http or https URL.'],
    ['logo', 'javascript:alert(1)', 'Logo must be an http or https URL.'],
    ['logo', 'data:text/html,<script>alert(1)</script>', 'Logo must be an http or https URL.'],
    ['website', 'call us maybe', 'Website must be an http or https URL.'],
    ['website', 'https://bank.example@evil.example/', 'Website must be an http or https URL.'],
    ['website', 'https://user:pw@host.example/', 'Website must be an http or https URL.'],
    ['website', 'https://:pw@host.example/', 'Website must be an http or https URL.'],
    [
      'website',
      String.raw`https://evil.example\@good.example/`,
      'Website must be an http or https URL.',
    ],
    ['logo', String.raw`https://good.example/a\b`, 'Logo must be an http or https URL.'],
  ])('refuses %s %s', (field, value, message) => {
    for (const schema of [newTenantSchema, updateTenantSchema]) {
      const result = schema.safeParse({ ...base, [field]: value })
      expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
        [field, message],
      ])
    }
  })

  it('gives a refused character alone its message, not the URL message too, as the API does', () => {
    for (const schema of [newTenantSchema, updateTenantSchema]) {
      const result = schema.safeParse({ ...base, website: 'javascript:\u{202E}' })
      expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
        ['website', 'Website contains characters that are not allowed'],
      ])
    }
  })

  it('accepts http and https URLs, trimmed', () => {
    expect(
      newTenantSchema.parse({
        ...base,
        logo: ' https://cdn.acme.example/logo.png ',
        website: 'http://acme.example',
      })
    ).toMatchObject({ logo: 'https://cdn.acme.example/logo.png', website: 'http://acme.example' })
  })

  it('accepts an @ in the path or query, which names no other host', () => {
    expect(
      newTenantSchema.parse({ ...base, website: 'https://example.com/u/@name?x=a@b' })
    ).toMatchObject({ website: 'https://example.com/u/@name?x=a@b' })
  })

  it('still clears with a blank value', () => {
    expect(newTenantSchema.parse({ ...base, logo: '', website: '' })).toEqual(base)
    expect(updateTenantSchema.parse({ logo: '', website: '  ' })).toEqual({
      logo: null,
      website: null,
    })
  })
})
