# CLAUDE.md

Rules and gotchas for changing code in this repository. The decisions here look
wrong until you know the reason; changing one is a deliberate act, not a tidy-up.
How the app fits together is in [ARCHITECTURE.md](ARCHITECTURE.md), what it
defends against is in [SECURITY.md](SECURITY.md), and how to run, configure and
deploy it is in [README.md](README.md).

## Sibling sync

`apex-boilerplate` shares the HTTP layer, analytics, flags, error tracking, most
of the container and several components with this app. When you change a shared
path, change apex in the same PR, and say in the description what happened there
("ported in apex#N", or "not applicable because …"). For a file the two apps hold
byte for byte, change this copy first and copy it to apex, except `scrub.ts`,
whose rules change in express first. The paths are listed in
[Sibling sync with apex](ARCHITECTURE.md#sibling-sync-with-apex).

## Staff on tenant pages

Staff screens live in apex. This app keeps three staff surfaces that sit on tenant
pages and the workspace settings pages:

- the platform-access banner;
- the Staff filter and badge on Settings › Workspace › Activity;
- the **Platform** menu item, for staff, which opens the platform tenant's pages.

**A customer tenant reached through platform access (`access === 'platform'`)
shows a read-only Members page (Settings › Workspace › Members).** It offers no
role change, removal, invite, resend or revoke. A staff owner or admin sees one
line pointing to the staff console. The reason: express refuses those writes
from staff without a recent sign-in and a reason
(`requireRecentAuthAndReasonOnPlatformAccess`), and only apex has the reason
flow. This app has "Confirm it's you" (a passkey or an emailed link) for the
recent sign-in, but no reason prompt. The member list and pending invitations stay readable.
Staff who are members of the tenant (`access: 'member'`) keep their controls.

## The current tenant

**Never read the current tenant from `current-tenant.store` in a component; use
`useCurrentTenantSlug()`.** The URL is the source of truth: a tenant page's
`$slug`, else the shell's `?tenant`, which `_app`'s guard keeps to an eligible
tenant. The store is only the guard's fallback, so reading it shows a tenant
the URL does not ([The current tenant in the URL](ARCHITECTURE.md#the-current-tenant-in-the-url)).

## Settings

Settings pages are declared in `src/constants/settings.ts`; add a page there and
as a route under `src/pages/_app/settings/`.

## The gate

- **0 errors and 0 warnings.** `pnpm check` is the static gate: `vp check`
  (Oxlint with type-aware rules, plus the Oxfmt check), then ESLint with
  `--max-warnings 0` for the 17 leftover rules, which run untyped. Oxlint fails on
  a warning too (`denyWarnings` in `vite.config.ts`). `pnpm lint` runs `vp lint`,
  ESLint and `vp fmt --check`, with the same zero-warning bar.
- CI runs `pnpm lint:docs`,
  `pnpm ui:drift`, `pnpm knip`, `pnpm typecheck`, `pnpm test:coverage` (thresholds in
  `vitest.config.ts`), `pnpm check:bundle` and the `e2e` and `docker` jobs. The scripts
  are in [README.md](README.md).

## Dead code (knip)

`pnpm knip` fails CI on an unused file, export, type or dependency. knip is pinned
exactly, because a release can add new kinds of finding. Every ignore in
`knip.jsonc` carries its reason beside it, which is why the file is `.jsonc`. An
ignore without a reason does not go in.

When it reports something:

- An export used only in its own file loses `export`. A symbol used nowhere is
  deleted, and a re-export nobody imports leaves its barrel.
- An export a test imports counts as used, so a test seam stays exported.
  `pnpm knip --production` (not in CI) lists the exports only tests import.
- A `.mjs` export is removed from its `.d.mts` in the same change.
- A vendored file under `src/components/ui/` that nothing imports still fails:
  delete it. Only its export and type findings are ignored.
- In a file shared with apex, change both apps when apex's knip reports the same
  finding. When only this app's knip reports it, add an ignore that names apex's
  use.

## Git hooks

- **The hooks live in `.vite-hooks/` and must stay committed.** `prepare`
  (`vp config --hooks`) generates only the `_/` dispatcher, so if
  `git ls-files .vite-hooks` is empty, no hook runs.
- Existing clone? After `pnpm install`, run `git config --unset core.hooksPath && pnpm prepare` once, or no hook runs.
- **pre-push runs no e2e.** A long pre-push hook can outlast the SSH connection and
  drop the push. CI runs e2e. `pnpm push [git push args]` runs `pnpm gate` first,
  then pushes with `--no-verify`.
- **Hooks call `pnpm exec`, never `npx`.** On a fresh machine `npx` downloads the
  newest version, not the one this repo tested against.

## CI

- **Key CI's concurrency group on `github.event_name`, not `github.workflow`.**
  When `deploy.yml` calls `ci.yml`, `github.workflow` is the caller's name.
  Non-PR runs are grouped per commit, so a newer push never drops a pending gate.
- **A moderate advisory in a production dependency fails CI**
  (`pnpm audit --prod --audit-level moderate`). `test` is one of the checks the
  `main` ruleset requires ([README](README.md#releases)), so the advisory blocks
  every PR. Prefer an `overrides` entry in `pnpm-workspace.yaml` that forces the
  patched version, with a comment naming the advisory. When no patched version
  exists, list the ID under `auditConfig.ignoreGhsas` there, with a comment giving
  the reason and a date to revisit.
- The PR title must be a conventional commit: it becomes the squash commit that
  release-please reads. How releases and images flow is in
  [Deploy](ARCHITECTURE.md#deploy) and the [README](README.md#releases).

## Auth

Each rule's reason is in [Token storage and refresh](SECURITY.md#token-storage-and-refresh)
and [Sign-out rules](SECURITY.md#sign-out-rules).

- **The API prefix is fixed and relative.** It is `API_PREFIX` in
  `src/constants/routes.ts`. Add no environment variable for it, and never call an
  absolute API URL ([The HTTP layer and session](ARCHITECTURE.md#the-http-layer-and-session)
  lists everything that moves with it).
- **The access token is memory-only.** It lives only in `auth.store`, and that
  store never gets a `persist` middleware.
- **`ensureSession()` is the only caller of `/auth/refresh`.** A second call site
  brings back the refresh race, and the existing tests will not see it.
- **`auth.store.setToken` is the only token swap that is not a sign-in.** Only a
  "Confirm it's you" result calls it. It keeps the user, so never use it to
  change who is signed in.
- **Run a write that may need a recent sign-in through `useStepUp().run`.** A
  401 `REAUTH_REQUIRED` then opens the dialog and retries once; no caller shows
  "sign in again". The new shared passkey and step-up files are apex's copy
  source ([Sibling sync with apex](ARCHITECTURE.md#sibling-sync-with-apex)):
  change them here first.
- **Only an auth verdict signs a user out** (`isAuthVerdict`). If you widen it to
  any error, every user is signed out during a deploy.

## Analytics

Each rule's reason is in [Analytics privacy](SECURITY.md#analytics-privacy).

- **Wrap every rendered person name, email address, avatar initial and
  invitation address in `<Pii>`.** Wrap the value, not the sentence. Use
  `<Pii>`, not `ph-no-capture`, which blanks the element in replay. A page
  that renders a new kind of person data needs a fixture in the harness's
  `?pii=probe` mode and a scan in `e2e/fixtures/pii.test.ts`. Without them
  the guard cannot see it.
- **An attribute may carry personal data only if `mask-attribute.ts` masks it.**
  `e2e/nginx/analytics.test.ts` pins `aria-label` masking in the full snapshot
  and in later mutations.
- **Only `src/observability/telemetry/` imports posthog-js**, and only
  `telemetry.ts` imports it as a value, through `import()`. `pnpm check:bundle`
  fails if it reaches a first-visit chunk.
- **Never widen the privacy guards**: the free-string ban in `event-registry.ts`, the
  browser's ban on person and group properties, `ANALYTICS_URL_QUERY_ALLOWLIST`
  and `guardEvent`. What each one stops is in SECURITY.md. The one exception is
  the campaign keys `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`
  in the allowlist: express puts them on every link it mails, with values from
  its own constants. The sanitizer keeps a campaign value only when it matches
  `^[a-z0-9_-]{1,64}$`, so a hand-edited address or token is dropped. Never add
  `token`, `email` or `redirect`.
- **Never call the SDK's `reset()` directly.** It drops the super properties and
  the consent answer. `resetKeepingConsent` restores both and the page's tenant
  group.
- **Page views come from the router, not posthog-js.** Turning the SDK's history
  page views back on, or grouping from a component effect, files each page view
  under the previous page's tenant
  ([Router hooks](ARCHITECTURE.md#router-hooks-this-app-only)).
- **posthog-js minors and majors wait for a human** (`renovate.json`). Before
  taking one, run the suites that pin its internals: `url-sanitizer.test.ts`,
  `handoff.test.ts` and `analytics.sdk.test.ts` (in
  `tests/unit/observability/telemetry/`, against the real SDK), and
  `e2e/nginx/analytics.test.ts`.

## Feature flags

How flags are read is in [Feature flags](ARCHITECTURE.md#feature-flags).

- **The API is the only evaluator.** Nothing calls posthog-js's `getFeatureFlag`,
  `isFeatureEnabled` or `onFeatureFlags`. Keep `advanced_disable_feature_flags`.
  Never switch to `advanced_disable_flags`: it also stops remote config, so replay
  never starts. Never pass `bootstrap.featureFlags`: posthog-js would put those
  values on every event, over the server's.
- **A flag is a key in `flag-keys.ts` first**, mirroring express's registry entry.
  A value the server sends for a key the slice lacks is dropped.
- **A gated page has a gated API route.** `requireClientFlag` only hides the page.
  Express's `requireFlag` is what refuses.
- **Register `$feature/*` from a layout effect or a router hook, never from a
  query or loader.** A loader also runs for a hover preload, whose scope is not the
  page's.

## Maintenance mode

How it works is in [Maintenance mode](ARCHITECTURE.md#maintenance-mode).

- **Only a known `Maintenance-Mode` value moves the mode.** A response with no
  header, such as nginx's 502 page, or with an unknown value changes nothing. If you
  loosen this, maintenance ends on every deploy's first 502.
- **Read the header in `src/lib/maintenance-mode.ts`, never in `src/http/`.**
  `src/http/` is shared with apex, which has no maintenance handling.
- **A maintenance 503 is never a sign-out, and the layout guards never redirect
  while the mode is `full`.** The URL is what recovery returns the user to. The API
  lets the session restore through in `full`, so a page loaded then is signed in
  as usual.
- **`MaintenanceGate` and `MaintenancePage` stay statically imported** into
  `__root.tsx`. They are needed exactly when the API is failing.

## The container

The mechanism is in
[The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).
The reasons are in [CSP and headers](SECURITY.md#csp-and-headers) and
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

- **No inline script, ever.** The CSP is `script-src 'self'`. A new origin for
  scripts, styles, images, fonts or `fetch` means changing the policy in
  `nginx.conf` in the same commit.
- **`src/lib/zod-jitless.ts` is the first import** in `main.tsx`, `tests/setup.ts`,
  `e2e/harness/harness.tsx` and every `src/` file that imports Zod as a value
  (anything but `import type`). The entry's first import alone is not enough: a
  chunk the entry imports evaluates before the entry's body.
  `tests/unit/lib/zod-jitless.test.ts` and `pnpm check:bundle` enforce it. Never fix Zod's JIT probe by adding
  `'unsafe-eval'`.
- **No `location` declares `add_header`.** One that did would drop every security
  header.
- **The image runs as uid 101 on a read-only root.** Everything it writes goes
  under `/tmp`. `docker/check-image.sh` checks this from outside.
- **Nothing is configured at build time.** A setting that differs between
  environments is a run-time variable, never a `VITE_*` value or a build ARG. A new
  setting touches every file
  [The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config)
  lists, in one change, and its pattern follows
  [Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

## Error tracking

How it works is in [Error tracking](ARCHITECTURE.md#error-tracking). What it sends
is in [Error-tracking privacy](SECURITY.md#error-tracking-privacy).

- **`listen.ts` imports only `identity-epoch.ts`**, which imports nothing. It is in
  every entry chunk, and `pnpm check:bundle` caps it at 1 KB gzipped.
- **`report.ts` never imports the router.** The router registers its route source
  (`setErrorRouteSource`), so a crash in the router's own module can still be
  reported.
- **Inject stays release-less.** `posthog-cli sourcemap inject` in the Dockerfile
  runs with a placeholder token, no `--release-*` flag and no `.git` in the context.
  A release makes it call PostHog and write a release id into every chunk, so an
  unchanged chunk would ship new bytes under its old hashed name.
- **Never soften `docker/upload-sourcemaps.sh`.** Every failure it detects fails
  the build ([README](README.md#source-maps) lists them). Never add `|| true` or
  `--no-fail`: without the maps, the image reports unreadable frames, silently.
- **A `@posthog/cli` bump updates both hashes in `docker/posthog-cli.sha256`** in
  the same change. The Dockerfile checks the binary against them before it runs it
  with the upload token.
- **Change a scrub rule in express first** ([The scrubber](SECURITY.md#the-scrubber)).
  `scrub.ts` is a byte-for-byte copy, so never edit it here alone.

## Never install

`react-hook-form`, `@hookform/resolvers`, `next-themes`, `sonner`,
`@tanstack/zod-form-adapter`, `clsx`, `tailwind-merge`, any `@radix-ui/*`.

Each has an in-repo replacement:

- TanStack Form with a Zod validator, which needs no adapter package;
- `theme.store` with the pre-paint files `public/theme-init.js` and `public/boot-variant.js`;
- the `cn` package;
- Base UI through shadcn, its toast included (`src/lib/toast.ts`).

Adding one back gives the project two ways to do the same thing.

**Never run `shadcn add form` or `shadcn add sonner`.** The registry's `form.tsx` is
built on react-hook-form, and ours is hand-written. The toast is Base UI's, from
base-vega's `toast` item (`src/components/ui/toast.tsx`); raise toasts with `toast`
from `@/lib/toast`, never from the UI file. Re-adding `toast` drops its local edits,
listed below.

## `src/components/ui/`

The directory holds vendored shadcn output. An edit there is lost the next time
the component is added again.

- **Oxfmt skips the vendored files** (`fmt.ignorePatterns` in `vite.config.ts`).
- **Oxlint and ESLint relax only some rules for them**: the Tailwind rules,
  `react/only-export-components`, `local/comment-style`, the JSDoc
  requirement and the `cn` import restriction. Every other rule, type-aware rules
  at error included, still applies, so a type error there fails CI. Settle a doubt
  for ESLint with `pnpm exec eslint --print-config <file>`. For Oxlint, lint a
  probe file under the glob, seeded with `import { cn as seededCn } from 'cn'`:
  `oxlint --print-config` prints the whole config, not one file's. The
  exemptions live in the `vite.config.ts` overrides and in `eslint.config.js`.
- **`form.tsx` is ours**, fully linted and formatted. Find every place that
  names it with `grep -n form.tsx vite.config.ts` and `grep -n '!(form)'
  eslint.config.js`: the `vite.config.ts` override blocks that re-enable the
  `react/only-export-components` and `cn` rules, the `!` negation in
  `fmt.ignorePatterns`, and the `!(form)` globs in `eslint.config.js`. A second
  hand-written file there goes into all of them in the same change.
- **An edit to a vendored file is recorded, or CI fails.** `pnpm ui:drift`
  compares each file with its registry snapshot in `scripts/ui-registry/` and
  accepts only the edits in `docs/ui-local-edits.md`. On drift it prints the
  `ui-drift-hunk` block to record; add it with its reason. Never edit the
  snapshot by hand: `pnpm ui:drift:refresh` retakes it through the installed
  `shadcn` devDependency. A `shadcn` bump, or a `components.json` style or icon
  library change, fails the check until the snapshot is retaken, which is why
  Renovate leaves `shadcn` for a human.
- **A re-add drops these local edits; put them back.** `docs/ui-local-edits.md`
  is the full record. `alert.tsx`: the `warning` and `info` variants. `avatar.tsx`: the fallback
  and group count use `text-foreground` (contrast). `tabs.tsx`: the panel keeps
  `rounded-md focus-visible:ring-3 focus-visible:ring-ring/50` (WCAG 2.4.7).
  `badge`, `button`, `switch`, `tabs` and the sidebar rail name their transition
  properties instead of `transition-all`. The sidebar rail uses `after:w-0.5` and
  the dropdown `min-w-24`. `toast.tsx`: Tabler icons for the registry's
  `IconPlaceholder`; `PII_CLASS_NAME` last in the root's `cn(...)`, after
  `className`, so a caller cannot unmask a toast; top-right anchoring (`top-4`,
  `top-0 origin-top`, every Y offset sign-flipped, `swipeDirection` up and
  right); the `data-[type=…]` border and icon colours on `--success`,
  `--warning-strong` and `--destructive`; the viewport's `aria-label="Status messages"`
  (Base UI's default, "Notifications", names the app's notifications feature);
  and `<Toaster>` defaulting to `toastManager` from `@/lib/toast` instead of a
  manager of its own. `tests/unit/components/ui/toast.test.tsx` fails without the
  mask, the icon colours, the label or the shared manager. Base UI keeps the close
  button `aria-hidden` but tabbable while the stack is collapsed; that is accepted
  upstream behaviour, since Tab reaches the toast first and expands it.
  `shadcn init` also overwrites `src/lib/utils.ts` and `src/hooks/use-mobile.ts`,
  and resets `--muted-foreground` and `--destructive` in `globals.css`, which
  `pnpm test:contrast` then fails.
  Every Tabler icon in `src/components/ui/` except the one in `spinner.tsx`
  carries `aria-hidden="true"` (the guard test `tests/unit/ui-icons-aria-hidden.test.ts` fails otherwise); the
  combobox clear and chip-remove buttons carry `aria-label` for the same reason.
- **The vitest config's coverage `exclude` is the inverse list.** It names the
  vendored files, so a new vendored file goes there and a hand-written one stays
  out.

## Forms

- **The Zod schemas in `src/schemas/` mirror the API's validators.** Change both
  repos together, or the client accepts what the server rejects.
- **Parse before posting.** TanStack hands `onSubmit` the raw form state, so a
  schema's `.trim()` or `.toLowerCase()` reaches the wire only if the value is
  parsed on the way out.
- **Edit forms send only the changed fields** (`useChangedFields` in
  `src/hooks/use-changed-fields.ts`, whose JSDoc gives the wiring). A stored value
  that today's rules refuse must not block saving other fields, so do not parse
  the whole form with the full schema.
- **`<Form>` clears a server error only on a native change event.** A Base UI
  `Select` emits none, so its change handler calls `serverErrors.clearField()`
  itself, as `src/components/features/tenant/invite-member-form.tsx` does. Base
  UI's `Checkbox` is unverified: check it before relying on either answer.

## Versions

- **TypeScript stays below 6.1.** `tsc` 6 and typescript-eslint 8.70.1's parser
  peer `typescript >=4.8.4 <6.1.0`. Oxlint's type-aware engine bundles its own
  TS 7, so it does not constrain this pin. `renovate.json` holds it. Re-check the
  peer range before lifting the hold. `@types/node` is not part of this constraint.
- **The pnpm version lives only in `packageManager`.** The Dockerfile and CI read
  it. pnpm records itself in `pnpm-lock.yaml` (`packageManagerDependencies`), so
  changing the field means regenerating the lockfile in the same commit, or
  `--frozen-lockfile` fails.
- **`devEngines.runtime` (`onFail: "error"`) refuses a wrong Node at install.**
- **Renovate holds every Node pin below 25.** It covers the Docker `node` image,
  `.node-version` and CI's `node-version:`. Renovate does not move `engines.node` or
  `devEngines.runtime.version`, so a Node major moves those by hand alongside the
  pins.
- Renovate's schedule and automerge policy are in `renovate.json`. Majors and the
  Node and TypeScript pins always wait for a human, and so does `shadcn`
  (`pnpm ui:drift:refresh`).

## Conventions the linter enforces

- **kebab-case** file and folder names under `src/`. `src/pages/**` is exempt,
  because TanStack Router's file routes need `__root.tsx`, `_auth.tsx` and
  `$slug.members.tsx`.
- **No path under `src/` that a content blocker matches.** Vite's dev server
  serves each file at its own URL, so a path like `analytics/events.ts` is
  dropped by EasyPrivacy and the app hangs on its loading screen.
  `tests/unit/blocker-safe-paths.test.ts` lists the banned shapes.
- **Suffixed files live in their directory:** `*.store.ts` in `src/states/`,
  `*.queries.ts` in `src/queries/`, `*.schemas.ts` in `src/schemas/`, `*.types.ts`
  in `src/types/`. A file in `src/hooks/` is named `use-*`.
- **No test file lives under `src/`**, `src/pages/` included, so the router never
  sees a test in its routes directory. Unit suites go in `tests/unit/`, mirroring
  their subject's path (`src/http/session.ts` → `tests/unit/http/session.test.ts`).
  Shared support goes in `tests/mocks/` and `tests/fixtures/`, imported as
  `@/tests/...`. Playwright suites go in `e2e/`.
- **Tests are `.test.ts(x)`**, never `.spec.`, and never in a `__tests__/` folder.
- **Import `cn` from `@/lib/utils`**, not from the package.
- **Comments.** Each comment is a JSDoc block, a directive, a one-line JSX comment
  or a single `//` line, and none narrates history (`local/comment-style`). By
  convention, a `//` line gives a why: security, concurrency, a timing budget or a
  named external bug. Every named function, method, class, interface, type alias
  and exported const carries a JSDoc description (`jsdoc/require-jsdoc`).

## Test timing

Across `tests/` and `e2e/`, eslint rejects the common forms of a bare sleep:

- a `setTimeout` inside `new Promise`;
- `sleep()`;
- `waitForTimeout()`;
- `setTimeout` from `timers/promises`.

It also rejects `networkidle`. Only `tests/fixtures/timing.ts` and `e2e/timing.ts`
are exempt, because they implement the deliberate waits.

1. **Wait on a condition, never on a duration.** In `tests/`, use `findBy*`,
   `waitFor` and `vi.waitFor`. In `e2e/`, use web-first assertions and
   `expect.poll`. Use fake timers when the product's own timer is under test.
2. **A deliberate wait is `settle(ms, reason)`** from `@/tests/fixtures/timing`
   (`e2e/timing.ts` re-exports it). The reason names what cannot be observed. A
   blank reason rejects, and an empty literal fails typecheck.
3. **A wall-clock upper bound is allowed only when the bound is the claim under
   test.** It gets a comment naming what it proves, and either references a product
   constant or has at least 10× headroom over the measured p99.
4. **Count only what the test created**, never a process-wide resource.
5. **A negative check waits on a barrier event where one exists**, and otherwise on
   `settle` with a reason.
6. **Never raise a timeout to fix a flake before its mechanism is known.**
   `asyncUtilTimeout` in `tests/setup.ts` is every `findBy*` and `waitFor` budget,
   so a `{ timeout }` that restates it is noise.

Three fake-timer traps:

- **Without `shouldAdvanceTime`, `findBy*` and `waitFor` hang.** Testing Library
  advances fake timers only when a `jest` global exists, and Vitest defines none.
  Under a clock that moves only when told, assert with `getBy*` after
  `await act(() => vi.advanceTimersByTimeAsync(ms))`. Restore real timers before
  the next `findBy*`.
- **React's async `act` flushes on `setImmediate`**, which Vitest's default
  `toFake` fakes too. Fake only what the code under test reads, as
  `router.test.tsx` does with `{ toFake: ['setTimeout', 'clearTimeout', 'Date'] }`.
- **`userEvent` typing under fake timers needs `advanceTimers`**, as in
  `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. Without it, typing
  waits on a clock that never moves.

## End-to-end tests

Playwright has five projects: `fixtures`, `live`, `contrast`, `nginx` and
`capture`.

- **Name e2e files `*.test.ts`.** `playwright.config.ts` sets `testMatch` to
  match. `vitest.config.ts` keeps an explicit `include` of `tests/**`, or Vitest
  would collect the Playwright files and run them under jsdom.
- **`e2e/` is type-linted through its own `tsconfig.json`.** It is not exempted
  like the root configs.

**`fixtures`** drives `e2e/harness/`: the real router and CSS, with MSW answering
the fixtures. It needs no backend. It exists for what jsdom cannot see, because
jsdom has no layout. The harness has two traps:

- **Never answer the notification stream with a 204.** A 204 has no body, so the
  hook treats it as a refused connect. It reconnects with the same token on its
  doubling backoff and never refreshes, so a test races that stream traffic. The
  harness answers with a stream that stays open.
- **An endpoint the harness leaves unmocked falls through**
  (`onUnhandledRequest: 'bypass'`). `fixtures` and `contrast` take `test` from
  `e2e/hermetic.ts`, which answers such a request with express's 401 envelope.
  That 401 on a token-bearing request is a verdict, so it signs the harness user
  out. At teardown it fails the test and names the endpoint. A test that fulfills
  an `/api` route itself stamps the response with `FALLBACK_HEADER`, or teardown
  reports it as an escape. If a fixtures test lands on `/login`, look for an
  unmocked endpoint.

**`live`** needs a real express and its services, Mailpit included, and runs only
with `E2E_LIVE=1`. Sign-in is by emailed link, so the helpers in
`e2e/live/helpers.ts` read each link from Mailpit (`mailedLink` in
`e2e/capture/mailpit.ts`, at `E2E_MAILPIT_ORIGIN`):

- **`freshEmail` per run.** Express mails one address at most one sign-in link
  a minute and ten a day, and answers 202 either way, so a reused address waits
  on links that never arrive.
- **The mail cooldown.** The helpers wait out the one-minute cooldown before
  they ask for a second link to the same address.
- **`RATE_LIMIT_SCALE`.** Express allows ten link requests per IP per fifteen
  minutes. A 429 from `/auth/link/request` fails with a message naming
  `RATE_LIMIT_SCALE`; set it on the API under test to widen the limit.
- **`createUser` and `logIn`.** `createUser` signs an address in through the API
  (request, Mailpit, verify), which creates the account. `logIn` hands that
  session's refresh cookie to a page once, because the cookie rotates on first
  use; after that it signs in through the page and a new link.

`live/flags.test.ts` fails, rather than skips, without
`E2E_FLAGS_SET_CMD`. `live/platform.test.ts` grants platform roles by running
`pnpm platform:grant` in `E2E_API_DIR`, which has no default: point it at the
express checkout whose database the API under test uses, the main
`../express-boilerplate` included. `grantPlatformRole` throws when it is unset,
missing, or has no `platform:grant` script (`grantDirPlan`). Only the SSE
reconnect test needs a separate worktree. The variables, with their defaults, are
in the [README](README.md#testing); never assume `:4040`.

**posthog-js drops every event from a Playwright browser** (`navigator.webdriver`,
a headless user agent). An analytics e2e test uses `HUMAN_USER_AGENT` and calls
`passPosthogBotFilter` before its first navigation (`e2e/helpers/fake-posthog.ts`).

**`nginx`** runs against the production image (`pnpm test:e2e:nginx`). The `@no-api`
tests also run in CI with nothing behind `/api`. The rest need a live API and run
locally. **Test anything that depends on noticing a dropped upstream here, not
against `pnpm dev`.** The Vite dev proxy never propagates an upstream close, so the
stream reconnect path cannot be reached from a dev-server browser.

**The SSE reconnect test (`e2e/nginx/sse.test.ts`) restarts an express**, so it
runs only by hand. `restartApi()` refuses to run, by throwing, unless all of these
hold:

- the origin has an explicit port, and the port is not 4040;
- `E2E_ALLOW_API_RESTART=1` is set;
- `E2E_API_DIR` is set, is a git worktree, and neither is nor holds the main
  `../express-boilerplate` checkout, compared in its true case.

It signals three kinds of process, each only while it runs inside that worktree:
the listeners on the port, the `tsx watch` that supervised each one, and the server
an earlier run recorded in the pid file. What each must match is below the
commands; the rules are in `scripts/api-restart-guard.mjs`.

To run it, give express a worktree whose `.env` comes from `.env.example`, never
from the main checkout's, and services of its own: throwaway Postgres, Redis and
Mailpit containers, never the dev ones on 5433, 6380 and 8025. The run creates
accounts and restarts servers, so it stays out of the dev database, keys and mail.

`.env.example` leaves several required values empty, and express refuses to boot
without them. Set `APP_PORT=4999`, `APP_URL=http://localhost:4999`,
`WEB_URL=http://localhost:8089`, `DATABASE_URL`, `REDIS_URL`, `SMTP_PORT`, an
`openssl rand -hex 32` for each of `JWT_ACCESS_SECRET` and `SESSION_SECRET`, and
`REDIS_KEY_PREFIX=express-sse`. `WEB_URL` must be the image's origin
(`E2E_NGINX_ORIGIN`): `/auth/refresh` refuses a browser `Origin` that is not
`WEB_URL`, `APEX_URL` or in `CORS_ALLOWED_ORIGINS`, and the test's full page load
refreshes the session. The helpers read the sign-in link from
`E2E_MAILPIT_ORIGIN`, so point it at the run's Mailpit, not the default :8025.

```sh
git -C ../express-boilerplate fetch origin   # fetch only: a pull hot-reloads the :4040 dev server
git -C ../express-boilerplate worktree add --detach ../express-sse origin/main
docker run -d --name sse-pg -p 127.0.0.1:5547:5432 -e POSTGRES_USER=boilerplate \
  -e POSTGRES_PASSWORD=boilerplate -e POSTGRES_DB=boilerplate_sse postgres:18
docker run -d --name sse-redis -p 127.0.0.1:6393:6379 redis:7.2-alpine
docker run -d --name sse-mailpit -p 127.0.0.1:8129:8025 -p 127.0.0.1:1129:1025 \
  axllent/mailpit:v1.31.1 --smtp-disable-rdns
# In ../express-sse: cp .env.example .env, then set the values above, with
#   DATABASE_URL=postgres://boilerplate:boilerplate@127.0.0.1:5547/boilerplate_sse,
#   REDIS_URL=redis://127.0.0.1:6393 and SMTP_PORT=1129. Then:
#   pnpm install && pnpm db:migrate && TMPDIR=/tmp pnpm dev
docker build -t react-boilerplate:e2e .
docker run -d --name rb-e2e-sse -p 8089:8080 --read-only --tmpfs /tmp \
  --add-host=api:host-gateway -e API_UPSTREAM=http://api:4999 react-boilerplate:e2e
TMPDIR=/tmp E2E_LIVE=1 E2E_NGINX=1 E2E_NGINX_ORIGIN=http://localhost:8089 \
  E2E_API_ORIGIN=http://localhost:4999 E2E_MAILPIT_ORIGIN=http://localhost:8129 \
  E2E_ALLOW_API_RESTART=1 E2E_API_DIR=../express-sse \
  pnpm exec playwright test --project=nginx e2e/nginx/sse.test.ts
# Stop the server the run started, if it got that far and the pid file's start time
#   still matches its pid. If the run failed before its restart, the pnpm dev you
#   started is still running: stop it with Ctrl-C.
PID_FILE="$(TMPDIR=/tmp node -p 'require("os").tmpdir()')/react-e2e-restarted-api-4999.pid"
if [ -f "$PID_FILE" ]; then
  pid=$(head -n 1 "$PID_FILE")
  [ "$(LC_ALL=C ps -o lstart= -p "$pid" | xargs)" = "$(sed -n 2p "$PID_FILE")" ] \
    && kill -TERM -"$pid"
fi
rm -f "$PID_FILE"
lsof -ti tcp:4999 -sTCP:LISTEN   # must print nothing before the worktree goes
docker rm -f rb-e2e-sse sse-pg sse-redis sse-mailpit
git -C ../express-boilerplate worktree remove --force ../express-sse
```

Each restart stops, besides the listeners, two kinds of process that would
otherwise be left behind. It re-reads each one immediately before each round of
signals (SIGTERM, then SIGKILL) and skips it unless all of these still hold:

- **The `tsx watch` that supervised a listener**, signalled by pid. It was the
  listener's parent when read, before the listener stopped, and its start time
  then must still be the one at that pid. Its command is `tsx watch`, its working
  directory is inside `E2E_API_DIR`, and it is not a shell.
- **The server an earlier run recorded**, signalled by process group. The pid file
  holds its pid and its start time (`ps -o lstart`). The process at that pid must
  have the same start time, run `pnpm dev`, lead its own group, have no
  controlling terminal, and run inside `E2E_API_DIR`. A reused pid fails the start
  time; a shell or a job started from one fails on the terminal and the command.
  When no process holds the recorded pid any more, the group's remaining members
  are signalled by pid instead, each only if it is in that group, keeps the start
  time it was read with, has no terminal, runs inside `E2E_API_DIR` and is pnpm,
  `tsx watch` or the server tsx runs. While another process holds that pid, the
  group is its own, and none of it is touched. "Holds" is a `kill -0` probe, made
  again before each signal: only ESRCH counts as free, so a failed `ps` read
  never makes a live holder look absent.

Every `ps` runs with `LC_ALL=C`, so the start time has one form.

So the test can run again without cleanup in between. A pid file without a start
time, or whose process no longer matches, is replaced and nothing is signalled.
That stopping is best effort: a process that fails a check survives, and the
`lsof` check above is what proves the port is free.

Run `pnpm dev` in the worktree, and the test, with a short `TMPDIR` (for example
`TMPDIR=/tmp`). `tsx watch` opens its IPC socket at `$TMPDIR/tsx-<uid>/<pid>.pipe`,
and a unix socket path longer than 104 bytes fails to bind on macOS; the default
`/var/folders/.../T/` is long. The restarted server's pid file (`PID_FILE=...`)
lives under the same `os.tmpdir()`, so give the kill command the same `TMPDIR`.

`restartApi()` finds listeners with `lsof -sTCP:LISTEN` and escalates SIGTERM to
SIGKILL. Both details matter:

- `pnpm dev` is `tsx watch`, and its child holds the port and survives a group
  SIGTERM;
- without `-sTCP:LISTEN`, lsof also lists the Vite proxy as a client and the kill
  takes the dev server down.

**`contrast`** (`pnpm test:contrast`) runs axe's `color-contrast` rule in a real
browser, in both themes, over every surface reachable without a backend. Each
surface asserts a heading only it renders before axe runs, because a redirected
route still paints a legible page. It is opt-in and not in CI. Component
composition changes contrast as much as the palette does, so run it before merging
UI work. Never judge a contrast change by eye.

**`capture`** (`pnpm capture:pages`) takes the page inventory's screenshots in
`docs/pages/img/` against a dev stack that is already up, and starts nothing.
Run it only through `pnpm capture:pages`: that script sets `E2E_CAPTURE=1`,
which turns `webServer` off, and a bare `--project=capture` starts `pnpm dev`
and then skips every test. It is opt-in and not in CI. How to run it is in
[docs/pages/README.md](docs/pages/README.md).

## Accessibility

`tests/unit/a11y.test.tsx` is a gate. Every routed page, an open dialog, an open
sheet and all four open menus must come back clean. If something trips a rule, fix
the markup. No rule is disabled to make it pass.

- **axe runs over `document`, not a fragment.** Axe's page-level rules come back
  inapplicable for any smaller context. The gate pins this by asserting that
  `html-has-lang`, `document-title` and `bypass` are in `results.passes`.
- **Every page needs exactly one `<main>` and one `<h1>`, and the test asserts both
  by hand.** Under jsdom, axe cannot evaluate `page-has-heading-one` or
  `landmark-one-main`. Both use axe's `passForModal` check, which looks for a
  modal. When no dialog is open, the check calls `document.elementsFromPoint`,
  which axe polyfills over `document.elementFromPoint`; jsdom has neither, so axe
  files both rules under `incomplete`. `toHaveNoViolations` does not read that
  list. When a dialog is open, both rules pass without looking at the page.
  `CardTitle` renders a `div`, so a page's `h1` goes inside it.
- **`incomplete` is pinned.** `KNOWN_INCOMPLETE` lists the rules jsdom cannot
  decide, each with its reason, and the gate fails on any other rule filed there.
  `aria-valid-attr-value` is accepted only when every check on it is
  `controlsWithinPopup`, so a dangling reference still fails.
- **Menus are graded at menu scope.** Base UI portals a menu popup to
  `document.body`, so at document scope every open menu trips `region`.
  `expectNoViolationsIn` runs the same rule set against the popup. It asserts that
  `aria-required-children` passed, which happens only when axe evaluated a
  `role="menu"`. The popups are not rendered inside `<main>`, because their
  triggers live in the sidebar and header.
- **`RouteError`, `PageSkeleton` and `RouteNotFound` render no `<main>`.** They
  render inside the matched route's `Outlet`, which a layout's `<main>` already
  wraps. The top-level splat route `src/pages/$.tsx` has no layout, so it wraps
  `RouteNotFound` in its own `<main>`.
- **Colour contrast is not checked here.** Every `cat.color` rule is off under
  jsdom, which has no layout. The `contrast` e2e project measures contrast, and the
  `fixtures` project checks overflow at 390px.
