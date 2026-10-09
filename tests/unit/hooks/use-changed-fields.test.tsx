import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useChangedFields } from '@/hooks/use-changed-fields'
import { updateProfileSchema } from '@/schemas/profile.schemas'

describe('useChangedFields', () => {
  it('keeps the baseline it mounted with when the loaded values change', () => {
    const { result, rerender } = renderHook(
      ({ loaded }) => useChangedFields(updateProfileSchema, loaded),
      { initialProps: { loaded: { firstName: 'Ada', lastName: 'Byron' } } }
    )
    rerender({ loaded: { firstName: 'Ada', lastName: 'King' } })

    expect(result.current.baseline).toEqual({ firstName: 'Ada', lastName: 'Byron' })
    expect(result.current.changes.parse({ firstName: 'Augusta', lastName: 'Byron' })).toEqual({
      firstName: 'Augusta',
    })
  })

  it('moves the baseline only when rebased, after a save', () => {
    const { result } = renderHook(() =>
      useChangedFields(updateProfileSchema, { firstName: 'Ada', lastName: 'Byron' })
    )
    act(() => {
      result.current.rebase({ firstName: 'Augusta', lastName: 'Byron' })
    })

    expect(result.current.changes.parse({ firstName: 'Augusta', lastName: 'Byron' })).toEqual({})
  })
})
