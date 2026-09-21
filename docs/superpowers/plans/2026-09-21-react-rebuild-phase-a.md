# React Boilerplate Rebuild — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the React boilerplate as a correct, tested, accessible SPA against the express-boilerplate's actual shipped API.

**Architecture:** A same-origin SPA. TanStack Router does file-based routing with a root `beforeLoad` that restores the session before any guard runs; TanStack Query holds server state; Zustand holds the in-memory access token and theme. One `ensureSession()` promise serialises every token refresh, because the backend rotates the refresh cookie on each call. shadcn/ui primitives on Tailwind 4.

**Tech Stack:** React 19.3.0, TanStack Router 1.170.38 / Query 5.103.2 / Form 1.33.5, Zustand 5.0.15, Tailwind 4.3.3, Zod 4.6.5, Vite 8.3.0, TypeScript ~6.0.3, Vitest 5.0.1, MSW 2.15.0, jest-axe 11.0.0.

**Spec:** `docs/superpowers/specs/2026-09-17-react-rebuild-design.md` (revision 2026-09-21, commit `44bef9c`)

**Scope:** Phase A only — spec sections 1–13. Phase B (StyleSeed, spec §14) is deliberately excluded: its steps depend on `ss-setup`'s actual outputs, which do not exist until the plugin is installed and the wizard has run. It gets its own plan then.

**Supersedes:** `docs/superpowers/plans/2026-09-17-react-rebuild.md`, deleted by this plan. See spec Appendix B for why it could not be patched.

## Global Constraints

- **Package manager is `pnpm`.** Delete `yarn.lock` in Task 1; never run `yarn` or `npm install`.
- **`VITE_API_URL=/api/v1`** — a relative path. Never an absolute origin; there is no CORS on the backend.
- **TypeScript is `~6.0.3`, not 7.x.** No typescript-eslint release supports TS 7.
- **`@types/node` is `24.13.6`** — matches the Node 24 runtime, not npm latest.
- **Never install:** `@tanstack/zod-form-adapter` (dead), `react-hook-form`, `@hookform/resolvers`, `next-themes`, `eslint-plugin-react-compiler`, `radix-ui` (the unified package), `vitest-axe`.
- **Never run `shadcn add form`** — its registry entry pulls `react-hook-form`. The form primitive is hand-written against TanStack Form.
- **Never run `shadcn add toast`** — Sonner is the only toast system.
- The lint config file is `eslint.config.js`, not `.mjs`.
- The access token lives in memory only. Never `localStorage`, never a cookie the frontend sets.
- Every API response is `{success, message, statusCode, data}` or `{success, message, statusCode, code?, errors?, requestId}`.
- Commit after every task. Conventional Commits, matching express-boilerplate's style.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/api.types.ts` | Response envelopes, `User`, `ApiErrorBody`. No logic. |
| `src/states/auth.store.ts` | In-memory token + user + `isBootstrapped`. No HTTP. |
| `src/states/theme.store.ts` | Theme preference, persisted, applies the `<html>` class. |
| `src/states/sidebar.store.ts` | Sidebar collapsed flag. |
| `src/http/client.ts` | The axios instance. No auth logic. |
| `src/http/session.ts` | `ensureSession()` — the single-flight refresh. The one place that calls `/auth/refresh`. |
| `src/http/interceptors.ts` | Bearer attach; 401 → `ensureSession()` → replay once. |
| `src/schemas/*.schemas.ts` | Zod mirrors of the backend validators. |
| `src/queries/*.queries.ts` | TanStack Query hooks. One file per API resource. |
| `src/constants/roles.ts` | Pure role predicates mirroring the backend matrix. |
| `src/hooks/use-notifications.ts` | SSE lifecycle. The only `EventSource` in the codebase. |
| `src/components/ui/*` | shadcn primitives. Excluded from the Tailwind lint rules. |
| `src/components/ui/form.tsx` | Hand-written TanStack Form bridge. Not from the shadcn CLI. |
| `src/components/layouts/*` | `auth-layout.tsx`, `app-layout.tsx`. Presentation only. |
| `src/pages/**` | Routes. Guards live in `_auth.tsx` / `_app.tsx`, never in leaves. |

Splitting `session.ts` out of `interceptors.ts` is load-bearing: bootstrap, the 401 path and the SSE reconnect all need the same promise, and a promise owned by an interceptor module is hard for the other two to reach.

---

### Task 1: Scaffold

**What:** Wipe `src/`, install the exact dependency set, and get `pnpm dev`, `pnpm lint`, `pnpm typecheck` and `pnpm test` all running green on an empty app.

**Files:**
- Delete: `src/**`, `yarn.lock`, `postcss.config.js`, `tailwind.config.js`
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `eslint.config.js`, `prettier.config.js`, `index.html`
- Create: `src/styles/globals.css`, `src/lib/utils.ts`, `src/main.tsx`, `vitest.config.ts`, `src/tests/setup.ts`, `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: the `@/` alias resolving to `src/`; `cn(...inputs: ClassValue[]): string` from `@/lib/utils`.

- [ ] **Step 1: Clear the old source tree and stale config**

```bash
rm -rf src
rm -f yarn.lock postcss.config.js tailwind.config.js
mkdir -p src/styles src/lib src/tests
```

Tailwind 4 needs neither `postcss.config.js` nor `tailwind.config.js` — the Vite plugin and `@theme` in CSS replace both.

- [ ] **Step 2: Rewrite `package.json`**

```json
{
  "name": "react-boilerplate",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "description": "React boilerplate for Mahaverick Labs projects",
  "author": { "name": "Mahaverick Labs", "email": "support@mahaverick.com" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.app.json",
    "format": "prettier --write \"src/**/*.{ts,tsx,css}\"",
    "test": "vitest --watch=false",
    "test:watch": "vitest",
    "prepare": "husky"
  }
}
```

- [ ] **Step 3: Install the exact dependency set**

```bash
corepack enable

pnpm add react@19.3.0 react-dom@19.3.0 \
  @tanstack/react-router@1.170.38 @tanstack/react-query@5.103.2 @tanstack/react-form@1.33.5 \
  zustand@5.0.15 zod@4.6.5 axios@1.20.0 sonner@2.0.8 lucide-react@1.47.0 \
  clsx@2.1.1 tailwind-merge@3.7.0 class-variance-authority@0.7.1

pnpm add -D typescript@~6.0.3 @types/react@19.3.0 @types/react-dom@19.3.0 @types/node@24.13.6 \
  vite@8.3.0 @vitejs/plugin-react@6.1.1 babel-plugin-react-compiler@1.0.0 @rolldown/plugin-babel@0.2.4 \
  tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 \
  @tanstack/router-plugin@1.168.40 @tanstack/react-router-devtools@1.167.2 @tanstack/react-query-devtools@5.103.2 \
  eslint@10.11.0 @eslint/js@10.0.1 typescript-eslint@8.70.0 globals@17.12.0 \
  eslint-config-prettier@10.1.8 eslint-plugin-react-hooks@7.1.1 eslint-plugin-react-refresh@0.5.7 \
  eslint-plugin-tailwindcss@4.4.0 \
  prettier@3.9.8 @ianvs/prettier-plugin-sort-imports@4.7.1 prettier-plugin-tailwindcss@0.8.1 \
  vitest@5.0.1 @vitest/coverage-v8@5.0.1 \
  @testing-library/react@16.3.3 @testing-library/dom@10.4.2 @testing-library/jest-dom@7.0.1 \
  @testing-library/user-event@14.6.7 jsdom@30.1.0 msw@2.15.0 \
  jest-axe@11.0.0 @types/jest-axe@3.5.9 axe-core@4.13.0 husky@9.1.7
```

Versions are pinned exactly, without `^`, matching express-boilerplate. Do not substitute `@latest` for any of them — `typescript@latest` is 7.x and breaks type-aware linting.

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import path from 'node:path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/pages',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react({ compiler: true }),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4040', changeOrigin: true } },
  },
})
```

The import is `tanstackRouter`, not `TanStackRouterVite` — the latter is a deprecated alias.

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
})
```

A separate config from `vite.config.ts` so tests never load the router plugin, which would try to generate a route tree mid-test-run.

- [ ] **Step 6: Write `src/tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { toHaveNoViolations } from 'jest-axe'
import { expect } from 'vitest'

