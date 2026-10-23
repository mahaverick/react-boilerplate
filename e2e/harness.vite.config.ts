import { defineConfig, mergeConfig } from 'vite-plus'
import base from '../vite.config'

/**
 * @file Builds the MSW harness (e2e/harness/) as a bundle, in development mode, for the
 * `fixtures` project to preview.
 *
 * The dev server sends each fresh browser context hundreds of unbundled modules, and with
 * three workers on a CI runner its queue pushed first paints past the 5 s assertion
 * budget. The bundle is a handful of files. `--mode development` with `NODE_ENV=development`
 * keeps `import.meta.env.DEV` true, so the harness behaves as it does under `vp dev`.
 * The build keeps MSW's worker in `public/` (the app's own build removes it from `dist/`,
 * and this one writes to `dist/e2e-harness/`), and it emits no source maps.
 */
export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: 'dist/e2e-harness',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { input: 'e2e/harness/index.html' },
    },
  })
)
