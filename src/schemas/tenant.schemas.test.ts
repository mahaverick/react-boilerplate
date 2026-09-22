import { describe, expect, it } from 'vitest'
import {
  addMemberSchema,
  metadataTextSchema,
  newTenantSchema,
  slugSchema,
  tenantSettingsFormSchema,
  updateTenantSchema,
} from '@/schemas/tenant.schemas'

describe('slugSchema', () => {
  it('accepts a lowercase, hyphenated slug', () => {
    expect(slugSchema.parse('acme-corp')).toBe('acme-corp')
    expect(slugSchema.parse('  acme-corp  ')).toBe('acme-corp')
  })

  it('REJECTS mixed case rather than lowercasing it', () => {
    // The slug is a routing identifier. Rewriting "MyOrg" to "myorg" would
    // address a different tenant than the one the user typed.
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
    // The backend's own `.min(1)` refuses '', and an untouched input submits
    // exactly that.
    const parsed = newTenantSchema.parse({
      name: '  Acme  ',
      slug: 'acme',
      description: '',
      logo: '',
      website: '',
    })
    expect(parsed).toEqual({ name: 'Acme', slug: 'acme' })
    // Asserted through JSON, which is what actually goes over the wire: Zod
    // keeps the key present with an `undefined` value, and `JSON.stringify`
    // (axios' serializer) is what drops it. `''` reaching the API would be a
    // 400 on a field the user never filled in.
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
})

describe('updateTenantSchema', () => {
  it('has no slug key — the API does not allow renaming it', () => {
    expect(Object.hasOwn(updateTenantSchema.shape, 'slug')).toBe(false)
    const parsed = updateTenantSchema.parse({ name: 'Acme', slug: 'somethingelse' })
    expect(Object.hasOwn(parsed, 'slug')).toBe(false)
  })

  it('sends null, not undefined, for a cleared field', () => {
    // null CLEARS the column; undefined would mean "leave it alone", and the
    // old value the user just deleted would come straight back.
    expect(updateTenantSchema.parse({ description: '' })).toEqual({ description: null })
  })
})

describe('addMemberSchema', () => {
  it('normalises the email and keeps the role', () => {
    expect(addMemberSchema.parse({ email: '  ADA@B.COM ', role: 'viewer' })).toEqual({
      email: 'ada@b.com',
      role: 'viewer',
    })
  })

  it('rejects a role the server does not know', () => {
    expect(addMemberSchema.safeParse({ email: 'a@b.com', role: 'superuser' }).success).toBe(false)
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
