# react and apex: a shared core for three apps

- **Date:** 3 November 2026
- **Status:** Draft, for review by the repository owner
- **Repos:** `react-boilerplate` (1.0.6), `apex-boilerplate` (1.0.5). The spec
  is kept in `expo-boilerplate` during review and moves to
  `react-boilerplate/docs/superpowers/specs/` when its plan starts.
- **Part 2 of 3.** Part 1 is
  [express: native clients](2026-11-03-express-native-clients-design.md). Part 3
  is [the expo app](2026-11-03-expo-boilerplate-design.md). This part lands
  after part 1 and before part 3.

## Purpose

Split react's browser-free logic into files that react, apex and expo copy
byte for byte, so the session, flag, maintenance and copy rules exist once.
Also add what the app and the stores need from the web side: the
app-association files, the account-deletion page and the staff deletion
queue.

## 1. The rule for a shared file

A shared file imports nothing that only one platform has: `window`,
`document`, `location`, `navigator`, `localStorage`, `sessionStorage`,
`import.meta.env`, `import.meta.dirname`, `posthog-js`,
`posthog-react-native`, `@tanstack/react-router`, `@simplewebauthn/browser`,
`react-native` or `@/components/*`. Where a shared file needs one of these,
it takes it through a **port**: an argument, or a per-app module at a fixed
path that each app writes itself.

`scripts/check-shared.mjs` (run in `pnpm gate`) enforces the import ban on
every path in the shared list.

## 2. The splits

The audit on 3 November 2026 found these files listed for sharing that use
platform APIs. Each splits as follows.

