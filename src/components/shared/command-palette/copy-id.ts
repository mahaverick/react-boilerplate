import { toast } from '@/lib/toast'

/** What a failed copy says. The id itself never appears in a toast. */
export const COPY_FAILED = 'We couldn’t copy the ID. Try again.'

/**
 * Puts an id on the clipboard and says so. Call it inside the click or the
 * Enter that asked for it, since the clipboard needs a live user gesture.
 * @param id - The id to copy.
 * @param copied - The toast for a copy that worked ("Tenant ID copied.").
 */
export function copyId(id: string, copied: string): void {
  if (typeof navigator.clipboard?.writeText !== 'function') {
    toast.error(COPY_FAILED)
    return
  }
  navigator.clipboard.writeText(id).then(
    () => toast.success(copied),
    () => toast.error(COPY_FAILED)
  )
}
