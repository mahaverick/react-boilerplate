import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.

  const envDirPath = path.resolve(process.cwd(), './')

  // Load the environment variables and assign to process.env
  process.env = { ...process.env, ...loadEnv(mode, envDirPath, '') }
  return {
    envDir: './',
    plugins: [react(), tsconfigPaths()],
    define: {
      'process.env': process.env,
    },
    server: {
      port: parseInt(process.env.VITE_PORT || '5173'),
      proxy: {
        '/api': {
          target: process.env.VITE_API_BASE_URL,
          changeOrigin: true,
        },
      },
    },
    base: process.env.VITE_BASE_URL || '',
    build: {
      outDir: `./dist`,
      sourcemap: true,
      // assetDir is to serve the assets from the dashboard as prefix
      assetsDir: 'dashboard',
      rollupOptions: {
        external: ['sharp'],
      },
    },
  }
})