| Today                                                   | Platform use                                                                               | Shared part                                                                                                                                | Per-app part                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/http/client.ts`                                    | relative `API_PREFIX`, `withCredentials: true`                                             | `create-api-client.ts`: `createApiClient({ baseURL, withCredentials })`                                                                    | `client.ts` calls it with the app's base URL                                                                                          |
| `src/http/interceptors.ts`                              | `window.location.origin` (line 103); imports `redirectToLogin`, `broadcastLogout`          | the interceptor chain, given `isApiRequest(config)` and a `session` port                                                                   | `isApiRequest` and the session port                                                                                                   |
| `src/http/session.ts`                                   | `BroadcastChannel`, redirects, cookie refresh                                              | `auth-verdict.ts` (`isAuthVerdict`); `refresh-core.ts`: one in-flight refresh, given a `transport` (`cookie` or `body`) and a `tokenStore` | `session.ts`: `ensureSession`, `switchIdentity`, `broadcastAuthMessage`, `broadcastLogout`, `subscribeAuthMessage`, `redirectToLogin` |
| `src/observability/flags/flag-values.ts`                | `import.meta.env.DEV` (lines 94, 100)                                                      | the file, reading `isDev` from `@/configs/runtime`                                                                                         | `src/configs/runtime.ts`                                                                                                              |
| `src/observability/telemetry/url-sanitizer.ts`          | a type import from `posthog-js` (line 9)                                                   | the file, with a local type                                                                                                                | none                                                                                                                                  |
| `src/lib/maintenance-mode.ts`                           | `@tanstack/react-router`, `sessionStorage`                                                 | `maintenance-state.ts`: header parsing and the mode machine                                                                                | storage and navigation                                                                                                                |
| `src/lib/current-tenant.ts`                             | `@tanstack/react-router`, `location.pathname`                                              | `resolve-current-tenant.ts`: `(routeSlug, searchTenant, storedSlug, eligible) → slug`                                                      | reading the route                                                                                                                     |
| `src/queries/auth.queries.ts`                           | `window.location.assign` (line 132)                                                        | the queries                                                                                                                                | navigation through a port                                                                                                             |
| `src/queries/passkey*.queries.ts`, `step-up.queries.ts` | `@/lib/webauthn` (`@simplewebauthn/browser`)                                               | the queries, given a `webauthn` port (`create`, `get`, `isSupported`)                                                                      | browser: `@simplewebauthn/browser`; native: `react-native-passkeys`                                                                   |
| `src/lib/step-up-presence.ts`                           | `navigator.locks`                                                                          | none                                                                                                                                       | the whole file                                                                                                                        |
| `src/lib/members-limit.ts`, `src/lib/billing-page.ts`   | none, but the copy says "Upgrade" (members-limit lines 15, 17; billing-page lines 26, 236) | the limit and plan logic, returning data                                                                                                   | the copy (part 3, section 6)                                                                                                          |
| `src/queries/billing.queries.ts`, `tax.queries.ts`      | `download-file` (DOM)                                                                      | the read queries                                                                                                                           | invoice download                                                                                                                      |
| `src/states/*`                                          | `localStorage`, `matchMedia`; `auth.store` imports `command-palette`                       | none                                                                                                                                       | every store                                                                                                                           |

`src/types/*` and `src/constants/*` are imported by the shared queries, so the
shared list includes them, except `constants/frontend.ts` (`FRONTEND_APP`) and
`lib/action-message.ts`, which stay per app as they are today.

The full shared list is produced by the plan from the import graph, starting
from the table above and the browser-free files the audit named:
`plan-refusal`, `plural`, `retry`, `countdown`, `relative-time`,
`billing-format`, `billing-banner`, `trial-summary`, `role-denied`,
`write-failure`, `passkey-sign-in-message`, `notification-link`,
`notification-type`, `tenant-guard`, `onboarding.queries`, the `list`,
`list-request` and `search` schemas, `list.types.ts` and `use-now.ts`.

## 3. apex

apex holds `src/http/*` byte for byte with react today, except `sse.ts`
(react `ARCHITECTURE.md`, "Sibling sync with apex"). It takes the same split
in the same piece of work: `create-api-client.ts`, the interceptor chain,
`auth-verdict.ts` and `refresh-core.ts` become shared, and apex keeps its own
`client.ts` and `session.ts`. apex's `toast.ts` and `form.tsx` stay shared
with react only; expo has its own.

## 4. Sync documentation and checks

- react's `ARCHITECTURE.md` gets a single **"Shared core"** table with a column
  per app (react, apex, expo), replacing the apex-only table. react stays the
  source for every shared file; `scrub.ts` still changes in express first.
- `scripts/sync-check.mjs` in apex and expo compares each shared path with
  `../react-boilerplate` byte for byte. CI checks out `react-boilerplate` at
  `main`.
- react's `CLAUDE.md` "Sibling sync" section names expo alongside apex.

## 5. Tests that run in both runners

react and apex run Vitest; expo runs Jest (part 3 says why). A shared test
uses only `describe`, `it`, `test`, `expect` and `beforeEach`/`afterEach`, no
`vi.*`, no `import.meta` and no `node:fs`.

- `tests/unit/copy-style.test.ts` replaces `import.meta.dirname` (line 28) with
  a root passed from each runner's setup file.
- `tax-details.schemas.test.ts` stops reading fixtures through `node:fs`; it
  imports them.
- `check-shared.mjs` applies the same ban to shared tests.

## 6. Web pages the app needs

### App-association files

react's nginx serves, rendered at container start like the run-time config:

- `/.well-known/apple-app-site-association`, as `application/json`, with
  - `applinks.details[].appIDs` listing every app ID in `IOS_APP_IDS`
    (comma-separated `TEAMID.bundle.id`, one per build profile);
  - `components` listing only the paths express emails: `/auth/link`,
    `/auth/confirm`, `/invitations/accept`, `/invitations/confirm`,
    `/settings/account/security`, `/tenants/*`. `/settings/workspace/*/billing`
    is excluded so the billing link opens the website;
  - `webcredentials.apps` with the same app IDs.
- `/.well-known/assetlinks.json` with one statement per entry in
  `ANDROID_APP_LINKS` (`package:sha256,…`), each with both
  `delegate_permission/common.handle_all_urls` and
  `delegate_permission/common.get_login_creds`.
- An unset variable makes its path return `404`.
- The files are served from `WEB_URL`'s host. When `WEBAUTHN_RP_ID` is a parent
  domain, `webcredentials` must also be served there; part 1's env check
  refuses that combination while iOS passkeys are enabled.

### Account deletion page

- Settings › Account › Delete account, in react, calls
  `POST /account/deletion-request` through `useStepUp().run`.
- It states the due date from the response and, once requested, shows the
  open request instead of the button.
- It is reachable signed out at `/delete-account` too, which sends a sign-in
  link first. This is the public URL entered in Google Play Console.

### Staff deletion queue (apex)

- A "Deletion requests" page lists open requests by `due_at`, with the user,
  the workspaces they solely own (from the `409` details) and a "Delete
  account" action that calls the existing `DELETE /platform/users/:id` with the
  request's ID as the reason.

## Success criteria

1. `pnpm gate` passes in react and apex, with `check-shared.mjs` reporting no
   banned import in a shared file.
2. Every shared file is byte for byte equal in react and apex.
3. `curl -s https://<WEB_URL host>/.well-known/assetlinks.json` returns both
   delegate permissions for each configured package.
4. A customer can request deletion on the web, and staff can complete it in
   apex.
