# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repository.

This file is not a tour of the codebase — the code says what it does, and the
comments in it say why. What follows is the set of decisions that look wrong
until you know the reason. Changing one
of these is a deliberate act, not a tidy-up.

## What this is

A React 19 + TypeScript SPA that talks to the `express-boilerplate` API. Vite,
TanStack Router (file-based), TanStack Query, TanStack Form, Zustand, Tailwind
v4, Base UI via shadcn, axios, Zod v4, Vitest + Testing Library + MSW.

## Commands

| Command              | What it does                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Dev server on :5173, proxying `/api` to `:4040`                                                    |
| `pnpm build`         | `tsc -b` then `vite build`                                                                         |
| `pnpm lint`          | eslint **and** `prettier --check` — both must be clean                                             |
| `pnpm typecheck`     | `tsc --noEmit` over `tsconfig.app.json`, then `e2e/tsconfig.json`                                  |
| `pnpm test`          | Vitest, one pass                                                                                   |
| `pnpm test:coverage` | Vitest with coverage; fails under 88/82/86/89 (statements/branches/functions/lines), as CI runs it |
| `pnpm format`        | prettier --write                                                                                   |

The gate is **0 errors and 0 warnings**: verify with
`pnpm exec eslint . --max-warnings 0`, not with a bare `pnpm lint`, whose
eslint half exits 0 on warnings.

## Git hooks

- **Tracked in `.husky/`, executable.** pre-commit: lockfile drift, lint-staged
  (eslint `--fix --max-warnings 0` + prettier on staged files), `vitest --changed`.
  commit-msg: commitlint (conventional commits). pre-push: the full lint gate,
  typecheck and unit tests — **no e2e**, on purpose: a long pre-push hook can
  outlast the SSH connection and drop the push. CI runs e2e.
- **Hooks call `pnpm exec`, never `npx`** — `npx` on a fresh machine downloads
  whatever version is newest, not the one this repo tested against.
- **The hooks must stay committed.** `prepare` generates only husky's `_/`
  directory, so if `git ls-files .husky` is ever empty, no hook runs locally.

## CI and deploy

`ci.yml` runs on PRs and is called by `deploy.yml` on push to `main` as the
gate; then `deploy.yml` builds and pushes `ghcr.io/<repo>:sha-<commit>` and
`:main` with SBOM and provenance attestations, then runs a placeholder
`deploy` job bound to the `production` environment. Keep CI's concurrency
group keyed on `github.event_name`, not `github.workflow`: when `deploy.yml`
calls `ci.yml`, `github.workflow` is the caller's name. Non-PR runs are grouped
per commit so a newer push never drops a pending one. A manual
`workflow_dispatch` from a non-`main` branch pushes an sha-tagged image
only — `:main` and the `deploy` job both run only from `main`.

