import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { runtimeConfigPlugin } from './scripts/runtime-config-plugin.mjs'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/pages',
      generatedRouteTree: './src/routeTree.gen.ts',
      /** Each route's component is its own chunk, fetched on first visit to it. */
      autoCodeSplitting: true,
      /**
       * The plugin's default groupings plus the pending template, so the
       * templates stay out of the entry chunk (pnpm check:bundle). The router
       * loads a route's pending template with its chunk.
       */
      codeSplittingOptions: {
        defaultBehavior: [
          ['component'],
          ['errorComponent'],
          ['notFoundComponent'],
          ['pendingComponent'],
        ],
      },
    }),
    /**
     * The React Compiler through Babel (`babel-plugin-react-compiler` and
     * `@rolldown/plugin-babel`), as `@vitejs/plugin-react`'s README wires it.
     * `react({ compiler: true })` would need `oxc-transform-react`, which is not
     * a dependency.
     */
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    /**
     * `/runtime-config.js` on the dev and preview servers, from the `VITE_`
     * names of the run-time settings (src/configs/runtime-config.ts); the
     * image writes it at container start instead.
     */
    runtimeConfigPlugin(),
    /**
     * Removes MSW's worker from `dist/`. It sits in `public/` so the dev server
     * serves it at /mockServiceWorker.js, the root scope the e2e harness
     * registers it under, and `public/` is copied verbatim into `dist/`. It is
     * deleted after the build, not moved out of `public/`, which would change
     * its path and scope.
     */
    {
      name: 'drop-msw-worker-from-build',
      apply: 'build',
      async closeBundle() {
        const { rm } = await import('node:fs/promises')
        await rm(path.resolve(import.meta.dirname, 'dist/mockServiceWorker.js'), { force: true })
      },
    },
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  /** The commit, from the image's `GIT_SHA` build argument: the same value in every environment. */
  define: { __APP_RELEASE__: JSON.stringify(process.env.GIT_SHA || 'dev') },
  /**
   * Maps for every build, with no `sourceMappingURL` comment in the bundle:
   * the image uploads them to PostHog and deletes them before nginx serves `dist/`.
   */
  build: { sourcemap: 'hidden' },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4040', changeOrigin: true } },
  },
})
