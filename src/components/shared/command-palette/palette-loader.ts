/** The app palette's module, as `import()` resolves it. */
type PaletteModule = typeof import('@/components/features/command-palette')

/** The fetch in flight or done; cleared on failure rather than kept. */
let pending: Promise<PaletteModule> | null = null

/** The module once the fetch has resolved. */
let loaded: PaletteModule | null = null

/**
 * Fetches the app palette's code, once. A rejected fetch is not kept here, but
 * the browser keeps a failed `import()` for the page's lifetime (Chromium makes
 * no new request for the same URL), so a later call usually fails the same way;
 * the host offers a reload.
 * @returns The palette's module.
 */
export function loadPalette(): Promise<PaletteModule> {
  pending ??= import('@/components/features/command-palette').then(
    (module) => {
      loaded = module
      return module
    },
    (error: unknown) => {
      pending = null
      throw error
    }
  )
  return pending
}

/**
 * The palette's module if its fetch has already resolved, else null. It lets
 * the host mount the palette on the first open without a loading overlay.
 * @returns The module, or null while it is on its way or has not been asked for.
 */
export function peekPalette(): PaletteModule | null {
  return loaded
}

/**
 * Starts the fetch ahead of the first open, for the header's search trigger
 * (hover or focus) and the idle prefetch. A failure is left for the open to report.
 */
export function prefetchPalette(): void {
  loadPalette().catch(() => {})
}