expect.extend(toHaveNoViolations)
```

`jest-axe` is framework-agnostic; `expect.extend` is what makes it work under Vitest.

- [ ] **Step 7: Write `src/styles/globals.css`**

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

The dark variant is a **class**, not a media query — the theme is a stored user preference (spec §9). The reduced-motion block is a spec §9 acceptance criterion, not decoration.

- [ ] **Step 8: Write `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 9: Write `index.html` with the pre-paint theme script**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React Boilerplate</title>
    <script>
      // Runs before the bundle. Without this the page paints light and then
      // flips to dark on every load for dark-mode users. Spec section 9.
      try {
        var stored = localStorage.getItem('theme')
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        var isDark = stored === 'dark' || ((stored === 'system' || !stored) && prefersDark)
        document.documentElement.classList.toggle('dark', isDark)
      } catch (_) {
        /* private mode, blocked storage: fall through to light */
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

The `try/catch` matters: `localStorage` throws in some privacy modes, and an uncaught throw here blocks the bundle from loading at all.

- [ ] **Step 10: Write a placeholder `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="p-8">Scaffold OK</div>
  </StrictMode>
)
```

Task 4 replaces this with the router. It exists now only so Step 14 can prove the toolchain works.

- [ ] **Step 11: Write `tsconfig.json` and `tsconfig.app.json`**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "composite": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 12: Write `eslint.config.js`**

```js
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tailwindcss from 'eslint-plugin-tailwindcss'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'src/routeTree.gen.ts', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  tailwindcss.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**'],
    settings: { tailwindcss: { cssConfigPath: './src/styles/globals.css' } },
    rules: { 'tailwindcss/classnames-order': 'off' },
  },
  prettier
)
```

Three things here are verified against a live fixture, not the plugin's README, and will break if changed:
1. `tailwindcss.configs.recommended` — `configs['flat/recommended']` is **undefined** in 4.4.0 and throws `TypeError: Config (unnamed): Unexpected undefined config at user-defined index 0`.
2. `cssConfigPath` is mandatory. With it set, `@theme` tokens like `bg-sidebar` validate cleanly and need no whitelist.
3. `classnames-order` is off because `prettier-plugin-tailwindcss` already sorts; two sorters fight.

`eslint-config-prettier` must stay last.

- [ ] **Step 13: Write `prettier.config.js`**

```js
export default {
  semi: false,
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  trailingComma: 'es5',
  plugins: ['@ianvs/prettier-plugin-sort-imports', 'prettier-plugin-tailwindcss'],
  importOrder: ['<BUILTIN_MODULES>', '<THIRD_PARTY_MODULES>', '^@/(.*)$', '^[./]'],
  importOrderTypeScriptVersion: '5.0.0',
  tailwindStylesheet: './src/styles/globals.css',
  tailwindFunctions: ['cn', 'cva'],
}
```

`prettier-plugin-tailwindcss` must be **last** in `plugins` — it is documented to conflict otherwise, and it is the single class sorter for this project.

- [ ] **Step 14: Write `.env.example`**

```
VITE_API_URL=/api/v1
VITE_ENABLE_DEVTOOLS=true
```

A relative path, deliberately. There is no `VITE_GOOGLE_OAUTH_URL` — the Google control is a same-origin anchor.

- [ ] **Step 15: Verify the whole toolchain**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: lint clean, typecheck clean, `vitest` exits 0 reporting "No test files found" (acceptable at this stage), build emits `dist/`.

Then `pnpm dev` and load `http://localhost:5173` — expect "Scaffold OK" with no console errors.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "feat: scaffold React 19 + Vite 8 + Tailwind 4 toolchain

Replaces the React 18 / Redux / Tailwind 3 tree wholesale. Pins every
dependency exactly; TypeScript is held at ~6.0.3 and @types/node at 24.x
because typescript-eslint supports neither TS 7 nor a Node 26 runtime.

Drops yarn.lock for pnpm, and both Tailwind 3 config files, which
Tailwind 4 replaces with the Vite plugin and @theme."
```

---

### Task 2: API types and stores

**What:** The response envelope types, the `User` shape, and the three Zustand stores. No HTTP yet.

**Files:**
- Create: `src/types/api.types.ts`, `src/states/auth.store.ts`, `src/states/theme.store.ts`, `src/states/sidebar.store.ts`, `src/constants/routes.ts`
- Test: `src/states/auth.store.test.ts`, `src/states/theme.store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ApiSuccess<T> = { success: true; message: string; statusCode: number; data: T }`
  - `type ApiErrorBody = { success: false; message: string; statusCode: number; code?: string; errors?: unknown; requestId: string }`
  - `interface User { id: string; email: string; firstName: string | null; lastName: string | null; createdAt: string }`
  - `useAuthStore` with `{ accessToken, user, isAuthenticated, isBootstrapped, login(token, user), logout(), setToken(token), setBootstrapped() }`
  - `useThemeStore` with `{ theme: Theme, setTheme(t: Theme) }` where `type Theme = 'light' | 'dark' | 'system'`
  - `useSidebarStore` with `{ isCollapsed: boolean, toggle(): void }`
  - `ROUTES` constant object

- [ ] **Step 1: Write `src/types/api.types.ts`**

```ts
export interface ApiSuccess<T> {
  success: true
  message: string
  statusCode: number
  data: T
}

export interface ApiErrorBody {
  success: false
  message: string
  statusCode: number
  /** Stable machine-readable discriminator, e.g. ACCESS_TOKEN_EXPIRED. */
  code?: string
  /** Field-level validator detail, shaped by the backend's Zod flatten. */
  errors?: Record<string, string[]>
  requestId: string
}

/** Exactly `toPublicUser` on the server: AuthenticatedUser plus createdAt. */
export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string
}

export const ACCESS_TOKEN_EXPIRED = 'ACCESS_TOKEN_EXPIRED'
```

`User` has five fields and no provider list — the backend exposes no auth-provider data (spec §3).

- [ ] **Step 2: Write the failing auth store test**

`src/states/auth.store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import type { User } from '@/types/api.types'

const user: User = {
  id: 'u1',
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('auth store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('starts unauthenticated and unbootstrapped', () => {
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.isAuthenticated).toBe(false)
    expect(s.isBootstrapped).toBe(false)
  })

  it('login sets token, user and isAuthenticated together', () => {
    useAuthStore.getState().login('tok', user)
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('tok')
    expect(s.user).toEqual(user)
    expect(s.isAuthenticated).toBe(true)
  })

  it('setToken replaces the token without touching the user', () => {
    useAuthStore.getState().login('tok', user)
    useAuthStore.getState().setToken('tok2')
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('tok2')
    expect(s.user).toEqual(user)
    expect(s.isAuthenticated).toBe(true)
  })

  it('logout clears token, user and isAuthenticated but preserves isBootstrapped', () => {
    useAuthStore.getState().login('tok', user)
    useAuthStore.getState().setBootstrapped()
    useAuthStore.getState().logout()
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.user).toBeNull()
    expect(s.isAuthenticated).toBe(false)
    expect(s.isBootstrapped).toBe(true)
  })
})
```

The last assertion is the important one: logging out must not make guards think the session is still being restored, or `_app` would hang on a spinner forever instead of redirecting to `/login`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/states/auth.store.test.ts`
Expected: FAIL — cannot resolve `@/states/auth.store`.

- [ ] **Step 4: Write `src/states/auth.store.ts`**

```ts
import { create } from 'zustand'
import type { User } from '@/types/api.types'

interface AuthState {
  accessToken: string | null
  user: User | null
  isAuthenticated: boolean
  /** True once the one-time session restore has settled, success or failure. */
  isBootstrapped: boolean
  login: (token: string, user: User) => void
  logout: () => void
  setToken: (token: string) => void
  setBootstrapped: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isBootstrapped: false,
  login: (accessToken, user) => set({ accessToken, user, isAuthenticated: true }),
  logout: () => set({ accessToken: null, user: null, isAuthenticated: false }),
  setToken: (accessToken) => set({ accessToken }),
  setBootstrapped: () => set({ isBootstrapped: true }),
}))
```

No `persist` middleware. The access token is memory-only by design; persisting it to `localStorage` would hand it to any XSS on the page.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/states/auth.store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing theme store test**

`src/states/theme.store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '@/states/theme.store'

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ theme: 'system' })
  })

  it('applies the dark class when set to dark', () => {
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('removes the dark class when set to light', () => {
    useThemeStore.getState().setTheme('dark')
    useThemeStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('follows the OS preference when set to system', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    useThemeStore.getState().setTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
```

jsdom does not implement `matchMedia`, so the third test stubs it. Without the stub the store throws rather than failing an assertion.

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm vitest run src/states/theme.store.test.ts`
Expected: FAIL — cannot resolve `@/states/theme.store`.

- [ ] **Step 8: Write `src/states/theme.store.ts`**

```ts
import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function applyTheme(theme: Theme): void {
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', isDark)
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  } catch {
    return 'system'
  }
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* private mode: apply for this session only */
    }
    applyTheme(theme)
    set({ theme })
  },
}))
```

The storage key is `'theme'` — the same key the `index.html` pre-paint script reads. If these two ever disagree, dark-mode users get a flash of light on every load.

Every `localStorage` access is wrapped: it throws outright in some privacy modes, and an uncaught throw at module scope would take down the whole app.

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm vitest run src/states/theme.store.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 10: Write `src/states/sidebar.store.ts`**

```ts
import { create } from 'zustand'

interface SidebarState {
  isCollapsed: boolean
  toggle: () => void
  setCollapsed: (isCollapsed: boolean) => void
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  isCollapsed: false,
  toggle: () => set((s) => ({ isCollapsed: !s.isCollapsed })),
  setCollapsed: (isCollapsed) => set({ isCollapsed }),
}))
```

- [ ] **Step 11: Write `src/constants/routes.ts`**

```ts
export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  oauthCallback: '/auth/callback',
  dashboard: '/dashboard',
  profile: '/profile',
  notifications: '/notifications',
  tenants: '/tenants',
  tenant: (slug: string) => `/tenants/${slug}`,
  tenantMembers: (slug: string) => `/tenants/${slug}/members`,
  tenantSettings: (slug: string) => `/tenants/${slug}/settings`,
} as const

/** The API path for the Google OAuth start. Same-origin, so a plain anchor. */
export const GOOGLE_OAUTH_PATH = '/api/v1/auth/google'
```

`GOOGLE_OAUTH_PATH` is deliberately not a `VITE_` variable — it is same-origin and fixed.

- [ ] **Step 12: Run the full suite and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat: add API envelope types and Zustand stores

The auth store holds the access token in memory only and exposes
isBootstrapped so route guards can tell 'not signed in' from 'session
restore still running'. logout() deliberately leaves isBootstrapped set.

The theme store shares its storage key with the pre-paint script in
index.html; every localStorage access is guarded because it throws
outright in some privacy modes."
```

---

### Task 3: HTTP client, single-flight session, interceptors

**What:** The axios instance, `ensureSession()`, and the 401 retry path. This is the highest-risk code in Phase A — the backend rotates the refresh cookie on every call, so a second concurrent refresh kills the session.

**Files:**
- Create: `src/http/client.ts`, `src/http/session.ts`, `src/http/interceptors.ts`
- Test: `src/http/session.test.ts`, `src/http/interceptors.test.ts`
- Create: `src/tests/mocks/handlers.ts`, `src/tests/mocks/server.ts`
- Modify: `src/tests/setup.ts`

