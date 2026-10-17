import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COPY_FAILED, copyId } from '@/components/shared/command-palette/copy-id'
import { toast } from '@/lib/toast'

describe('copyId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('copies the id and says so without naming it', async () => {
    userEvent.setup()
    const success = vi.spyOn(toast, 'success')
    copyId('id-1', 'Tenant ID copied.')
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Tenant ID copied.'))
    await expect(navigator.clipboard.readText()).resolves.toBe('id-1')
  })

  it('says it could not copy when the clipboard refuses', async () => {
    userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    const error = vi.spyOn(toast, 'error')
    copyId('id-1', 'Tenant ID copied.')
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(COPY_FAILED))
    expect(JSON.stringify(error.mock.calls)).not.toContain('id-1')
  })

  it('says it could not copy when there is no clipboard', () => {
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard)
    const error = vi.spyOn(toast, 'error')
    copyId('id-1', 'Tenant ID copied.')
    expect(error).toHaveBeenCalledWith(COPY_FAILED)
  })
})