- `gitleaks.yml` scans each PR's commits and each push to `main` for secrets.
- `pr-title` — the PR title must be a conventional commit; it becomes the squash commit release-please reads.
- `ci.yml`'s `test` job ends with `pnpm audit --prod --audit-level high`: a high or critical advisory in a production dependency fails CI.
  Because `test` is a required check, an advisory with no fixed version blocks every PR. The escape hatch is `pnpm audit --ignore <GHSA>`,
  which writes that one ID under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`; add a comment there by hand giving the reason and a date to revisit.

**Releases merge themselves.** `release.yml` queues release-please's PR with
`--auto`, falling back to a direct merge if `--auto` is refused; the `main`
ruleset (README, one-time setup) keeps either from skipping required checks.
Its token is a GitHub App's (variable `RELEASE_APP_CLIENT_ID`, secret `RELEASE_APP_PRIVATE_KEY`; Contents
and Pull requests read/write), not `GITHUB_TOKEN`, whose events start no
workflow. The `vX.Y.Z` tag re-runs `deploy.yml`, whose `promote` job builds
nothing: it waits for `:sha-<commit>` from `main`'s run and adds `:X.Y.Z`,
`:X.Y` and `:X` to that same digest. Tag runs skip `ci`, `image` and `deploy`.

## Auth — the rules that break silently when broken

- **The API prefix is fixed and relative** (`/api/v1`), written once as
  `API_PREFIX` in `src/constants/routes.ts`. This SPA's own traffic is same-origin
  by design — the dev server proxies `/api`, and the container's nginx does the
  same — so an absolute URL fails at runtime in a way no test catches. Do not add an
  environment variable for it: one that moves only the axios base leaves the
  stream's URL, the Google OAuth anchor and nginx's SSE `location` on the old
  prefix. Moving the prefix means changing `API_PREFIX` and `nginx.conf`'s SSE
  `location` together; `vite.config.ts` proxies all of `/api`, so it changes
  only for a prefix outside `/api`. **The backend is not actually CORS-blind** — its
  `src/configs/cors.config.ts` (express-boilerplate) answers a cross-origin
  caller, and its `allowedHeaders` entry for `Last-Event-ID` is the only reason
  a second, cross-origin frontend's stream can replay on reconnect at all —
  same-origin is simply what this particular SPA ships as.
- **The access token is memory-only.** It lives in `auth.store` and nowhere
  else. Never write it to `localStorage`, `sessionStorage`, a cookie or a query
  string, and never add a `persist` middleware to that store. The refresh token
  is an httpOnly cookie the browser owns; the client never reads it.
- **`ensureSession()` is the only caller of `/auth/refresh`.** That single-flight
  wrapper is what makes N concurrent 401s produce exactly one refresh. A second
  call site anywhere — an interceptor, a retry, a bootstrap path — reintroduces
  the thundering herd it exists to prevent, and the existing tests will not see
  it.
- **A user is signed out only by a 401 verdict**: a 401 on a request made by
  `refreshSession()`, or a 401 WITHOUT `ACCESS_TOKEN_EXPIRED` on any request
  that carried a bearer token and no `skipAuthRetry` (interceptors.ts). Not
  "the refresh failed", not "the server answered". A 502
  during a rolling restart, a timeout, a dropped connection: none of those sign
  anyone out. Widening this to any error is the single easiest way to log every
  user out during a deploy.

## The container

- **nginx enforces a Content-Security-Policy with `script-src 'self'`.** There
  is no inline script anywhere, and there must not be one: the pre-paint theme
  script is `public/theme-init.js`, loaded by a blocking `<script src>`. A new
  origin for scripts, styles, images, fonts or `fetch` means changing the policy
  in `nginx.conf` in the same commit. The README's CSP section has the reasons
  for each directive.
- **`src/lib/zod-jitless.ts` is the first import in `main.tsx`, `tests/setup.ts`
  and `e2e/harness/harness.tsx`**, because Zod's JIT probe trips `script-src 'self'`;
  never fix that by adding `'unsafe-eval'` instead.
- **It listens on 8080 as uid 101 and is built for a read-only root.** Everything
  it writes is under `/tmp`, so it needs a writable `/tmp` (a tmpfs);
  `docker/check-image.sh` checks all of this from outside.
- **No `location` declares `add_header`.** One that did would silently drop
  every security header — `nginx.conf`'s map comment says why.

## Never install

`react-hook-form`, `@hookform/resolvers`, `next-themes`,
`@tanstack/zod-form-adapter`, `clsx`, `tailwind-merge`, any `@radix-ui/*`.

Each has an in-repo replacement: TanStack Form with a Zod validator (no
adapter package is needed in v1), `theme.store` plus the pre-paint script
`public/theme-init.js`, the `cn` package, and Base UI through shadcn. Adding one of these
back gives the project two ways to do the same thing, which is how the
inconsistency starts.

## Never run

`shadcn add form` or `shadcn add toast`. The registry's `form.tsx` is built on
react-hook-form and its toast on next-themes; both are on the list above. Ours
are hand-written for this stack.

## The `src/components/ui/**` exception

That directory is **vendored** shadcn output. Edits there are lost the next time
the component is re-added, so it is excluded from the checks that would
otherwise churn the diff on every `shadcn add`:

- **prettier skips it entirely** (`.prettierignore`) — shadcn emits semicolons
  and double quotes, and reformatting them fights the registry on every re-add.
- **eslint excludes only the Tailwind rules, `react-refresh/only-export-components`
  and `local/comment-style`** (`eslint.config.js`, the `src/components/ui/**`
  block and the comment-style block). Everything else still
  applies. Do not read this as "eslint skips the directory" — print the config
  for a file in there and count: 507 rules, 113 of them enabled, including
  type-aware ones like `@typescript-eslint/no-unsafe-call` at **error**. A type
  error in there fails CI like anywhere else. Settle this with
  `eslint --print-config` rather than by reading the config file: the
  `ignores: ['src/components/ui/**']` on the Tailwind _settings_ block is
  exactly what makes it easy to misread.

**`form.tsx` and `sonner.tsx` are ours, not upstream's.** Both are fully linted
and formatted, and both are named explicitly in four lists: in
`eslint.config.js`, the block that re-enables the Tailwind and
`react-refresh` rules (`files: ['src/components/ui/sonner.tsx', 'src/components/ui/form.tsx']`)
and the `ignores` of the `cn` import-restriction and comment-style blocks
(`src/components/ui/!(form|sonner).tsx`); and the `!` negations in
`.prettierignore`. If you add a third hand-written file to that directory, add
it to all four in the same change or it will sit there unchecked.
`coverage.exclude` in `vitest.config.ts` does not name them: it is the inverse
list, naming the vendored files, so a new vendored one goes there and a
hand-written one stays out.

## Forms

- Frontend Zod schemas in `src/schemas/` **mirror the backend validators**.
  They are one contract in two repos: change both together, or the client will
  accept what the server rejects.
- Parse before posting. TanStack hands `onSubmit` the raw form state, so a
  schema's `.trim()`/`.toLowerCase()` only reaches the wire if the value is
  parsed on the way out.
- **`<Form>`'s server-error clearing covers native inputs only.** It listens for
  a change event that bubbles out of the form element. A Base UI `Select` does
  not emit one, so a form with a Select must call `serverErrors.clearField()`
  itself — `$slug.members.tsx` is the worked example. The `Checkbox` case is
  **unverified**: check it before relying on either answer.

## Versions

**TypeScript stays at `~6.0.3`.** typescript-eslint 8.70.1 peers
`typescript: ">=4.8.4 <6.1.0"`, which excludes all of 7.x. Bumping ahead of that breaks the type-aware
lint rules, which are most of the lint config. Re-check that peer range before
assuming the block still holds; it is the whole of the constraint.

**`@types/node` is NOT part of that constraint.** It is on 26.x with
`typescript ~6.0.3`, and eslint (type-aware rules included), `tsc`, the unit
tests, the e2e fixtures and `pnpm build` are green on that pair. Do not pin it
to TypeScript's hold.

**The pnpm version lives in one place: `packageManager` in package.json.** The
Dockerfile runs `corepack install` and CI's `pnpm/action-setup` reads the same
field. pnpm 12 records itself in the lockfile (`packageManagerDependencies`),
so changing the field means regenerating `pnpm-lock.yaml` in the same commit,
or `--frozen-lockfile` fails.

**`devEngines.runtime` (`onFail: "error"`) is what refuses a wrong Node at
install; `.npmrc`'s `engine-strict` does not enforce this root project's own
Node version under pnpm 12.**

**When Node moves to 26, `engines.node` and `devEngines.runtime.version` are
moved by hand alongside the Renovate-held pins** — Renovate does not move a
`>=` range on its own, only the pinned versions it already tracks.

**Renovate opens updates weekly** (grouped, 3-day minimum release age,
actions pinned to SHAs); minor, patch and digest updates auto-merge once
required checks pass, majors and the node/typescript pins wait for a human,
and security fixes open immediately with the `security` label. `renovate.json` holds TypeScript `<6.1.0` and every
Node version pin — the docker `node` image, `.nvmrc` and CI's
`node-version:` — `<25`; lift those rules deliberately. The explicit Corepack
pin in `Dockerfile` and `README.md` is tracked via a custom regex manager.

## Conventions the linter enforces

- **kebab-case** filenames and folders under `src/`, with suffixed files
  confined to their directory: `*.store.ts` → `src/states/`, `*.queries.ts` →
  `src/queries/`, `*.schemas.ts` → `src/schemas/`, `*.types.ts` → `src/types/`,
  `use-*` → `src/hooks/`.
- **`src/pages/**` is exempt** from all of it. TanStack Router's file-based
  routing needs `__root.tsx`, `_auth.tsx` and `$slug.members.tsx`, which are not
  kebab-case by design.
- **No test file lives under `src/`.** Vitest suites go in `tests/unit/`,
  mirroring the src/ path of their subject (`src/http/session.ts` →
  `tests/unit/http/session.test.ts`); cross-cutting suites (`a11y.test.tsx`)
  sit at `tests/unit/`, shared support in `tests/mocks/` and `tests/fixtures/`,
  imported as `@/tests/...`. Playwright suites stay in `e2e/`. Linted:
  `check-file/filename-blocklist` rejects any `*.test.*`, `*.spec.*`,
  `__tests__/` or `src/tests/` file under `src/`, `src/pages/` included — so
  TanStack Router never sees a test file in its routes directory.
- Tests are **`.test.ts(x)`**, never `.spec.`, and never in a `__tests__/`
  folder — also linted, under `tests/` as well as `src/`.
- **Comments.** Every comment is one of three kinds: a declaration JSDoc (the
  contract), a `/** @file … */` of 1–3 sentences, or a one-line `//` why, used
  only for security, concurrency, a timing budget or a named external bug. A
  JSX comment is one line and only for those same reasons. No history;
  `local/comment-style` checks the form.