**Interfaces:**
- Consumes: `useAuthStore` (Task 2), `ApiSuccess`, `ApiErrorBody`, `User`, `ACCESS_TOKEN_EXPIRED` (Task 2).
- Produces:
  - `apiClient: AxiosInstance` from `@/http/client`
  - `ensureSession(): Promise<string>` from `@/http/session` — resolves to a fresh access token, rejects after logging out
  - `resetSessionForTests(): void` from `@/http/session`
  - `installInterceptors(client: AxiosInstance): void` from `@/http/interceptors`
  - `unwrap<T>(response: AxiosResponse<ApiSuccess<T>>): T` from `@/http/client`

- [ ] **Step 1: Write `src/http/client.ts`**

```ts
import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import type { ApiSuccess } from '@/types/api.types'

export const apiClient: AxiosInstance = axios.create({
  // Relative on purpose. The API has no CORS middleware, so the SPA is
  // served same-origin behind a proxy (Vite in dev, nginx in prod). An
  // absolute origin here would be blocked by the browser AND would bypass
  // the proxy. Spec section 1.
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

/** Strip the success envelope, which every endpoint on this API returns. */
export function unwrap<T>(response: AxiosResponse<ApiSuccess<T>>): T {
  return response.data.data
}
```

`withCredentials: true` is required even same-origin: axios omits cookies on XHR without it, and the refresh cookie is how `/auth/refresh` authenticates.

- [ ] **Step 2: Write `src/tests/mocks/server.ts` and wire it into setup**

`src/tests/mocks/server.ts`:
```ts
import { setupServer } from 'msw/node'
import { handlers } from '@/tests/mocks/handlers'

export const server = setupServer(...handlers)
```

`src/tests/mocks/handlers.ts` (starting set; later tasks extend it):
```ts
import { http, HttpResponse } from 'msw'
import type { User } from '@/types/api.types'

export const testUser: User = {
  id: 'u1',
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return HttpResponse.json({ success: true, message, statusCode, data }, { status: statusCode })
}

export function fail(message: string, statusCode: number, code?: string) {
  return HttpResponse.json(
    { success: false, message, statusCode, code, requestId: 'test-request-id' },
    { status: statusCode }
  )
}

export const handlers = [
  http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
]
```

Append to `src/tests/setup.ts`:
```ts
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '@/tests/mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

`onUnhandledRequest: 'error'` is deliberate: a test that hits an unmocked URL should fail loudly, not silently pass against a real network.

- [ ] **Step 3: Write the failing session test**

`src/http/session.test.ts`:
```ts
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureSession, resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('ensureSession', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('refreshes then fetches the profile, because refresh returns no user', async () => {
    const token = await ensureSession()
    expect(token).toBe('fresh-token')
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('fresh-token')
    expect(s.user).toEqual(testUser)
    expect(s.isAuthenticated).toBe(true)
  })

  it('issues exactly ONE refresh for N concurrent callers', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )

    const tokens = await Promise.all([ensureSession(), ensureSession(), ensureSession()])

    expect(refreshCount).toBe(1)
    expect(tokens).toEqual(['fresh-token', 'fresh-token', 'fresh-token'])
  })

  it('logs out and rejects when the refresh fails', async () => {
    useAuthStore.getState().login('stale', testUser)
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))

    await expect(ensureSession()).rejects.toThrow()
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.isAuthenticated).toBe(false)
  })

  it('allows a new refresh after the previous one settled', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return ok({ accessToken: `token-${refreshCount}` }, 'Token refreshed.')
      })
    )

    await ensureSession()
    await ensureSession()

    expect(refreshCount).toBe(2)
  })
})
```

The second test is the one that matters. The backend rotates the refresh token on every call, so if two refreshes ever run concurrently the second presents a consumed token and the user is silently signed out. The fourth test guards the opposite mistake: caching the promise forever so the token can never be refreshed twice.

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run src/http/session.test.ts`
Expected: FAIL — cannot resolve `@/http/session`.

- [ ] **Step 5: Write `src/http/session.ts`**

```ts
import { apiClient, unwrap } from '@/http/client'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

/**
 * The single in-flight refresh. Every caller — bootstrap, the 401
 * interceptor, and the SSE reconnect path — awaits this same promise.
 *
 * This is not an optimisation. POST /auth/refresh ROTATES the refresh
 * cookie, so a second concurrent call presents an already-consumed token
 * and the backend ends the session. One promise is what prevents that.
 */
let inFlight: Promise<string> | null = null

async function refreshSession(): Promise<string> {
  try {
    const refreshResponse =
      await apiClient.post<ApiSuccess<{ accessToken: string }>>('/auth/refresh')
    const { accessToken } = unwrap(refreshResponse)

    // /auth/refresh returns ONLY an access token — no user. The profile
    // call is therefore not optional if the store is to be usable.
    const profileResponse = await apiClient.get<ApiSuccess<User>>('/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    useAuthStore.getState().login(accessToken, unwrap(profileResponse))
    return accessToken
  } catch (error) {
    useAuthStore.getState().logout()
    throw error
  }
}

export function ensureSession(): Promise<string> {
  inFlight ??= refreshSession().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Test-only: drop the cached promise between cases. */
export function resetSessionForTests(): void {
  inFlight = null
}
```

The profile request carries its `Authorization` header explicitly rather than relying on the interceptor, because the store has not been updated yet at that point in the sequence.

`.finally()` clearing `inFlight` is what makes a *later* refresh possible while still collapsing *concurrent* ones.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/http/session.test.ts`
Expected: PASS, 4 tests — including `refreshCount === 1` for three concurrent callers.

- [ ] **Step 7: Write the failing interceptor test**

`src/http/interceptors.test.ts`:
```ts
import axios from 'axios'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { ACCESS_TOKEN_EXPIRED } from '@/types/api.types'

function makeClient() {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true })
  installInterceptors(client)
  return client
}

describe('auth interceptors', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('attaches the bearer token when one is present', async () => {
    useAuthStore.getState().login('tok', testUser)
    let seen: string | null = null
    server.use(
      http.get('/api/v1/widgets', ({ request }) => {
        seen = request.headers.get('authorization')
        return ok([])
      })
    )

    await makeClient().get('/widgets')
    expect(seen).toBe('Bearer tok')
  })

  it('sends no auth header when there is no token', async () => {
    let seen: string | null = 'unset'
    server.use(
      http.get('/api/v1/widgets', ({ request }) => {
        seen = request.headers.get('authorization')
        return ok([])
      })
    )

    await makeClient().get('/widgets')
    expect(seen).toBeNull()
  })

  it('refreshes and replays once on ACCESS_TOKEN_EXPIRED', async () => {
    useAuthStore.getState().login('stale', testUser)
    let attempts = 0
    server.use(
      http.get('/api/v1/widgets', ({ request }) => {
        attempts += 1
        if (request.headers.get('authorization') === 'Bearer stale') {
          return fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
        }
        return ok(['widget'])
      })
    )

    const response = await makeClient().get('/widgets')
    expect(attempts).toBe(2)
    expect(response.data.data).toEqual(['widget'])
    expect(useAuthStore.getState().accessToken).toBe('fresh-token')
  })

  it('fires ONE refresh for several concurrent expired requests', async () => {
    useAuthStore.getState().login('stale', testUser)
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      }),
      http.get('/api/v1/widgets', ({ request }) =>
        request.headers.get('authorization') === 'Bearer stale'
          ? fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
          : ok(['widget'])
      )
    )

    const client = makeClient()
    await Promise.all([client.get('/widgets'), client.get('/widgets'), client.get('/widgets')])

    expect(refreshCount).toBe(1)
  })

  it('does not retry a 401 that lacks the expiry code', async () => {
    useAuthStore.getState().login('tok', testUser)
    let attempts = 0
    server.use(
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return fail('Forbidden', 401)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(attempts).toBe(1)
  })

  it('never retries the same request twice', async () => {
    useAuthStore.getState().login('stale', testUser)
    let attempts = 0
    server.use(
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(attempts).toBe(2)
  })
})
```

The last two tests bound the retry logic from both sides: a 401 without the expiry code is a real authorisation failure and must surface, and an endpoint that 401s forever must not loop.

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm vitest run src/http/interceptors.test.ts`
Expected: FAIL — cannot resolve `@/http/interceptors`.

- [ ] **Step 9: Write `src/http/interceptors.ts`**

```ts
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { ROUTES } from '@/constants/routes'
import { ensureSession } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { ACCESS_TOKEN_EXPIRED, type ApiErrorBody } from '@/types/api.types'

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean
}

export function installInterceptors(client: AxiosInstance): void {
  client.interceptors.request.use((config) => {
    const { accessToken } = useAuthStore.getState()
    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`)
    }
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiErrorBody>) => {
      const config = error.config as RetriableConfig | undefined
      const isExpired =
        error.response?.status === 401 && error.response.data?.code === ACCESS_TOKEN_EXPIRED

      // Only an EXPIRED token is retriable. A plain 401 is a real
      // authorisation failure and must reach the caller. `_retried` stops
      // an endpoint that 401s unconditionally from looping.
      if (!isExpired || !config || config._retried) {
        return Promise.reject(error)
      }

      config._retried = true

      try {
        const accessToken = await ensureSession()
        config.headers.set('Authorization', `Bearer ${accessToken}`)
        return await client.request(config)
      } catch (refreshError) {
        // ensureSession has already cleared the store.
        if (typeof window !== 'undefined') {
          window.location.assign(ROUTES.login)
        }
        return Promise.reject(refreshError)
      }
    }
  )
}
```

`ensureSession()` is what makes N concurrent 401s produce one refresh — the interceptor holds no promise of its own.

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm vitest run src/http/interceptors.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 11: Install the interceptors on the shared client**

Append to `src/http/client.ts`:
```ts
import { installInterceptors } from '@/http/interceptors'

