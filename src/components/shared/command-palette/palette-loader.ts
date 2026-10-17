/** The app palette's module, as `import()` resolves it. */
type PaletteModule = typeof import('@/components/features/command-palette')

/** The fetch in flight or done; cleared on failure so the next call asks again. */
let pending: Promise<PaletteModule> | null = null

/**
 * Fetches the app palette's code, once. A rejected fetch is not kept, so a
 * later call asks again (a deploy may have removed the old chunk).
 * @returns The palette's module.
 */
export function loadPalette(): Promise<PaletteModule> {
  pending ??= import('@/components/features/command-palette').catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

/**
 * Starts the fetch ahead of the first open, for the header's search trigger
 * (hover or focus) and the idle prefetch. A failure is left for the open to report.
 */
export function prefetchPalette(): void {
  loadPalette().catch(() => {})
}
