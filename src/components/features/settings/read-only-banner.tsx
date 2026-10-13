/** Said above a settings page the reader may view but not change. */
export function ReadOnlyBanner() {
  return (
    <p
      role="note"
      className="rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
    >
      You can view these settings. Owners and admins can change them.
    </p>
  )
}