installInterceptors(apiClient)
```

Place this at the bottom of the file, after `apiClient` is created — `interceptors.ts` imports `session.ts`, which imports `client.ts`, and a top-of-file import would read `apiClient` before it is assigned.

- [ ] **Step 12: Run everything and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat: add HTTP client with single-flight session refresh

POST /auth/refresh rotates the refresh cookie, so two concurrent
refreshes mean the second presents a consumed token and the session
dies. ensureSession() owns one module-level promise that bootstrap, the
401 interceptor and the SSE reconnect path all await.

Refresh returns only an access token, so ensureSession also fetches the
profile. Only 401s carrying ACCESS_TOKEN_EXPIRED are retried, and never
more than once."
```

---

### Task 4: Router, bootstrap, layouts and guards

**What:** The router, the root route whose `beforeLoad` restores the session, the two layout routes that guard on the result, and the shadcn primitives the layouts need.

**Files:**
- Create: `src/router.tsx`, `src/pages/__root.tsx`, `src/pages/index.tsx`, `src/pages/_auth.tsx`, `src/pages/_app.tsx`, `src/components/layouts/auth-layout.tsx`
- Modify: `src/main.tsx`
- Test: `src/pages/guards.test.tsx`

**Interfaces:**
- Consumes: `ensureSession()` (Task 3), `useAuthStore` (Task 2), `ROUTES` (Task 2).
- Produces:
  - `router` from `@/router`
  - `bootstrapSession(): Promise<void>` from `@/router` — awaited by `__root`'s `beforeLoad`
  - `queryClient: QueryClient` from `@/router`

- [ ] **Step 1: Install the shadcn primitives**

```bash
pnpm dlx shadcn@4.21.0 init
```

Answer: Vite, TypeScript, New York, Neutral base colour, `src/styles/globals.css`, CSS variables **yes**, `@/components`, `@/lib/utils`.

`init` will offer to overwrite `globals.css`. **Decline** — Task 1 already wrote the token set. If it overwrites anyway, restore with `git checkout src/styles/globals.css`.

```bash
pnpm dlx shadcn@4.21.0 add button card input label separator skeleton avatar badge \
  dropdown-menu dialog sheet tabs table tooltip select switch textarea \
  sidebar breadcrumb sonner alert-dialog
```

**Do not add `form`** — its registry entry declares `react-hook-form` and `@hookform/resolvers`. **Do not add `toast`** — Sonner is the toast system.

- [ ] **Step 2: Strip `next-themes` out of the generated Sonner component**

`shadcn add sonner` generates a component importing `next-themes`, which is a Next.js library. Replace `src/components/ui/sonner.tsx` entirely:

```tsx
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useThemeStore } from '@/states/theme.store'

export function Toaster({ ...props }: ToasterProps) {
  const theme = useThemeStore((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
```

Then confirm it is gone:
```bash
pnpm remove next-themes 2>/dev/null || true
grep -r "next-themes" src/ && echo "STILL PRESENT — fix before continuing" || echo "clean"
```

- [ ] **Step 3: Write `src/router.tsx`**

```tsx
import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { ensureSession } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { routeTree } from '@/routeTree.gen'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

/**
 * Restore the session once per page load.
 *
 * The access token is memory-only, so every reload starts signed out.
 * Without this, `_app` would bounce a signed-in user to /login and
 * `_auth` would let them sit on /login while their cookie was still good.
 *
 * ensureSession() already dedupes concurrent callers and already calls
 * logout() on failure, so this only has to flip isBootstrapped.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().isBootstrapped) return
  try {
    await ensureSession()
  } catch {
    /* no valid refresh cookie: staying signed out is the correct outcome */
  } finally {
    useAuthStore.getState().setBootstrapped()
  }
}

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
```

The `catch` is intentionally empty and documented: a missing or expired refresh cookie is the normal state for a signed-out visitor, not an error to surface.

- [ ] **Step 4: Write `src/pages/__root.tsx`**

```tsx
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { bootstrapSession } from '@/router'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Awaited BEFORE any child guard runs. A useEffect would let _app and
  // _auth observe an empty store and redirect wrongly on every reload.
  beforeLoad: async () => {
    await bootstrapSession()
  },
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster position="top-right" richColors closeButton />
    </>
  )
}
```

Devtools are deliberately omitted here; add them behind `import.meta.env.VITE_ENABLE_DEVTOOLS` only if wanted, and never in the production bundle.

- [ ] **Step 5: Write the guards**

`src/pages/_auth.tsx`:
```tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_auth')({
  beforeLoad: () => {
    // __root's beforeLoad has already awaited bootstrapSession(), so the
    // store is settled by the time this runs.
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.dashboard })
    }
  },
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
})
```

`src/pages/_app.tsx`:
```tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: location.href } })
    }
  },
  component: Outlet,
})
```

Task 6 replaces `_app`'s component with `AppLayout`. It is a bare `Outlet` now so this task's guard test can run without the sidebar existing.

- [ ] **Step 6: Write `src/pages/index.tsx` and `src/components/layouts/auth-layout.tsx`**

`src/pages/index.tsx`:
```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: useAuthStore.getState().isAuthenticated ? ROUTES.dashboard : ROUTES.login,
    })
  },
})
```

`src/components/layouts/auth-layout.tsx`:
```tsx
import type { ReactNode } from 'react'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-4 sm:p-6">
      <main className="w-full max-w-md">{children}</main>
    </div>
  )
}
```

`<main>` is a landmark element, not decoration — the axe checks in Task 9 assert every page has one.

- [ ] **Step 7: Rewrite `src/main.tsx`**

```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
```

- [ ] **Step 8: Write the failing guard test**

`src/pages/guards.test.tsx`:
```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { bootstrapSession } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { resetSessionForTests } from '@/http/session'
import { server } from '@/tests/mocks/server'
import { fail } from '@/tests/mocks/handlers'
import { http } from 'msw'

describe('session bootstrap', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('restores a session from the refresh cookie', async () => {
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isBootstrapped).toBe(true)
  })

  it('settles as signed-out when there is no valid cookie', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    // The critical assertion: bootstrapped must be TRUE even on failure, or
    // a guard waiting on it would hang forever instead of redirecting.
    expect(s.isBootstrapped).toBe(true)
  })

  it('runs the refresh only once across concurrent callers', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return HttpResponseOk()
      })
    )
    await Promise.all([bootstrapSession(), bootstrapSession(), bootstrapSession()])
    expect(refreshCount).toBe(1)
  })
})

function HttpResponseOk() {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Token refreshed.',
      statusCode: 200,
      data: { accessToken: 'fresh-token' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
```

- [ ] **Step 9: Run the test**

Run: `pnpm vitest run src/pages/guards.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 10: Verify the app boots and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Then `pnpm dev` — `/` must redirect to `/login` with no console errors. `src/routeTree.gen.ts` will have been generated; it is git-tracked but lint-ignored.

```bash
git add -A
git commit -m "feat: add router with session bootstrap and route guards

__root's beforeLoad awaits bootstrapSession() so no guard ever observes
a half-restored store. isBootstrapped is set even when the refresh
fails, otherwise a guard waiting on it would hang instead of redirecting.

Replaces the generated Sonner component, which imports next-themes, with
one reading this project's Zustand theme store."
```

---

### Task 5: Form bridge, auth schemas and auth pages

**What:** The hand-written TanStack Form bridge, Zod schemas mirroring the backend validators, the auth mutations, and all six unauthenticated pages.

**Files:**
- Create: `src/components/ui/form.tsx`, `src/schemas/auth.schemas.ts`, `src/queries/auth.queries.ts`, `src/lib/api-error.ts`
- Create: `src/pages/_auth/login.tsx`, `register.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `verify-email.tsx`, `src/pages/auth/callback.tsx`
- Test: `src/schemas/auth.schemas.test.ts`, `src/pages/_auth/login.test.tsx`

**Interfaces:**
- Consumes: `apiClient`, `unwrap` (Task 3); `useAuthStore`, `User`, `ApiErrorBody` (Task 2).
- Produces:
  - `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `FormField`, `useFormField` from `@/components/ui/form`
  - `loginSchema`, `registerSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `verifyEmailSchema`, `resendVerificationSchema` from `@/schemas/auth.schemas`
  - `useLogin`, `useRegister`, `useForgotPassword`, `useResetPassword`, `useVerifyEmail`, `useResendVerification`, `useLogout` from `@/queries/auth.queries`
  - `fieldErrorsFrom(error: unknown): Record<string, string[]>` and `messageFrom(error: unknown): string` from `@/lib/api-error`

- [ ] **Step 1: Write the failing schema test**

`src/schemas/auth.schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema, verifyEmailSchema } from '@/schemas/auth.schemas'

describe('auth schemas', () => {
  it('login requires a password but applies no policy to it', () => {
    // Login compares against a stored hash. A policy here would reject a
    // password that was legal when it was set and is not now.
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false)
  })

  it('login rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'secret123' }).success).toBe(false)
  })

  it('register enforces the 8-character minimum', () => {
    const base = { email: 'a@b.com', firstName: 'A', lastName: 'B' }
    expect(registerSchema.safeParse({ ...base, password: 'short7c' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, password: 'longenough8' }).success).toBe(true)
  })

  it('verify-email requires BOTH a token and a password', () => {
    expect(verifyEmailSchema.safeParse({ token: 't' }).success).toBe(false)
    expect(verifyEmailSchema.safeParse({ token: 't', password: 'p' }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/schemas/auth.schemas.test.ts`
Expected: FAIL — cannot resolve `@/schemas/auth.schemas`.

