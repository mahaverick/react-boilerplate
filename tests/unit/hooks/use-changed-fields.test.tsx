import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useChangedFields } from '@/hooks/use-changed-fields'
import { useServerErrors } from '@/hooks/use-server-errors'
import { updateProfileSchema } from '@/schemas/profile.schemas'

const UNCHANGED = 'Change a name before saving.'

/** The hook with a real `useServerErrors`, so the unchanged-save message can be read back. */
function useTracked(loaded: { firstName: string; lastName: string }) {
  const serverErrors = useServerErrors()
  return { serverErrors, ...useChangedFields(updateProfileSchema, loaded, serverErrors, UNCHANGED) }
}

describe('useChangedFields', () => {
  it('follows the loaded values while nothing is edited', () => {
    const { result, rerender } = renderHook(({ loaded }) => useTracked(loaded), {
      initialProps: { loaded: { firstName: 'Ada', lastName: 'Byron' } },
    })
    rerender({ loaded: { firstName: 'Ada', lastName: 'King' } })

    expect(result.current.baseline).toEqual({ firstName: 'Ada', lastName: 'King' })
  })

  it('freezes the baseline at the first edit, so a later refetch does not move it', () => {
    const { result, rerender } = renderHook(({ loaded }) => useTracked(loaded), {
      initialProps: { loaded: { firstName: 'Ada', lastName: 'Byron' } },
    })
    act(() => {
      result.current.listeners.onChange()
    })
    rerender({ loaded: { firstName: 'Ada', lastName: 'King' } })

    expect(result.current.baseline).toEqual({ firstName: 'Ada', lastName: 'Byron' })
    expect(result.current.changes.parse({ firstName: 'Augusta', lastName: 'Byron' })).toEqual({
      firstName: 'Augusta',
    })
  })

  it('freezes on a blur too, which TanStack counts as touching a field', () => {
    const { result, rerender } = renderHook(({ loaded }) => useTracked(loaded), {
      initialProps: { loaded: { firstName: 'Ada', lastName: 'Byron' } },
    })
    act(() => {
      result.current.listeners.onBlur()
    })
    rerender({ loaded: { firstName: 'Ada', lastName: 'King' } })

    expect(result.current.baseline).toEqual({ firstName: 'Ada', lastName: 'Byron' })
  })

  it('freezes on a save attempt too, which TanStack counts as touching every field', () => {
    const { result, rerender } = renderHook(({ loaded }) => useTracked(loaded), {
      initialProps: { loaded: { firstName: 'Ada', lastName: 'Byron' } },
    })
    act(() => {
      result.current.listeners.onSubmit()
    })
    rerender({ loaded: { firstName: 'Ada', lastName: 'King' } })

    expect(result.current.baseline).toEqual({ firstName: 'Ada', lastName: 'Byron' })
  })

  it('moves the baseline only when rebased, after a save', () => {
    const { result } = renderHook(() => useTracked({ firstName: 'Ada', lastName: 'Byron' }))
    act(() => {
      result.current.rebase({ firstName: 'Augusta', lastName: 'Byron' })
    })

    expect(result.current.changes.parse({ firstName: 'Augusta', lastName: 'Byron' })).toEqual({})
  })

  it('asks for a change when nothing changed, and drops only that message on an edit', () => {
    const { result } = renderHook(() => useTracked({ firstName: 'Ada', lastName: 'Byron' }))

    let body: unknown
    act(() => {
      body = result.current.changedBody({ firstName: 'Ada', lastName: 'Byron' })
    })
    expect(body).toBeNull()
    expect(result.current.serverErrors.formErrors).toEqual([UNCHANGED])

    act(() => {
      result.current.listeners.onChange()
    })
    expect(result.current.serverErrors.formErrors).toEqual([])

    act(() => {
      result.current.serverErrors.setFormErrors(['Something broke.'])
    })
    act(() => {
      result.current.listeners.onChange()
    })
    expect(result.current.serverErrors.formErrors).toEqual(['Something broke.'])
  })
})
