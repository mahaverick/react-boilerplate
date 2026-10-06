/** The response header express sets on every API response: `off`, `read_only` or `full`. */
export const MAINTENANCE_MODE_HEADER = 'Maintenance-Mode'

/** How often the status endpoint is polled while the mode is `full`, before jitter. */
export const MAINTENANCE_POLL_BASE_MS = 30_000

/** The most random delay added to each poll, so a fleet of open tabs does not poll in step. */
export const MAINTENANCE_POLL_JITTER_MS = 10_000

/** The toast id for a refused read-only write: one toast however many writes fail at once. */
export const READ_ONLY_TOAST_ID = 'read-only-mode'

/** The `sessionStorage` key holding the `since` of the last maintenance period reported to analytics. */
export const MAINTENANCE_VIEWED_KEY = 'maintenance_page_viewed_since'