- [ ] **Step 3: Write `src/schemas/auth.schemas.ts`**

```ts
import { z } from 'zod'

const MIN_PASSWORD_LENGTH = 8
const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 100

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(MAX_EMAIL_LENGTH, `Email must be at most ${MAX_EMAIL_LENGTH} characters.`)

/** Registration/reset policy. NOT used for login or verify-email. */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`)

const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH)

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately policy-free: this is a comparison against a stored hash,
  // exactly like the backend's loginSchema.
  password: z.string().min(1, 'Password is required.'),
})

export const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Token is required.'),
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required.'),
  // The backend requires the account password here and does not treat it
  // as optional. No policy applied, for the same reason as login.
  password: z.string().min(1, 'Password is required.'),
})

export const resendVerificationSchema = z.object({ email: emailSchema })

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/schemas/auth.schemas.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `src/lib/api-error.ts`**

```ts
import { AxiosError } from 'axios'
import type { ApiErrorBody } from '@/types/api.types'

export function messageFrom(error: unknown): string {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.message) return body.message
  }
  return 'Something went wrong. Please try again.'
}

/** Field-level validator detail, for mapping onto form inputs. */
export function fieldErrorsFrom(error: unknown): Record<string, string[]> {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.errors && typeof body.errors === 'object') return body.errors
  }
  return {}
}
```

- [ ] **Step 6: Write `src/components/ui/form.tsx`**

This replaces the shadcn `form` component, which is built on react-hook-form. Same export surface, TanStack Form underneath, so call sites read the same.

```tsx
import type { AnyFieldApi, AnyFormApi } from '@tanstack/react-form'
import { Slot } from '@radix-ui/react-slot'
import * as React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FormFieldContextValue {
  name: string
  errors: unknown[]
  formItemId: string
  formMessageId: string
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

export function useFormField(): FormFieldContextValue {
  const context = React.useContext(FormFieldContext)
  if (!context) throw new Error('useFormField must be used inside a <FormField>')
  return context
}

/** The form element itself. TanStack Form has no provider component. */
export function Form({
  form,
  className,
  children,
  ...props
}: React.ComponentProps<'form'> & { form: AnyFormApi }) {
  return (
    <form
      noValidate
      className={cn('space-y-4', className)}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      {...props}
    >
      {children}
    </form>
  )
}

/**
 * Bridges one TanStack field into the context the presentational parts read.
 * The provider is its own component because it calls useId, and hooks
 * cannot be called inside a render-prop callback.
 */
export function FormField({
  form,
  name,
  children,
}: {
  form: AnyFormApi
  name: string
  children: (field: AnyFieldApi) => React.ReactNode
}) {
  const Field = form.Field as React.ComponentType<{
    name: string
    children: (field: AnyFieldApi) => React.ReactNode
  }>
  return (
    <Field name={name}>
      {(field) => <FieldProvider field={field}>{children(field)}</FieldProvider>}
    </Field>
  )
}

function FieldProvider({
  field,
  children,
}: {
  field: AnyFieldApi
  children: React.ReactNode
}) {
  const id = React.useId()
  const errors = field.state.meta.errors as unknown[]
  const value = React.useMemo<FormFieldContextValue>(
    () => ({
      name: String(field.name),
      errors,
      formItemId: `${id}-item`,
      formMessageId: `${id}-message`,
    }),
    [field.name, errors, id]
  )
  return <FormFieldContext.Provider value={value}>{children}</FormFieldContext.Provider>
}

export function FormItem({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid gap-2', className)} {...props} />
}

export function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { errors, formItemId } = useFormField()
  return (
    <Label
      htmlFor={formItemId}
      data-error={errors.length > 0}
      className={cn('data-[error=true]:text-destructive', className)}
      {...props}
    />
  )
}

export function FormControl(props: React.ComponentProps<typeof Slot>) {
  const { errors, formItemId, formMessageId } = useFormField()
  const hasError = errors.length > 0
  return (
    <Slot
      id={formItemId}
      aria-describedby={hasError ? formMessageId : undefined}
      aria-invalid={hasError}
      {...props}
    />
  )
}

export function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground text-sm', className)} {...props} />
}

/** Renders the first error. Reads `.message` because Standard Schema
 *  validators (Zod 4) emit issue objects, not strings. */
export function FormMessage({ className, ...props }: React.ComponentProps<'p'>) {
  const { errors, formMessageId } = useFormField()
  const first = errors[0]
  if (first === undefined) return null
  const text =
    typeof first === 'object' && first !== null && 'message' in first
      ? String((first as { message: unknown }).message)
      : String(first)
  return (
    <p
      id={formMessageId}
      role="alert"
      className={cn('text-destructive text-sm', className)}
      {...props}
    >
      {text}
    </p>
  )
}
```

`aria-invalid` and `aria-describedby` are spec §9 acceptance criteria, and Task 9's axe pass asserts them.

- [ ] **Step 7: Write `src/queries/auth.queries.ts`**

```ts
import { useMutation } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'
import type { LoginInput, RegisterInput, ResetPasswordInput, VerifyEmailInput } from '@/schemas/auth.schemas'

interface AuthPayload {
  accessToken: string
  user: User
}

export function useLogin() {
  const login = useAuthStore((s) => s.login)
  return useMutation({
    mutationFn: async (input: LoginInput) =>
      unwrap(await apiClient.post<ApiSuccess<AuthPayload>>('/auth/login', input)),
    onSuccess: (data) => login(data.accessToken, data.user),
  })
}

export function useRegister() {
  return useMutation({
    mutationFn: async (input: RegisterInput) =>
      unwrap(await apiClient.post<ApiSuccess<User>>('/auth/register', input)),
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: { email: string }) =>
      apiClient.post('/auth/forgot-password', input),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) =>
      // confirmPassword is a client-side concern; the API does not accept it.
      apiClient.post('/auth/reset-password', {
        token: input.token,
        password: input.password,
      }),
  })
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (input: VerifyEmailInput) => apiClient.post('/auth/verify-email', input),
  })
}

export function useResendVerification() {
  return useMutation({
    mutationFn: async (input: { email: string }) =>
      apiClient.post('/auth/resend-verification', input),
  })
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout)
  return useMutation({
    mutationFn: async () => apiClient.post('/auth/logout'),
    // Clear locally whatever the network did. A user who clicked logout
    // must end up logged out.
    onSettled: () => {
      logout()
      window.location.assign(ROUTES.login)
    },
  })
}
```

`useResetPassword` strips `confirmPassword` before sending: the backend's schema rejects unrecognised keys.

- [ ] **Step 8: Write the six auth pages**

Each follows the same shape. `login.tsx` in full; the rest mirror it with their own schema, mutation and copy.

`src/pages/_auth/login.tsx`:
```tsx
import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { GOOGLE_OAUTH_PATH, ROUTES } from '@/constants/routes'
import { messageFrom } from '@/lib/api-error'
import { useLogin } from '@/queries/auth.queries'
import { loginSchema } from '@/schemas/auth.schemas'

export const Route = createFileRoute('/_auth/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
})

const OAUTH_ERRORS: Record<string, string> = {
  google_auth_failed: 'Google sign-in failed. Please try again.',
}

function LoginPage() {
  const { error } = Route.useSearch()
  const navigate = useNavigate()
  const login = useLogin()

  // The backend redirects here with ?error=<code> when OAuth fails.
  useEffect(() => {
    if (error) toast.error(OAUTH_ERRORS[error] ?? 'Sign-in failed. Please try again.')
  }, [error])

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      try {
        await login.mutateAsync(value)
        await navigate({ to: ROUTES.dashboard })
      } catch (submitError) {
        toast.error(messageFrom(submitError))
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your email and password to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form}>
          <FormField form={form} name="email">
            {(field) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    value={String(field.state.value ?? '')}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>

          <FormField form={form} name="password">
            {(field) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={String(field.state.value ?? '')}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>

          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Form>

        {/* A plain anchor, not an axios call: this is a top-level
            navigation to a same-origin API route. */}
        <Button asChild variant="outline" className="mt-3 w-full">
          <a href={GOOGLE_OAUTH_PATH}>Continue with Google</a>
        </Button>

        <div className="mt-4 flex justify-between text-sm">
          <Link to={ROUTES.forgotPassword} className="underline underline-offset-4">
            Forgot password?
          </Link>
          <Link to={ROUTES.register} className="underline underline-offset-4">
            Create an account
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
```

The remaining five, same structure:

- **`register.tsx`** — `registerSchema`, `useRegister`. On success switch the card to a "Check your email" state holding a **Resend verification email** button wired to `useResendVerification` with the submitted address.
- **`forgot-password.tsx`** — `forgotPasswordSchema`, `useForgotPassword`. Always show *"If that address has an account, a reset email has been sent."*, success or failure. The backend answers identically either way (Ruling G) and the UI must not leak the difference.
- **`reset-password.tsx`** — `resetPasswordSchema`, `useResetPassword`. `validateSearch` reads `token`; render an error state if it is absent. On success, toast and navigate to `/login`.
- **`verify-email.tsx`** — `verifyEmailSchema`, `useVerifyEmail`. `validateSearch` reads `token`. Renders **token + password** fields — the backend requires the password. On failure, offer the same resend control as `register.tsx`.
- **`src/pages/auth/callback.tsx`** — outside `_auth`, so it has no guard. Renders a spinner with `role="status"` and an accessible label. It does **not** call `/auth/refresh`: `__root`'s `beforeLoad` already ran `bootstrapSession()` and the cookie is already set. In an effect, read `useAuthStore.getState().isAuthenticated` and navigate to `/dashboard`, or to `/login?error=google_auth_failed` if false.

- [ ] **Step 9: Write the login page test**

