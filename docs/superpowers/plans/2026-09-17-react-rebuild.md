# React Boilerplate Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full rewrite of the React boilerplate with React 19, TanStack Router/Query/Form, Zustand, Tailwind 4, shadcn/ui, Vitest + Testing Library + MSW. Aligned with the express-boilerplate's shipped API.

**Architecture:** SPA with file-based routing (TanStack Router), server state via TanStack Query, client state via Zustand, shadcn/ui component library on Tailwind 4. Auth via JWT access tokens (memory) + httpOnly refresh cookies. SSE for real-time notifications.

**Tech Stack:** React 19, TanStack Router/Query/Form, Zustand 5, Tailwind CSS 4, shadcn/ui (latest), Zod 4, Vite 8, Vitest, Testing Library, MSW 2, Sonner, Lucide React, Axios.

**Spec:** `docs/superpowers/specs/2026-09-17-react-rebuild-design.md`

## Global Constraints

- This is a FULL REWRITE — delete existing `src/` contents and start fresh
- Keep existing `.git` history, `docs/`, and root config files as starting points
- Use `pnpm` as package manager (matching express-boilerplate)
- All env vars prefixed `VITE_` (Vite requirement for client exposure)
- shadcn/ui installed via CLI (`pnpm dlx shadcn@latest init` then `add` components)
- TanStack Router uses file-based routing — `src/pages/` is the routes directory, `routeTree.gen.ts` is auto-generated
- API base URL: `VITE_API_URL` (default `http://localhost:4040/api/v1`)
- Dark/light mode via CSS class on `<html>` (not media query — user preference persisted)

---

### Task 1: Project Scaffold — Vite + React 19 + Tailwind 4 + shadcn/ui

**What:** Wipe `src/`, set up the project from scratch with Vite 8, React 19, Tailwind CSS 4 (with `@tailwindcss/vite`), shadcn/ui, TypeScript, ESLint, Prettier. Install all core dependencies. Verify `pnpm dev` runs a blank page.

- [ ] **Step 1: Clean existing src/ and install fresh dependencies**

Delete all contents of `src/`. Keep root configs as starting points but they'll be rewritten.

```bash
rm -rf src/*
```

Update `package.json` — replace all dependencies:

```bash
# Remove old deps
pnpm remove @hookform/resolvers @radix-ui/react-checkbox @radix-ui/react-form @radix-ui/react-label @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-slot @radix-ui/react-tooltip @reduxjs/toolkit axios class-variance-authority clsx crypto-js date-fns lucide-react postcss react-day-picker react-dom react-hook-form react-redux react-router-dom tailwind-merge tailwindcss tailwindcss-animate vite-tsconfig-paths autoprefixer eslint-plugin-tailwindcss

# Install new deps
pnpm add react@latest react-dom@latest axios sonner lucide-react zod@latest zustand@latest @tanstack/react-router @tanstack/react-query @tanstack/react-form @tanstack/zod-form-adapter clsx tailwind-merge class-variance-authority

# Install dev deps
pnpm add -D typescript@latest @types/react@latest @types/react-dom@latest vite@latest @vitejs/plugin-react@latest tailwindcss@latest @tailwindcss/vite @tanstack/router-plugin @tanstack/react-router-devtools @tanstack/react-query-devtools eslint@latest eslint-config-prettier prettier @ianvs/prettier-plugin-sort-imports prettier-plugin-tailwindcss typescript-eslint @eslint/js globals vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event msw jsdom
```

- [ ] **Step 2: Configure Vite**

Rewrite `vite.config.ts`:
```typescript
import path from 'node:path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [TanStackRouterVite({ routesDirectory: './src/pages' }), react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4040', changeOrigin: true } } },
})
```

- [ ] **Step 3: Initialize shadcn/ui**

```bash
pnpm dlx shadcn@latest init
```

Choose: Vite, TypeScript, New York style, OKLCH colors, `src/styles/globals.css`, `@/components/ui`, `@/lib/utils`.

Then install core components:
```bash
pnpm dlx shadcn@latest add button card input label form sidebar dropdown-menu avatar badge separator skeleton sheet dialog alert-dialog tabs toast sonner tooltip popover select switch textarea command
```

