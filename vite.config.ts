import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/pages',
      generatedRouteTree: './src/routeTree.gen.ts',
      /** Each route's component is its own chunk, fetched on first visit to it. */
      autoCodeSplitting: true,
    }),
    /**
     * The React Compiler through Babel (babel-plugin-react-compiler and
     * @rolldown/plugin-babel), as @vitejs/plugin-react's README wires it.
     * `react({ compiler: true })` would need oxc-transform-react, which is not
     * a dependency.
     */
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    /**
     * Removes MSW's worker from `dist/`. It sits in `public/` so the dev server
     * serves it from the root scope a service worker needs, and `public/` is
     * copied verbatim into `dist/`. Deleted after the build rather than moved,
     * because moving it breaks the scope the e2e fixture harness relies on.
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
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4040', changeOrigin: true } },
  },
})