`src/pages/_auth/login.test.tsx` — render the form in isolation (not through the router) and assert: required-field errors appear on empty submit; a malformed email is rejected; a successful submit calls the login endpoint once; a 401 surfaces the server's message. Use `@testing-library/user-event` for interaction and MSW for the endpoint.

- [ ] **Step 10: Run everything and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add -A
git commit -m "feat: add auth pages, schemas and the TanStack Form bridge

The form primitive is hand-written rather than pulled from the shadcn
registry, whose form entry depends on react-hook-form. Same export
surface, TanStack Form underneath.

Login reads ?error= because the backend redirects there on OAuth
failure. Register and verify-email both expose resend-verification.
Forgot-password shows one message regardless of whether the address
exists, matching the backend's Ruling G behaviour."
```

---

### Task 6: App shell, dashboard and profile

**What:** The authenticated layout — sidebar, header, breadcrumbs, theme toggle, user menu — plus the two simplest pages behind it.

**Files:**
- Create: `src/components/layouts/app-layout.tsx`, `src/components/features/theme-toggle.tsx`, `src/components/features/user-menu.tsx`, `src/queries/profile.queries.ts`, `src/schemas/profile.schemas.ts`
- Create: `src/pages/_app/dashboard.tsx`, `src/pages/_app/profile.tsx`
- Modify: `src/pages/_app.tsx`

**Interfaces:**
- Consumes: `useAuthStore`, `useSidebarStore`, `useThemeStore` (Task 2); `useLogout` (Task 5); `Form*` (Task 5).
- Produces:
  - `AppLayout` from `@/components/layouts/app-layout`
  - `useProfile()`, `useUpdateProfile()` from `@/queries/profile.queries`
  - `updateProfileSchema` from `@/schemas/profile.schemas`

- [ ] **Step 1: Write `src/schemas/profile.schemas.ts`**

```ts
import { z } from 'zod'

const MAX_NAME_LENGTH = 100

/**
 * Mirrors the backend's updateProfileSchema exactly: two fields, and it
 * rejects everything else. email, password and every other user column are
 * deliberately absent — PATCH /profile will reject them.
 */
export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(MAX_NAME_LENGTH),
  lastName: z.string().trim().min(1, 'Last name is required.').max(MAX_NAME_LENGTH),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
```

- [ ] **Step 2: Write `src/queries/profile.queries.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { UpdateProfileInput } from '@/schemas/profile.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

export const profileKeys = { detail: ['profile'] as const }

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.detail,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<User>>('/profile')),
    initialData: () => useAuthStore.getState().user ?? undefined,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) =>
      unwrap(await apiClient.patch<ApiSuccess<User>>('/profile', input)),
    onSuccess: (user) => {
      queryClient.setQueryData(profileKeys.detail, user)
      // Keep the store's copy in step, since the layout reads from it.
      const { accessToken, login } = useAuthStore.getState()
      if (accessToken) login(accessToken, user)
    },
  })
}
```

- [ ] **Step 3: Write `src/components/features/theme-toggle.tsx`**

```tsx
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThemeStore, type Theme } from '@/states/theme.store'

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Icon-only control: it needs an accessible name or the axe pass
            in Task 9 fails. */}
        <Button variant="ghost" size="icon" aria-label={`Theme: ${theme}. Change theme`}>
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon className="mr-2 size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: Write `src/components/layouts/app-layout.tsx`**

Use the shadcn `sidebar` primitives (`SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarFooter`, `SidebarInset`, `SidebarTrigger`). Structure:

```tsx
<SidebarProvider>
  <Sidebar collapsible="icon">
    <SidebarHeader>{/* TenantSwitcher slot — filled in Task 8 */}</SidebarHeader>
    <SidebarContent>
      {/* Dashboard, Notifications, Tenants — each a <Link> in a
          SidebarMenuButton asChild, so it is a real anchor and
          keyboard-reachable. */}
    </SidebarContent>
    <SidebarFooter>{/* UserMenu + ThemeToggle */}</SidebarFooter>
  </Sidebar>
  <SidebarInset>
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Breadcrumb>{/* derived from useMatches() */}</Breadcrumb>
      <div className="ml-auto">{/* NotificationBell slot — Task 7 */}</div>
    </header>
    <main className="flex-1 overflow-auto p-4 md:p-6">
      <Outlet />
    </main>
  </SidebarInset>
</SidebarProvider>
```

Three requirements, all spec §9 criteria checked in Task 9:
- Nav items are `<Link>` inside `SidebarMenuButton asChild` — real anchors, not click handlers on divs.
- Exactly one `<main>` landmark per page.
- The sidebar collapses to icons below `md`; `collapsible="icon"` plus the shadcn mobile sheet handles it.

The user menu holds Profile, the theme toggle, and Sign out (calling `useLogout()` from Task 5).

- [ ] **Step 5: Point `_app` at the layout**

In `src/pages/_app.tsx`, replace `component: Outlet` with `component: AppLayout`, importing it from `@/components/layouts/app-layout`. Leave the `beforeLoad` guard exactly as Task 4 wrote it.

- [ ] **Step 6: Write `src/pages/_app/dashboard.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/dashboard')({ component: DashboardPage })

function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const name = user?.firstName ?? user?.email ?? 'there'
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back, {name}</CardTitle>
        <CardDescription>
          This page is intentionally empty. Derived projects fill it.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
```

It shows **no tenant name**. There is no "current tenant" outside a `/tenants/$slug` URL — see spec §7.

- [ ] **Step 7: Write `src/pages/_app/profile.tsx`**

A card with a TanStack Form over `updateProfileSchema` (first name, last name), plus read-only rows for email and member-since (`createdAt`, formatted with `Intl.DateTimeFormat`). Success and failure both toast.

**No change-password form and no auth-provider list.** Neither has an endpoint — spec §3. Do not add placeholder UI for them.

- [ ] **Step 8: Run everything and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add -A
git commit -m "feat: add app shell, dashboard and profile

Profile edits first and last name only, which is the entire writable
surface of PATCH /profile. No change-password form and no provider list:
the API exposes neither."
```

---

### Task 7: Notifications and the SSE connection

**What:** The notifications page, the header bell, and the `EventSource` hook — including the reconnect behaviour this backend actually requires.

**Files:**
- Create: `src/queries/notification.queries.ts`, `src/hooks/use-notifications.ts`, `src/components/features/notification-bell.tsx`, `src/pages/_app/notifications.tsx`
- Test: `src/hooks/use-notifications.test.ts`
- Modify: `src/components/layouts/app-layout.tsx`

**Interfaces:**
- Consumes: `apiClient`, `unwrap` (Task 3); `ensureSession` (Task 3); `useAuthStore` (Task 2).
- Produces:
  - `useNotifications()`, `useMarkRead()`, `useMarkAllRead()`, `useDeleteNotification()`, `usePreferences()`, `useUpdatePreferences()` from `@/queries/notification.queries`
  - `useNotificationStream(): void` from `@/hooks/use-notifications`
  - `notificationKeys` — `{ list: ['notifications'], preferences: ['notifications','preferences'] }`

- [ ] **Step 1: Write `src/queries/notification.queries.ts`**

Cursor pagination, via `useInfiniteQuery`:

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { ApiSuccess } from '@/types/api.types'

export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
}

interface NotificationPage {
  items: Notification[]
  nextCursor: string | null
}

export const notificationKeys = {
  list: ['notifications'] as const,
  preferences: ['notifications', 'preferences'] as const,
}

const PAGE_SIZE = 20 // backend default; its hard cap is 100

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<NotificationPage>>('/notifications', {
          params: { limit: PAGE_SIZE, cursor: pageParam },
        })
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiClient.patch(`/notifications/${id}/read`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => apiClient.patch('/notifications/read-all'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

export function useDeleteNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/notifications/${id}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

export function usePreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<Record<string, boolean>>>('/notifications/preferences')),
  })
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Record<string, boolean>) =>
      apiClient.put('/notifications/preferences', input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.preferences }),
  })
}
```

`markRead` and `delete` additionally take optimistic updates via `onMutate` + `queryClient.setQueryData`, with the snapshot restored in `onError` — spec §9.

Adjust `Notification` and `NotificationPage` to whatever `listNotifications` actually returns; read `src/controllers/notification.controller.ts` in express-boilerplate before writing them rather than trusting these field names.

- [ ] **Step 2: Write the failing SSE hook test**

`src/hooks/use-notifications.test.ts`:
```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { useNotificationStream } from '@/hooks/use-notifications'
import { useAuthStore } from '@/states/auth.store'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

class MockEventSource {
  static instances: MockEventSource[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  closed = false
  constructor(public url: string) {
    MockEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useNotificationStream', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'tok-a',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('puts the access token in the query string', () => {
    // EventSource cannot set an Authorization header, which is exactly
    // why /notifications/stream authenticates from ?token=.
    renderHook(() => useNotificationStream(), { wrapper })

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0]!.url).toContain('/api/v1/notifications/stream')
    expect(MockEventSource.instances[0]!.url).toContain('token=tok-a')
  })

  it('tears down and rebuilds when the token changes', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    expect(MockEventSource.instances).toHaveLength(1)

    useAuthStore.getState().setToken('tok-b')

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
    expect(MockEventSource.instances[0]!.closed).toBe(true)
    expect(MockEventSource.instances[1]!.url).toContain('token=tok-b')
  })

  it('closes and reconnects through ensureSession after an error', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.'))
    )
    renderHook(() => useNotificationStream(), { wrapper })
    const first = MockEventSource.instances[0]!

    first.onerror?.(new Event('error'))
    expect(first.closed).toBe(true)

    // The first retry waits one backoff interval before reconnecting.
    await vi.advanceTimersByTimeAsync(1_000)

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
    expect(MockEventSource.instances[1]!.url).toContain('token=fresh-token')
  })

  it('stops retrying once the session is genuinely dead', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        new Response(
          JSON.stringify({
            success: false,
            message: 'Unauthorized',
            statusCode: 401,
            requestId: 'r',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    renderHook(() => useNotificationStream(), { wrapper })
    MockEventSource.instances[0]!.onerror?.(new Event('error'))

    await vi.advanceTimersByTimeAsync(5_000)

    // ensureSession rejected and logged out; no second connection.
    expect(MockEventSource.instances).toHaveLength(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useNotificationStream(), { wrapper })
    unmount()
    expect(MockEventSource.instances[0]!.closed).toBe(true)
  })
})
```

