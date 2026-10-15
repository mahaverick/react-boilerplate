import { Note } from '@/components/shared/note'

/** Said above a settings page the reader may view but not change. */
export function ReadOnlyBanner() {
  return <Note tone="info">You can view these settings. Owners and admins can change them.</Note>
}
