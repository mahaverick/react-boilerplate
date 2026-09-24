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
    }),
    // `react({ compiler: true })` uses the Rust-based oxc-transform-react
    // package, which is not in the pinned dependency set. The pinned deps
    // (babel-plugin-react-compiler + @rolldown/plugin-babel) are for the
    // Babel React Compiler path instead, wired exactly as
    // @vitejs/plugin-react's own README documents it.
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    // MSW's worker has to sit in `public/` so the dev server serves it from
    // the root scope a service worker needs — but `public/` is copied verbatim
    // into `dist/`, which shipped a request-intercepting service worker to
    // production. It is inert there (nothing in the built app registers it),
    // and it still has no business being in the bundle.
    //
    // Deleted at the end of the build rather than moved, because moving it
    // breaks the scope that makes the e2e fixture harness work at all.
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
