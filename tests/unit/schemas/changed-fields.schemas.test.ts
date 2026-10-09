import { describe, expect, it } from 'vitest'
import { changedFieldsOf } from '@/schemas/changed-fields.schemas'
import { tenantSettingsFormSchema, updateTenantSchema } from '@/schemas/tenant.schemas'

describe('changedFieldsOf', () => {
  const stored = {
    name: 'Acme',
    description: 'Ad\u{200B}min anvils',
    logo: 'javascript:alert(1)',
    website: '',
  }

  /** Each issue's field and message, in order. */
  function issuesOf(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
    return result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])
  }

  it('checks and sends only the changed field, past stored values the rules refuse', () => {
    const changes = changedFieldsOf(updateTenantSchema, stored)
    expect(changes.parse({ ...stored, name: '  Acme Ltd ' })).toEqual({ name: 'Acme Ltd' })
  })

  it('sends nothing when nothing changed, even if the stored values are refused', () => {
    expect(changedFieldsOf(updateTenantSchema, stored).parse(stored)).toEqual({})
  })

  it("refuses a changed field with its own schema's message, under its own path", () => {
    const result = changedFieldsOf(updateTenantSchema, stored).safeParse({
      ...stored,
      logo: 'javascript:alert(2)',
      website: 'https://user:pw@host.example/',
    })
    expect(issuesOf(result)).toEqual([
      ['logo', 'Logo must be an http or https URL.'],
      ['website', 'Website must be an http or https URL.'],
    ])
  })

  it("keeps a changed field's own transform: a cleared box still sends null", () => {
    expect(changedFieldsOf(updateTenantSchema, stored).parse({ ...stored, logo: '' })).toEqual({
      logo: null,
    })
  })

  it('reads a settings form the same way: only the changed metadata goes', () => {
    const loaded = { timezone: 'Mars/Olympus_Mons', locale: 'en_GB', metadata: '{"tier":"pro"}' }
    const changes = changedFieldsOf(tenantSettingsFormSchema, loaded)
    expect(changes.parse({ ...loaded, metadata: '{"tier":"max"}' })).toEqual({
      metadata: { tier: 'max' },
    })
    expect(issuesOf(changes.safeParse({ ...loaded, timezone: '' }))).toEqual([
      ['timezone', 'Timezone is required.'],
    ])
  })
})