- [ ] **Step 4: Create entry files**

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { App } from '@/app'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

`src/app.tsx` — providers wrapper (QueryClientProvider, RouterProvider).

`src/router.ts` — TanStack Router instance with QueryClient context.

`src/lib/utils.ts` — `cn()` utility (shadcn generates this).

- [ ] **Step 5: Create `src/pages/__root.tsx`**

Root route with Toaster, devtools, theme support.

- [ ] **Step 6: Create `src/pages/index.tsx`**

Simple redirect: authenticated → `/dashboard`, unauthenticated → `/login`.

- [ ] **Step 7: Verify `pnpm dev` shows a blank page with no errors**

- [ ] **Step 8: Set up TypeScript configs**

Update `tsconfig.json`, `tsconfig.app.json` with `@/` alias, strict mode, React JSX.

- [ ] **Step 9: Set up ESLint + Prettier**

Update `eslint.config.mjs` with TanStack Router plugin. Update prettier config with updated import order.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold React 19 + Vite 8 + Tailwind 4 + shadcn/ui project"
```

---

### Task 2: Auth Layer — HTTP Client + Zustand Stores + Auth Pages

**What:** Build the HTTP client with token refresh interceptor, Zustand auth/theme stores, and all auth pages (login, register, forgot-password, reset-password, verify-email, OAuth callback).

- [ ] **Step 1: Create HTTP client** (`src/http/client.ts`)

Axios instance with `VITE_API_URL` base URL.

- [ ] **Step 2: Create auth interceptor** (`src/http/interceptors.ts`)

Request: attach `Authorization: Bearer` from Zustand store.
Response: 401 with `ACCESS_TOKEN_EXPIRED` → refresh → retry.

- [ ] **Step 3: Create Zustand stores**

`src/states/auth.store.ts` — accessToken, user, isAuthenticated, login/logout/setToken actions.
`src/states/theme.store.ts` — theme (light/dark/system), toggle action, sync to `<html>` class.

- [ ] **Step 4: Create Zod schemas** (`src/schemas/auth.schemas.ts`)

Login, register, forgot-password, reset-password, verify-email — matching backend validators.

- [ ] **Step 5: Create TanStack Query hooks** (`src/queries/auth.queries.ts`)

useLogin, useRegister, useForgotPassword, useResetPassword, useVerifyEmail mutations. useRefresh for silent token refresh.

- [ ] **Step 6: Create AuthLayout** (`src/components/layouts/auth-layout.tsx`)

Centered card, logo, dark mode support. Used by `_auth.tsx` route layout.

- [ ] **Step 7: Create `src/pages/_auth.tsx`** — layout route

Wraps all auth pages. Redirects to `/dashboard` if already authenticated.

- [ ] **Step 8: Create auth pages**

`src/pages/_auth/login.tsx` — email + password form, Google OAuth button, forgot-password link.
`src/pages/_auth/register.tsx` — full registration form.
`src/pages/_auth/forgot-password.tsx` — email-only form.
`src/pages/_auth/reset-password.tsx` — new password form, reads `?token=`.
`src/pages/_auth/verify-email.tsx` — token + password form, reads `?token=`.

- [ ] **Step 9: Create OAuth callback** (`src/pages/auth/callback.tsx`)

Spinner while calling `/auth/refresh` → store token → redirect to dashboard.

- [ ] **Step 10: Create ThemeToggle component** (`src/components/features/theme-toggle.tsx`)

- [ ] **Step 11: Commit**

```bash
git commit -m "feat: add auth layer — HTTP client, Zustand stores, and auth pages"
```

---

### Task 3: App Layout — Sidebar + Header + Notifications

**What:** Build the authenticated app layout with shadcn Sidebar (tenant switcher, nav, user menu), header with notification bell + SSE, and the dashboard/profile pages.

- [ ] **Step 1: Create AppLayout** (`src/components/layouts/app-layout.tsx`)

shadcn Sidebar with:
- Tenant switcher at top (dropdown)
- Navigation links: Dashboard, Notifications, Tenants
- User menu at bottom: Profile, Theme toggle, Logout

Header with: sidebar toggle, breadcrumbs, notification bell with unread count badge.

- [ ] **Step 2: Create `src/pages/_app.tsx`** — layout route

Wraps all authenticated pages. Redirects to `/login` if not authenticated. Fetches user profile on mount.

- [ ] **Step 3: Create SSE hook** (`src/hooks/use-notifications.ts`)

EventSource to `/notifications/stream?token=<accessToken>`. Parses events, updates TanStack Query cache. Manages connection lifecycle (connect on mount, disconnect on unmount, reconnect on error).

- [ ] **Step 4: Create NotificationBell** (`src/components/features/notification-bell.tsx`)

Badge with unread count. Dropdown showing recent notifications. "View all" link to `/notifications`.

- [ ] **Step 5: Create TenantSwitcher** (`src/components/features/tenant-switcher.tsx`)

Dropdown listing user's tenants. Sets `X-Tenant-Id` header on the HTTP client for tenant-scoped requests.

- [ ] **Step 6: Create dashboard page** (`src/pages/_app/dashboard.tsx`)

Welcome card with user's name. Placeholder content for derived projects.

- [ ] **Step 7: Create profile page** (`src/pages/_app/profile.tsx`)

View/edit name. Show email (read-only). List auth providers. Change password form (if email provider).

- [ ] **Step 8: Create notifications page** (`src/pages/_app/notifications.tsx`)

Paginated list with cursor-based pagination. Mark read, mark all read, delete. Notification preferences.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat: add app layout with sidebar, notifications, dashboard, and profile"
```