The fourth test is the one that stops a hard-down backend becoming an infinite
reconnect loop, and the third is what stops a one-second blip killing
notifications until the next token expiry. Both failure modes are silent in
manual testing.


- [ ] **Step 3: Write `src/hooks/use-notifications.ts`**

```ts
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ensureSession } from '@/http/session'
import { notificationKeys } from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

export function useNotificationStream(): void {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()
  const backoffRef = useRef(INITIAL_BACKOFF_MS)

  useEffect(() => {
    if (!accessToken) return

    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const connect = (token: string) => {
      if (cancelled) return
      source = new EventSource(
        `/api/v1/notifications/stream?token=${encodeURIComponent(token)}`
      )

      source.onmessage = () => {
        backoffRef.current = INITIAL_BACKOFF_MS
        void queryClient.invalidateQueries({ queryKey: notificationKeys.list })
      }

      // An EventSource error event carries no status code, so we cannot
      // tell an expired token from a dropped connection. Closing and
      // waiting for the token to change would leave notifications dead
      // for up to a token lifetime after a one-second blip. Routing every
      // error through ensureSession() handles both cases: an expired token
      // gets refreshed, a transient failure gets the same token back, and
      // a dead session logs out and stops the loop.
      source.onerror = () => {
        source?.close()
        source = null
        if (cancelled) return
        const delay = backoffRef.current
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS)
        retryTimer = setTimeout(() => {
          ensureSession()
            .then((fresh) => connect(fresh))
            .catch(() => {
              /* ensureSession already logged out; stop retrying */
            })
        }, delay)
      }
    }

    connect(accessToken)

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      source?.close()
    }
  }, [accessToken, queryClient])
}
```

The URL is absolute-from-root rather than built from `apiClient` because `EventSource` takes a URL string and ignores axios entirely.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/hooks/use-notifications.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the bell and the page**

`notification-bell.tsx` — a `DropdownMenu` trigger holding a `Bell` icon and an unread-count `Badge`. The trigger needs `aria-label={`Notifications, ${unread} unread`}`; the count badge alone is not an accessible name. Lists the five most recent, with a "View all" link to `/notifications`.

`src/pages/_app/notifications.tsx` — the infinite list with "Load more", per-row mark-read and delete, a "Mark all read" action, and the preferences switches. Skeletons while `isPending`, and an empty state when there are none.

Mount `useNotificationStream()` once, in `AppLayout`, not in either component — two mounts would open two connections.

- [ ] **Step 6: Run everything and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add -A
git commit -m "feat: add notifications with a self-healing SSE connection

EventSource cannot send an Authorization header, so the stream
authenticates from ?token= — and its built-in retry would re-request the
same expired token forever. The hook closes on error and reconnects
through ensureSession() under exponential backoff, which covers both an
expired token and a dropped connection."
```

---

### Task 8: Tenants

**What:** Role predicates, tenant queries and schemas, and the four tenant screens.

**Files:**
- Create: `src/constants/roles.ts`, `src/schemas/tenant.schemas.ts`, `src/queries/tenant.queries.ts`, `src/components/features/tenant-switcher.tsx`
- Create: `src/pages/_app/tenants/index.tsx`, `$slug.tsx`, `$slug.index.tsx`, `$slug.members.tsx`, `$slug.settings.tsx`
- Test: `src/constants/roles.test.ts`, `src/schemas/tenant.schemas.test.ts`

**Interfaces:**
- Consumes: `apiClient`, `unwrap` (Task 3); `Form*` (Task 5).
- Produces:
  - `MEMBERSHIP_ROLES`, `type MembershipRole`, `canActorModifyTarget`, `canActorGrantRole`, `canChangeRoles`, `canManageTenant` from `@/constants/roles`
  - `tenantSchema`, `newTenantSchema`, `addMemberSchema`, `updateTenantSettingsSchema` from `@/schemas/tenant.schemas`
  - `useTenants`, `useTenant`, `useCreateTenant`, `useUpdateTenant`, `useMembers`, `useAddMember`, `useUpdateMemberRole`, `useRemoveMember`, `useTenantSettings`, `useUpdateTenantSettings` from `@/queries/tenant.queries`

- [ ] **Step 1: Write the failing roles test**

`src/constants/roles.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { canActorGrantRole, canActorModifyTarget, canChangeRoles } from '@/constants/roles'

describe('canActorModifyTarget', () => {
  it('lets an owner act on any non-owner target', () => {
    for (const target of ['admin', 'manager', 'editor', 'viewer'] as const) {
      expect(canActorModifyTarget('owner', target, false)).toBe(true)
    }
  })

  it('lets an owner act on an owner only when it is themselves', () => {
    expect(canActorModifyTarget('owner', 'owner', true)).toBe(true)
    expect(canActorModifyTarget('owner', 'owner', false)).toBe(false)
  })

  it('blocks an admin from acting on an owner or another admin', () => {
    expect(canActorModifyTarget('admin', 'owner', false)).toBe(false)
    expect(canActorModifyTarget('admin', 'admin', false)).toBe(false)
  })

  it('lets an admin act on manager, editor and viewer', () => {
    for (const target of ['manager', 'editor', 'viewer'] as const) {
      expect(canActorModifyTarget('admin', target, false)).toBe(true)
    }
  })

  it('denies every other actor role', () => {
    for (const actor of ['manager', 'editor', 'viewer'] as const) {
      expect(canActorModifyTarget(actor, 'viewer', false)).toBe(false)
    }
  })
})

describe('canActorGrantRole', () => {
  it('lets an owner grant anything', () => {
    for (const role of ['owner', 'admin', 'manager', 'editor', 'viewer'] as const) {
      expect(canActorGrantRole('owner', role)).toBe(true)
    }
  })

  it('stops an admin granting owner or admin', () => {
    expect(canActorGrantRole('admin', 'owner')).toBe(false)
    expect(canActorGrantRole('admin', 'admin')).toBe(false)
    expect(canActorGrantRole('admin', 'manager')).toBe(true)
  })
})

describe('canChangeRoles', () => {
  it('is owner-only — an admin cannot change even a viewer', () => {
    expect(canChangeRoles('owner')).toBe(true)
    expect(canChangeRoles('admin')).toBe(false)
  })
})
```

`canChangeRoles` is separate from `canActorModifyTarget` on purpose: the route is gated `requireRole('owner')`, so an admin cannot reach role-change at all, regardless of the target.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/constants/roles.test.ts`
Expected: FAIL — cannot resolve `@/constants/roles`.

- [ ] **Step 3: Write `src/constants/roles.ts`**

```ts
/** Descending authority. Mirrors MEMBERSHIP_ROLES on the server. */
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'manager', 'editor', 'viewer'] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

/** The role a newly added member receives. */
export const DEFAULT_MEMBER_ROLE: MembershipRole = 'viewer'

/**
 * May `actorRole` change or remove an EXISTING member holding `targetRole`?
 *
 * | Actor \ Target | owner     | admin | manager/editor/viewer |
 * | owner          | self only | yes   | yes                   |
 * | admin          | no        | no    | yes                   |
 *
 * manager/editor/viewer never reach these endpoints; they fail closed.
 */
export function canActorModifyTarget(
  actorRole: MembershipRole,
  targetRole: MembershipRole,
  isSelf: boolean
): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner' || isSelf
  if (actorRole === 'admin') return targetRole !== 'owner' && targetRole !== 'admin'
  return false
}

/**
 * May `actorRole` grant `role` to someone who is NOT yet a member?
 * Separate from the matrix above: a new member has no current role to
 * compare against, and an admin who could add a new admin directly would
 * escalate past what the matrix lets them do to an existing one.
 */
export function canActorGrantRole(actorRole: MembershipRole, role: MembershipRole): boolean {
  if (actorRole === 'owner') return true
  if (actorRole === 'admin') return role !== 'owner' && role !== 'admin'
  return false
}

/** Role CHANGE is owner-only — the route is gated requireRole('owner'). */
export function canChangeRoles(actorRole: MembershipRole): boolean {
  return actorRole === 'owner'
}

/** Tenant update, member add/remove and settings: owner or admin. */
export function canManageTenant(actorRole: MembershipRole): boolean {
  return actorRole === 'owner' || actorRole === 'admin'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/constants/roles.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write `src/schemas/tenant.schemas.ts` and its test**

```ts
import { z } from 'zod'
import { MEMBERSHIP_ROLES } from '@/constants/roles'
import { emailSchema } from '@/schemas/auth.schemas'

export const RESERVED_SLUGS = [
  'admin', 'api', 'app', 'auth', 'login', 'logout', 'register', 'signin', 'signup',
  'settings', 'billing', 'support', 'help', 'docs', 'status', 'health', 'static',
  'assets', 'public', 'cdn', 'www', 'mail', 'ftp', 'blog', 'about', 'contact',
  'terms', 'privacy', 'dashboard', 'root', 'system', 'null', 'undefined', 'true',
  'false', 'new', 'edit', 'delete', 'create', 'update', 'tenants', 'tenant',
  'users', 'user', 'members', 'owner', 'me', 'test', 'staging', 'dev', 'localhost',
] as const

const RESERVED = new Set<string>(RESERVED_SLUGS)

