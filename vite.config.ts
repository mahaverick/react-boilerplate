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
      // Tests are co-located beside their subject, so `src/pages/guards.test.tsx`
      // and `src/pages/_auth/login.test.tsx` sit inside the routes directory.
      // Without this the generator treats them as route files and warns on every
      // build that they export no Route.
      routeFileIgnorePattern: '\\.test\\.tsx?$',
    }),
    // `react({ compiler: true })` uses the Rust-based oxc-transform-react
    // package, which is not in the pinned dependency set. The pinned deps
    // (babel-plugin-react-compiler + @rolldown/plugin-babel) are for the
    // Babel React Compiler path instead, wired exactly as
    // @vitejs/plugin-react's own README documents it.
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4040', changeOrigin: true } },
  },
})