---

### Task 4: Tenant Management Pages

**What:** Build the tenant CRUD pages — list, create, detail, members, settings.

- [ ] **Step 1: Create tenant queries** (`src/queries/tenant.queries.ts`)

useListTenants, useCreateTenant, useTenantDetail, useUpdateTenant, useListMembers, useAddMember, useUpdateMemberRole, useRemoveMember, useTenantSettings, useUpdateTenantSettings.

- [ ] **Step 2: Create tenant schemas** (`src/schemas/tenant.schemas.ts`)

Create tenant, add member, update settings — matching backend validators including slug regex.

- [ ] **Step 3: Create tenant pages**

`src/pages/_app/tenants/index.tsx` — list + create form.
`src/pages/_app/tenants/$slug.tsx` — detail page with tabs (overview, members, settings).
`src/pages/_app/tenants/$slug.members.tsx` — members management.
`src/pages/_app/tenants/$slug.settings.tsx` — settings form.

- [ ] **Step 4: Add role-based UI controls**

Show/hide actions based on user's role in the tenant. Owner sees all controls, viewer sees read-only.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add tenant management pages — list, detail, members, settings"
```

---

### Task 5: Tests + CI + Dockerfile + Documentation

**What:** Add tests, CI workflow, Dockerfile, and documentation.

- [ ] **Step 1: Configure Vitest + Testing Library + MSW**

`vitest.config.ts` — jsdom environment, setup file with Testing Library matchers.
`src/tests/setup.ts` — `@testing-library/jest-dom` matchers.
`src/tests/mocks/handlers.ts` — MSW request handlers for API endpoints.
`src/tests/mocks/server.ts` — MSW server setup.

- [ ] **Step 2: Write tests**

Priority tests:
- Auth store: login, logout, setToken
- HTTP interceptor: token refresh on 401
- Login form: renders, validates, submits
- Register form: renders, validates, submits
- Protected route: redirects unauthenticated users
- Notification bell: renders unread count
- Tenant list: renders tenants, create form

- [ ] **Step 3: Create CI workflow** (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 4: Create Dockerfile + nginx.conf**

Multi-stage: build (node:24-alpine → `pnpm build`) → serve (nginx:alpine → `dist/`).
`nginx.conf`: SPA routing (`try_files $uri /index.html`), gzip, cache headers.

- [ ] **Step 5: Create CLAUDE.md**

Document conventions: file structure, routing, state management, styling, testing.

- [ ] **Step 6: Create README.md**

Getting started, dev setup, scripts, project structure, tech stack.

- [ ] **Step 7: Run all checks**

```bash
pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add tests, CI workflow, Dockerfile, and documentation"
```