## Test timing rules

Across `tests/` and `e2e/`, eslint catches the common forms of a bare sleep and of
`networkidle`: a `setTimeout` inside `new Promise`, `sleep()`, `waitForTimeout()`,
`setTimeout` from `timers/promises`, and a literal `networkidle`. The only exempt
files are `tests/fixtures/timing.ts` and `e2e/timing.ts`, which implement the
deliberate waits.

1. **Wait on a condition, never on a duration.** `findBy*`, `waitFor` and
   `vi.waitFor` in `tests/`; web-first assertions and `expect.poll` in `e2e/`; fake
   timers when the product's own timer is what the test is about.
2. **A deliberate wait is `settle(ms, reason)`** from `@/tests/fixtures/timing`
   (`e2e/timing.ts` re-exports it). The reason names what can't be observed:
   "absence has no event", "poll interval", "injected latency". A blank reason
   rejects, and an empty literal fails typecheck. Waits inside the page are the
   named helpers in `e2e/timing.ts`.
3. **A wall-clock upper bound is allowed only when the bound is the claim under
   test.** It carries a comment naming what it proves, and either references a
   product constant by name or has at least 10× headroom over the measured p99.
4. **No exact counts of process-wide resources.** Count only what the test created.
5. **A negative check waits on a barrier event where one exists**, and otherwise
   on `settle` with a reason.