export const slugSchema = z
  .string()
  .trim()
  .min(3, 'Slug must be at least 3 characters.')
  .max(100, 'Slug must be at most 100 characters.')
  // Mixed case is REJECTED, not lowercased: the slug is a routing
  // identifier, so quietly rewriting "MyOrg" would address a different
  // tenant than the one the user typed.
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Slug must be lowercase letters, numbers and hyphens, and cannot start or end with a hyphen.'
  )
  .refine((slug) => !RESERVED.has(slug), 'This slug is reserved and cannot be used.')

export const newTenantSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255),
  slug: slugSchema,
  description: z.string().trim().min(1).max(1000).optional(),
  logo: z.string().trim().min(1).max(255).optional(),
  website: z.string().trim().min(1).max(255).optional(),
})

// slug is deliberately absent — the API does not allow renaming it.
export const updateTenantSchema = newTenantSchema.omit({ slug: true }).partial()

export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(MEMBERSHIP_ROLES),
})

export const updateMemberRoleSchema = z.object({ role: z.enum(MEMBERSHIP_ROLES) })

export const updateTenantSettingsSchema = z.object({
  timezone: z.string().trim().min(1).optional(),
  locale: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})
```

Test: a valid slug passes; `MyOrg` fails; `-lead` and `trail-` fail; `ab` fails; `admin` fails as reserved; `updateTenantSchema` has no `slug` key.

- [ ] **Step 6: Write `src/queries/tenant.queries.ts`**

Ten hooks over the §3 endpoint table. Keys: `['tenants']`, `['tenants', slug]`, `['tenants', slug, 'members']`, `['tenants', slug, 'settings']`. Every mutation invalidates the narrowest key that changed. `useTenant(slug)` must treat a 404 as a not-found state rather than an error boundary — the backend returns an identical 404 for "no such tenant" and "you are not a member" (Ruling G).

- [ ] **Step 7: Write the tenant pages**

- **`index.tsx`** — the list, each row a `Link` with a role `Badge`, plus a create form over `newTenantSchema` with live slug validation. Empty state when the user belongs to no tenants.
- **`$slug.tsx`** — a **layout route**: the tenant header, a tab bar, and `<Outlet />`. Loads the tenant once in its loader; the three children read it from context. Renders a not-found state on 404.
- **`$slug.index.tsx`** — the overview tab, at `/tenants/$slug`.
- **`$slug.members.tsx`** — the member table. Gate every control through Task 8's predicates:
  - Add member: shown when `canManageTenant(myRole)`; the role select offers only roles passing `canActorGrantRole(myRole, role)`.
  - Change role: shown only when `canChangeRoles(myRole)` **and** `canActorModifyTarget(myRole, target.role, isSelf)`.
  - Remove: shown when `canManageTenant(myRole)` and `canActorModifyTarget(...)`.
  - An owner who is the **only** owner gets their self-targeted controls disabled, with a tooltip explaining that a tenant must keep an owner — the backend refuses this and the UI should not invite the error.
  - The table wraps in an `overflow-x-auto` container so it scrolls rather than overflowing on mobile.
- **`$slug.settings.tsx`** — timezone, locale and metadata over `updateTenantSettingsSchema`. Read-only unless `canManageTenant(myRole)`.

- **`tenant-switcher.tsx`** — a dropdown listing the user's tenants, each item navigating to `/tenants/$slug`. It sets **no header** and writes to **no store**: tenant scope is the URL (spec §7). Mount it in `AppLayout`'s `SidebarHeader`.

- [ ] **Step 8: Run everything and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add -A
git commit -m "feat: add tenant management with the backend's role matrix

Five roles, not four. Role change is owner-only because the route is
gated requireRole('owner'), so it is a separate predicate from the
actor->target matrix. Granting a role to a new member is a third rule.

The switcher navigates to /tenants/:slug and sets no header: the API
reserves X-Tenant-Id but no route reads it."
```

---

### Task 9: Accessibility sweep, Docker, CI and docs

**What:** The automated a11y gate, the container, the pipeline, and the documentation. This task is what makes the spec's §9 criteria enforceable rather than aspirational.

**Files:**
- Create: `src/tests/a11y.test.tsx`, `Dockerfile`, `nginx.conf`, `.dockerignore`, `.github/workflows/ci.yml`, `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: every page from Tasks 4–8.
- Produces: no runtime exports.

- [ ] **Step 1: Write the accessibility test**

`src/tests/a11y.test.tsx`:
```tsx
import { render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, expect, it } from 'vitest'

// Render each page's component directly with a QueryClientProvider and a
// stub router context, not through RouterProvider — a full router render
// pulls in navigation that axe cannot reason about.
describe('accessibility', () => {
  it.each([
    ['login', () => import('@/pages/_auth/login')],
    ['register', () => import('@/pages/_auth/register')],
    ['forgot-password', () => import('@/pages/_auth/forgot-password')],
    ['dashboard', () => import('@/pages/_app/dashboard')],
    ['profile', () => import('@/pages/_app/profile')],
    ['notifications', () => import('@/pages/_app/notifications')],
    ['tenants', () => import('@/pages/_app/tenants/index')],
  ])('%s has no axe violations in its default state', async (_name, importPage) => {
    const { container } = render(await renderPage(importPage))
    expect(await axe(container)).toHaveNoViolations()
  })
})
```

Write the `renderPage` helper alongside it: it resolves the module, pulls the component off `Route.options.component`, and wraps it in `QueryClientProvider` plus whatever router stub the page needs.

Add two explicit interaction tests, which axe cannot cover:
- **Keyboard traversal:** tab through the login form and assert focus reaches email, password, submit and the Google link in that order.
- **Focus restoration:** open the theme dropdown with the keyboard, close with Escape, assert focus returns to the trigger.

- [ ] **Step 2: Run the a11y suite and fix what it finds**

Run: `pnpm vitest run src/tests/a11y.test.tsx`

Common failures and their fixes: icon-only buttons need `aria-label`; each page needs exactly one `<main>`; form inputs need a label association (the `FormLabel`/`FormControl` pair from Task 5 handles this); colour-contrast failures mean a token in `globals.css` needs adjusting, not a rule suppression.

Do not suppress a violation to make this pass.

- [ ] **Step 3: Write `nginx.conf`**

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
  gzip_min_length 1024;

  # SSE. Must come BEFORE the general /api/ block. nginx buffers
  # responses by default, which stalls an event stream indefinitely.
  location /api/v1/notifications/stream {
    proxy_pass http://api:4040;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
  }

  location /api/ {
    # NO trailing path on proxy_pass. Adding one makes nginx rewrite the
    # URI, which changes the path the browser scopes the refresh cookie
    # to (it is set with Path=/api/v1/auth) and silently breaks refresh.
    proxy_pass http://api:4040;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # Express reads this for its `secure` cookie flag and TRUST_PROXY.
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  location = /index.html {
    add_header Cache-Control "no-store";
  }

  location / {
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 4: Write `Dockerfile` and `.dockerignore`**

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

`.dockerignore`: `node_modules`, `dist`, `.git`, `coverage`, `.env`, `*.local`.

- [ ] **Step 5: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
```

Two parallel jobs, matching express-boilerplate's split. Pin the action majors to whatever is current when this runs — verify rather than copying these numbers blind.

No browser step: the render gate needing Playwright belongs to Phase B.

- [ ] **Step 6: Write `CLAUDE.md` and `README.md`**

`CLAUDE.md` must state the constraints an agent would otherwise get wrong:
- `VITE_API_URL` is relative; the backend has no CORS.
- The access token is memory-only; never persist it.
- `ensureSession()` is the only caller of `/auth/refresh`; never add a second.
- Never install `react-hook-form`, `@hookform/resolvers`, `next-themes`, `@tanstack/zod-form-adapter`, or `radix-ui`.
- TypeScript stays at `~6.0.3` and `@types/node` at `24.x` until typescript-eslint supports TS 7.
- Never run `shadcn add form` or `shadcn add toast`.
- `src/components/ui/**` is vendored: excluded from Tailwind lint rules, and edits there are lost on re-add.
- Frontend Zod schemas mirror the backend validators; change both together.

`README.md`: prerequisites, `pnpm install`, `.env` setup, the scripts table, project structure, and a note that the API must be running on `:4040` for the dev proxy to resolve.

- [ ] **Step 7: Full verification**

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
docker build -t react-boilerplate:test .
```

Then run the container against a live API and confirm by hand:
1. Sign in, reload the page — you stay signed in (bootstrap works).
2. Open two tabs, let the token expire, act in both — one refresh, no sign-out (single-flight works).
3. Kill the API briefly with the notifications page open — the stream reconnects on its own (backoff works).

These three are the behaviours unit tests approximate but cannot prove end to end.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add a11y gate, Dockerfile, nginx config, CI and docs

The nginx config carries three requirements that fail silently if
dropped: no URI rewrite on proxy_pass (the refresh cookie is scoped to
Path=/api/v1/auth), X-Forwarded-Proto (express reads it for the secure
cookie flag), and proxy_buffering off on the SSE location.

CI runs no browser: the Playwright render gate belongs to Phase B."
```

---

## Phase A Definition of Done

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` all pass.
- `docker build` succeeds and the container serves the SPA with a working API proxy.
- Reloading an authenticated page keeps you signed in.
- N concurrent expired requests produce exactly one refresh.
- The notification stream survives a backend restart without a page reload.
- `grep -r "react-hook-form\|next-themes\|zod-form-adapter" src/` returns nothing.
- Every page passes `jest-axe` with no violations.

## Deferred to Phase B

StyleSeed install and `ss-setup`; token ownership moving to `ss-tokens`; the 32 StyleSeed primitives replacing the shadcn ones; the `ss-lint`/`ss-a11y`/`ss-audit`/`ss-score`/`ss-verify` gate chain; Playwright. See spec §14. That plan gets written once `ss-setup` has actually run and its outputs exist to plan against.