6. **Never raise a timeout to fix a flake before its mechanism is known.**
   `asyncUtilTimeout` in `tests/setup.ts` is every `findBy*`/`waitFor` budget; a
   `{ timeout }` that only restates it is noise.

Three fake-timer traps, each read out of the installed versions:

- **Without `shouldAdvanceTime`, `findBy*` and `waitFor` hang.** Testing Library
  ends each one with a `setTimeout(0)` drain and advances fake timers only when a
  `jest` global exists, which Vitest does not define. Under a clock that moves only
  when told, assert with `getBy*` after `await act(() => vi.advanceTimersByTimeAsync(ms))`,
  and restore real timers before the next `findBy*`.
- **React's async `act` flushes on Node's `timers.setImmediate`**, which Vitest's
  default `toFake` fakes too, so `await act(async …)` can stall under a clock nothing
  advances. Fake only what the code under test reads, as `router.test.tsx` does with
  `{ toFake: ['setTimeout', 'clearTimeout', 'Date'] }`.
- **A `userEvent` that types while fake timers are on needs the `advanceTimers`
  option**, as in `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
  user-event waits a `setTimeout(delay)` after every keystroke and calls
  `advanceTimers(delay)` alongside it, so without the option typing waits on a clock
  that never moves.

## End-to-end tests

`pnpm test:e2e` (fixtures) and `pnpm test:e2e:live` (needs a backend). Playwright, four
projects (`fixtures`, `live`, `contrast`, `nginx`), and three conventions that are load-bearing rather than taste:

- **Tests are `*.test.ts`, never Playwright's default `*.spec.ts`** —
  the rest of the repo uses `.test.` (`check-file/filename-blocklist` rejects `.spec.` in
  `src/` and `tests/`). `playwright.config.ts` sets `testMatch` accordingly.
- **`vitest.config.ts` carries an explicit `include` of `tests/**`.** Vitest's default
  `include` is `**/*.{test,spec}.*`, so without it Vitest collects the Playwright specs and
  runs them under jsdom.
- **`e2e/` is typed-linted via its own `tsconfig.json`** and `projectService`, not exempted
  with `disableTypeChecked` the way the root configs are. `playwright.config.ts` itself is a
  root config and is linted with those.

**`fixtures`** drives `e2e/harness/` — the real router and real CSS with MSW answering the
same fixtures `tests/unit/a11y.test.tsx` uses, so it needs no backend. It exists for the
checks jsdom cannot make, because jsdom has no layout: whether the webfont actually resolved,
whether anything overflows the viewport at 390px, whether a state renders as more than a bare
header. `?state=loaded|empty|error|loading|soleowner` picks the members response.

Two harness traps that make a test measure the wrong thing: answering
the SSE stream with `204` looks to the hook exactly like a dropped connection and sends the
page into a refresh-then-redirect that a test will race; and **any endpoint left unmocked
falls through** (`onUnhandledRequest: 'bypass'`) and 401s. Under Playwright, the `fixtures` and
`contrast` projects take `test` from `e2e/hermetic.ts`, which answers every `/api` request that
would leave the browser with express's 401 envelope, and fails the test at teardown if any `/api`
response came from the proxy instead, or if it answered anything other than a signed-out page's
bootstrap refresh — naming each. A test that fulfills an `/api` route itself stamps its response with
`FALLBACK_HEADER` from that file, or the teardown reports it as an escape. The 401 still
signs the harness user out — any non-expiry 401 on a token-bearing request is a verdict
(interceptors.ts) — so every authed endpoint the page under test calls must be mocked, not
only the one being asserted on. If a fixtures test starts landing on `/login`, that is why,
and the teardown message names the endpoint.

**`live`** needs a real express-boilerplate on `:4040` and its docker services, and is skipped
unless `E2E_LIVE=1`. Accounts are registered and verified through mailpit — login stays 401
until the address is verified, and the link only exists in the email. Each run uses a **fresh
address**, because the login limiter is keyed `ip:email` at five attempts per fifteen minutes
and a fixed address would rate-limit every rerun.

**`nginx`** runs against the PRODUCTION image — `pnpm test:e2e:nginx` builds it, runs it on
:8088 (container port 8080, read-only root) with `--add-host=api:host-gateway`, tests, and
tears it down. The tests tagged `@no-api` (headers, the CSP, the theme script, the asset 404, the boot splash)
need no backend and also run in CI's `e2e` job, against the image with nothing behind `/api`;
the rest need a live API and run only locally. The project exists first for a reason worth
keeping: **the Vite dev proxy does not propagate an upstream close.**
A `curl -N` at it stays open after the API is killed, so the reading side of the client's
`fetch` body stream never sees `done: true`, `parseSseStream`'s generator never returns, and
the SSE reconnect path is unreachable from a dev-server browser. The same curl against nginx
exits on the second the API dies. Anything that depends on noticing a dropped upstream has to
be tested here, not against `pnpm dev`.

**`contrast`** (`pnpm test:contrast`) runs axe's `color-contrast` rule — the one thing jsdom
cannot compute at all — over every surface reachable without a backend, in **both themes**:
the sign-in, register and forgot-password pages, `reset-password`/`verify-email` (both loaded with a `?token=`:
without one, `reset-password` renders its "This link is incomplete" branch instead, while
`verify-email` renders its normal form with an empty token field), and the authenticated pages through the
harness's `?path=`. Every surface asserts a heading it alone renders BEFORE axe runs — a route
that redirects still paints a perfectly legible page, so without that assertion a surface
could report green while measuring something else entirely. It
injects the axe-core already in devDependencies rather than adding a package. It needs no
backend at all: the public pages' session bootstrap is answered by `e2e/hermetic.ts`, so an
express on `:4040` that is restarting or hung cannot stall a run.

**Opt-in and not in CI** — a deliberate cost decision, but do not read "contrast is a property
of the palette, which moves rarely" as the whole risk model. Component composition breaks
contrast too — which token a component puts on which surface decides the ratio, not the palette
alone — and composition changes on every feature, so run this before merging UI work, not only when a
token moves. **Do not eyeball a contrast change — run the script.**

`restartApi()` kills by port with `-sTCP:LISTEN` and escalates SIGTERM→SIGKILL. Both details
are load-bearing: `pnpm dev` is `tsx watch`, whose CHILD holds the port and survives a
group SIGTERM, and without `-sTCP:LISTEN` lsof also lists the Vite proxy as a client of that
port and the kill takes the dev server down too.

## Accessibility

`tests/unit/a11y.test.tsx` is a gate, not a smoke test: every routed page, plus
an open dialog, an open sheet and all four open menus, must come back clean. If
something trips a rule, **fix the markup** — no rule is disabled to make it pass.

**Menus are graded at menu scope, not document scope, and that is the one place
the gate narrows.** Base UI portals a menu popup to `document.body`, so at
document scope every open menu trips `region` — "some page content is not
contained by landmarks". That is a page-structure rule, and it does not describe
a barrier in a transient popup that focus has just been moved into; the dialog
and sheet escape it only because axe exempts `role="dialog"`. `expectNoViolationsIn`
therefore runs the **identical rule set** against the popup element. Nothing is
disabled, and the narrowing is pinned the same way the document context is: it
asserts `aria-required-children` is in `results.passes`, which only happens when
axe really evaluated a `role="menu"`. Pages are still graded at document scope.

The alternative — rendering the popups into a container inside a landmark — was
not taken: the triggers live in the sidebar and header, so `<main>` would be the
wrong home for their menus, and dropping the portal risks real clipping and
stacking regressions to satisfy a rule that is not describing a real barrier.

Four details that a "tidy-up" would quietly undo:

- It runs **axe-core over `document`**, not jest-axe's `axe()` over a fragment.
  Axe reports its page-level rules (`page-has-heading-one`, `landmark-one-main`,
  `bypass`, `html-has-lang`, `document-title`) as _inapplicable_ for anything
  smaller than the document, so a fragment run grades far less than it looks
  like it does. The context is **pinned by an assertion**, not by this comment:
  the gate asserts `html-has-lang`, `document-title` and `bypass` are in
  `results.passes`, so narrowing the context back to `document.body` fails the
  gate instead of silently passing it.
- **Every page needs exactly one `<main>` and exactly one `<h1>`**, and the test
  asserts both by hand. It has to: axe's own rules for them query
  `[aria-level=1]`, a selector jsdom rejects outright, so axe files them under
  `incomplete` — which `toHaveNoViolations` does not read. `CardTitle` renders a
  `div`, so a page's `h1` goes _inside_ it.
- **`RouteError`, `RoutePending` and `RouteNotFound` all carry no `<main>`
  of their own.** `defaultErrorComponent`, `defaultPendingComponent` and
  `defaultNotFoundComponent` all render the SAME way: in place of a matched
  route's own component, inside whichever `Outlet` that route sits in — so
  whether the page ends up with a `<main>` depends on that route, not on the
  fallback. For a route nested inside `_app` or `_auth`, the `Outlet` is
  already inside the layout's `<main>`, pending or throwing `notFound()`
  alike, so the page still ends up with exactly one, contributed by the
  layout. For the router's OWN top-level splat route (`src/pages/$.tsx`, matched when nothing else does), there is
  no layout ancestor to contribute one, so `$.tsx` wraps `RouteNotFound` in
  its own `<main>` — the fallback component stays bare specifically so it
  does not double up when it renders as `defaultNotFoundComponent` for a
  route that already has a layout.
- Colour contrast is **not** checked _there_. jest-axe's default — reproduced
  explicitly in that file — switches every `cat.color` rule off under jsdom,
  which has no layout. Contrast is measured separately, in a real browser, by
  `pnpm test:contrast`; viewport overflow at 390px by the `fixtures` e2e
  project. Focus rings are checked only as a `focus-visible:` class (the tab
  panel test in `a11y.test.tsx`), not in a browser.
