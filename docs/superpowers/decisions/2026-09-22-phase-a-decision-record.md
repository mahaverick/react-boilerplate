# Phase A decision record

What this is: the working log kept while Phase A of the React boilerplate rebuild was
built and reviewed, in September 2026. It is not a summary written afterwards — it was
written as the work happened, which is why it records things that turned out to be wrong
alongside the corrections.

Why it is committed: the spec says WHAT to build and the plan says HOW. Neither explains
why a particular constraint exists, and several of them are non-obvious enough that a
future reader would reasonably "simplify" them back into bugs. This file is the why.

**Read this if you are about to change:**

- `isAuthVerdict` in `src/http/session.ts` — the 401-only sign-out rule. It was wrong
  twice, in opposite directions. Widening it to "the server answered" signs every user
  out on every rolling restart.
- `ensureSession()`'s single-flight promise — the backend rotates the refresh cookie, so
  a second concurrent refresh ends the session.
- `skipAuthRetry` — without it, `refreshSession`'s own `/profile` call can re-enter the
  interceptor and await the promise it is itself settling. That hangs; it does not error.
- `safeRedirect` in the login page — a regex was not enough, and neither was the obvious
  URL-parsing fix. See Rulings 22 and its correction.
- The a11y gate's document context in `src/tests/a11y.test.tsx` — `axe(document.body)`
  silently makes the page-level rules inapplicable and the suite still passes.
- Any surface that renders an empty state — failure must never be reported as emptiness.
  Five separate rounds went into applying that consistently.

The entries are in the order they were written. "Ruling N" marks a decision made on the
user's behalf; several are amendments or outright retractions of earlier ones, kept in
place rather than edited, so the reasoning stays legible.

---

# SDD ledger — plan: docs/superpowers/plans/2026-09-21-react-rebuild-phase-a.md

Spec: docs/superpowers/specs/2026-09-17-react-rebuild-design.md @ 44bef9c (reachable)
Branch: docs/react-rebuild-spec-revision
Base: fb9c38086ca3cf70e947e5ac35d7cd50cc4cdad4
Started: 2026-09-22

## Setup

Ruling: no separate git worktree — work proceeds on branch
docs/react-rebuild-spec-revision, which the user approved and which is already
isolated from main. Cost if wrong: none material; the branch is clean, all 61
pre-existing src/ files are committed on main, and `git checkout main -- src`
restores them.

## Pre-flight conflict scan

### Cross-task rows (shared file or interface)

| Producer | Consumer    | Interface / file                                                      | Finding                                                                                                                                                                                                                                             |
| -------- | ----------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1       | T3          | `src/tests/setup.ts`                                                  | T1 writes jest-dom + jest-axe; T3 appends MSW lifecycle. Additive, no overlap. OK                                                                                                                                                                   |
| T1       | T4          | `src/main.tsx`                                                        | T1 writes a placeholder, T4 rewrites. T1 says so explicitly. OK                                                                                                                                                                                     |
| T1       | all         | `@/` alias, `cn()`                                                    | Defined once in T1, consumed everywhere. OK                                                                                                                                                                                                         |
| T2       | T3          | `ACCESS_TOKEN_EXPIRED`, `ApiSuccess`, `ApiErrorBody`, `User`          | Names match at both ends. OK                                                                                                                                                                                                                        |
| T2       | T4,T5       | `ROUTES`                                                              | T2 defines strings + slug fns; T4/T5 use `.dashboard`, `.login`, `.register`, `.forgotPassword`. All present. OK                                                                                                                                    |
| T2       | T3,T4       | `useAuthStore.setBootstrapped()`                                      | Produced T2, consumed T4's `bootstrapSession`. OK                                                                                                                                                                                                   |
| T3       | T4          | `ensureSession`, `resetSessionForTests`                               | Consumed by T4 bootstrap + tests. OK                                                                                                                                                                                                                |
| T3       | T7          | `ensureSession`                                                       | Consumed by the SSE reconnect path. OK                                                                                                                                                                                                              |
| T3       | T5,T6,T7,T8 | `apiClient`, `unwrap`                                                 | Consumed by every queries file. OK                                                                                                                                                                                                                  |
| T4       | T6          | `src/pages/_app.tsx`                                                  | T4 writes `component: Outlet`, T6 swaps to `AppLayout`, guard untouched. T4 flags it. OK                                                                                                                                                            |
| T4       | T5          | `src/components/ui/*` (shadcn)                                        | T4 installs; T5 uses button/card/input/label. All in T4's add list. OK                                                                                                                                                                              |
| T5       | T8          | `emailSchema`                                                         | T5 exports it; T8 imports it for `addMemberSchema`. Exported, not local. OK                                                                                                                                                                         |
| T5       | T6,T8       | `Form`,`FormField`,`FormItem`,`FormLabel`,`FormControl`,`FormMessage` | Same six names at both ends. OK                                                                                                                                                                                                                     |
| T6       | T7,T8       | `src/components/layouts/app-layout.tsx`                               | THREE tasks touch this file in sequence: T6 creates with named slots, T7 fills the bell slot + mounts the stream hook, T8 fills the switcher slot. Sequential, slots are named in T6. OK — flagged so T7/T8 dispatches say "modify, do not rewrite" |
| T8       | T8          | `MEMBERSHIP_ROLES`                                                    | Produced and consumed inside one task. OK                                                                                                                                                                                                           |
| T7       | T7          | `notificationKeys`                                                    | Produced and consumed inside one task. OK                                                                                                                                                                                                           |

### Per-task self-consistency rows

| Task | Finding                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1   | **DEFECT** — Step 15 runs `pnpm test` in an `&&` chain with zero test files. Vitest exits non-zero on "No test files found", breaking the chain. See Ruling 1                                    |
| T2   | Tests reference every action the store defines; file list matches. OK                                                                                                                            |
| T3   | **DEFECT** — Step 11's stated reason for a bottom-of-file import is factually wrong. See Ruling 2                                                                                                |
| T4   | Guard tests exercise `bootstrapSession` only, not the router — matches what the step creates. OK                                                                                                 |
| T5   | Login shown in full; the other five described as same-shape with their own schema/mutation/copy, in the same task, adjacent to the model. Acceptable under the plan's own no-placeholder bar. OK |
| T6   | Files created match files later modified by T7/T8. OK                                                                                                                                            |
| T7   | Tests assert the five documented hook behaviours; hook code implements all five. OK                                                                                                              |
| T8   | Role tests cover all three predicates including the owner-only role-change rule. OK                                                                                                              |
| T9   | Verification commands reference only scripts defined in T1's package.json. OK                                                                                                                    |

### Rulings from the scan

Ruling 1 (T1 Step 15): append `--passWithNoTests` to Task 1's verification
`pnpm test` only. Vitest 5 exits 1 on an empty test set, which would fail the
`&&` chain and make a correct scaffold look broken. Every later task has real
tests, so the flag stays out of `package.json`'s `test` script. Cost if wrong:
none — a scaffold with no tests is the expected state at that one moment.

Ruling 2 (T3 Step 11): `client.ts` → `interceptors.ts` → `session.ts` →
`client.ts` is a genuine import cycle. The plan tells the implementer to put the
import at the bottom of `client.ts` "because a top-of-file import would read
apiClient before it is assigned" — that reasoning is wrong, since ES module
imports are hoisted regardless of where they are written. The cycle is
nonetheless safe: `session.ts` only dereferences `apiClient` inside async
function bodies, never at module scope, so nothing is read during evaluation.
Ruling: keep the structure, move the import to the top with the other imports,
and replace the comment with the correct explanation. Cost if wrong: a runtime
TDZ error on first import, which Task 3's own tests catch immediately.

## Tasks

Task 1: dispatched (model sonnet, base fb9c380) — scaffold; carries Ruling 1 (--passWithNoTests) and the keep-.husky note
Task 1: implementer DONE_WITH_CONCERNS (commit 4bf1da6. lint/typecheck/test/build all exit 0.

Ruling 1 AMENDED — the implementer was right and I was wrong. On pnpm 12.4.1
`pnpm test -- --passWithNoTests` exits 1 (the explicit `--` is forwarded as a
literal token, so Vitest reads the flag as a positional filter);
`pnpm test --passWithNoTests` exits 0. Verified both forms directly. Plan
updated. Cost if wrong: none, verification-command form only.

Ruling 3 — ACCEPT the four Task 1 config deviations. Each verified by me, not
taken on the implementer's word:
(a) React Compiler wiring. `react({ compiler: true })` is the oxc path and
hard-requires `oxc-transform-react`, which the spec never pinned — confirmed
at @vitejs/plugin-react dist/index.js:206. The spec pinned the BABEL path's
two deps while showing the oxc invocation: the dependency table was right,
the code sample was wrong. The implementer's `react()` +
`babel({ presets: [reactCompilerPreset()] })` uses exactly the pinned deps.
Spec and plan corrected in b326a67. Cost if wrong: the compiler silently
does not run; Task 9's build step would still pass, so this is the one
deviation a later task will not catch on its own.
(b) `baseUrl` dropped from tsconfig.app.json — TS 6.0.3 errors on it. Verified
`@/` still resolves by typechecking a probe file that imports through the
alias. Cost if wrong: zero, typecheck catches it.
(c) `tailwindcss/no-custom-classname` off for src/lib/utils.ts only. Verified
the false positive is real by running the rule enabled against that file:
"Classname 'inputs' is not a Tailwind CSS class" at 5:23 — the plugin treats
clsx()'s forwarded rest parameter as a literal class string. Scoped to one
6-line file. Cost if wrong: a genuinely bad classname in that one file goes
unflagged.
(d) pnpm-workspace.yaml approving msw's postinstall — standard pnpm 10+
onlyBuiltDependencies mechanism. Cost if wrong: none.
Task 1: review clean — spec ✅, quality Approved. Reviewer verified all 48 version
pins one by one, confirmed none of the 7 forbidden packages appear, and confirmed
the theme-script localStorage key is 'theme' (Task 2's store must match).

Task 1: resolved the reviewer's "could not fully verify" item myself. Question was
whether the React Compiler actually FIRES, since a misconfiguration passes the build
silently. Built a probe component with memoizable work and diffed the bundle:
5 useMemoCache occurrences without the babel preset, 6 with it. The delta is
compiler-emitted. COMPILER IS ACTIVE. (First attempt at this comparison was invalid
— removing the preset line left its imports unused, tsc failed, and the count came
from a stale dist. Redone with the imports removed too.) Probe files deleted, tree
back to b326a67.

Task 1: minor (deferred): eslint.config.js — `ignores: ['src/components/ui/**']`
scopes only the cssConfigPath/classnames-order block, NOT the earlier
`tailwindcss.configs.recommended` block, so tailwind rules WILL apply to vendored
ui/** once it exists. Zero effect today (the directory does not exist). This comes
from the plan's own Step 12 code, not an implementer deviation. CARRY INTO TASK 4 —
that is the task that creates src/components/ui/.

Task 1: minor (deferred): `@babel/core` is present only transitively via
@rolldown/plugin-babel, which lists it as a direct peer. Builds today. Watch item.

Task 1: accepted explicitly — `"vite/client"` added to tsconfig types (brief said
only vitest/globals). Necessary: without it the CSS side-effect import in main.tsx
raises TS2882. Part of Ruling 3b.

Task 1: complete (commits fb9c380..b326a67, review clean, 2 deferred minors)

Task 2: implementer DONE_WITH_CONCERNS (commit cd03393. 7 tests pass, lint+typecheck clean.

Ruling 4 — plan/spec contradiction on `ApiErrorBody.errors`, surfaced by the
implementer. Plan's code said `Record<string, string[]>`, spec §3 said `unknown`,
and the brief's Interfaces line repeated the spec. RULED: `Record<string, string[]>`
stands, spec corrected. Evidence: parseBody (auth.validators.ts:175) builds the
payload as `{...fieldErrors, ...(formErrors.length > 0 && {formErrors})}` from
z.flattenError — always field-name -> string[]. The spec's `unknown` mirrored the
backend's errorResponse PARAMETER type, not what it actually sends.
CARRY INTO TASK 5: `formErrors` is a reserved key holding schema-level issues that
name no field; a form must render it as a form-level message, never attach it to a
field named "formErrors". Cost if wrong: Task 5's fieldErrorsFrom needs a cast, and
strict-schema rejections render as an orphan field error.

Task 2: accepted — implementer ran `eslint --fix` on theme.store.test.ts, removing a
redundant `as unknown as typeof window.matchMedia` cast the brief specified that
@typescript-eslint/no-unnecessary-type-assertion flagged. Behaviour identical.
Task 2: review clean — spec ✅, quality Approved, zero findings. Reviewer independently
confirmed the theme key matches index.html:11, readStoredTheme() cannot throw at import
time (fully try/catch wrapped, returns 'system'), and the logout/isBootstrapped test is a
genuine behavioural assertion that would fail if logout() cleared the flag.

Task 2: minor (deferred): no matchMedia change listener, so with theme='system' an OS
light->dark switch while the app is open does not update the <html> class until reload.
Correctly out of scope for Task 2 (no step or test calls for it). CARRY INTO TASK 6 —
that task builds the theme toggle and is where the listener belongs.

Task 2: complete (commits eca2a9b..cd03393, review clean, 1 deferred minor)

Task 3: implementer DONE_WITH_CONCERNS (commit a305197, model opus).
20 tests pass across 4 files. Both invariant tests confirmed passing: ONE refresh for N
concurrent callers (count=1 for 3), and a NEW refresh allowed after the previous settled
(count=2). No TDZ error — Ruling 2's reading of the import cycle was correct.

Ruling 5 — ACCEPT both unauthorised deviations. Each is a real defect in the PLAN's code
that the plan's own tests could not catch, because every one of them starts with
accessToken: null. I verified the first myself rather than trusting the report: reverted
the guard, and `does not deadlock when a stale token is still in the store` fails with
"Test timed out in 5000ms" — a hang, not an error, exactly as reported.
(a) Request interceptor overwrote the explicit Authorization that refreshSession() puts
on its /profile call. /profile then went out with the STALE token -> 401
ACCESS_TOKEN_EXPIRED -> interceptor -> ensureSession() -> awaits the promise that is
awaiting /profile. Permanent self-wait. Fix: `!config.headers.has('Authorization')`.
Cost if wrong: an explicit header elsewhere silently bypasses the store's token.
(b) The replay `client.request(config)` sat inside the refresh try/catch, so a 404/500/
second-401 FROM THE REPLAY was treated as a failed refresh and hard-navigated a
still-valid session to /login. Fix: replay moved outside the catch.
Cost if wrong: a failed refresh would not redirect — but test 12 pins that direction.
Plan and spec both corrected in 62e131b.

Ruling 6 — the implementer asked whether /auth/refresh can itself 401 with
ACCESS_TOKEN_EXPIRED, which would reopen the self-wait on a request that has no explicit
header to protect it. Answered from the backend, not by reasoning: auth.routes.ts has NO
requireAuth anywhere on the router, and ACCESS_TOKEN_EXPIRED does not appear in
auth.controller.ts at all. refresh() reads the httpOnly cookie only. So that path cannot
produce the code, and the deadlock class is closed. Cost if wrong: a hang on refresh with
no timeout to break it.

Task 3: minor (deferred): apiClient sets no axios `timeout`, so any future unbounded hang
stays unbounded. Ruling: NOT adding one now — the one known deadlock path is closed
(Ruling 6), and it is beyond the brief. Flagged for the final review to triage as
defence-in-depth. Suggested value if taken: timeout: 30_000.

Task 3: review — spec ✅, quality NEEDS WORK. 2 Important, 4 Minor. Reviewer verified
the concurrency tests are NON-VACUOUS by mutation: removing the inFlight dedupe fails
both "ONE refresh for N callers" tests with "expected 3 to be 1". Also established there
is no settled-promise window — .finally()'s callback runs strictly before the outer
promise settles, so a caller can never attach to an already-settled inFlight.

Ruling 6 AMENDED — I was too narrow. I closed the /auth/refresh path, not the self-wait
CLASS. /profile IS behind requireAuth (profile.routes.ts:17 `router.use(requireAuth)`)
and auth.middleware.ts:140 throws ACCESS_TOKEN_EXPIRED. So if the FRESH token is rejected
as expired — clock skew, a near-zero TTL, a key-rotation race — refreshSession's own
/profile call 401s, the response interceptor fires, calls ensureSession(), and awaits the
promise awaiting /profile. Reviewer reproduced it: hangs forever, no rejection, no logout.
Verified both backend facts myself. Entering the fix loop.

Task 3: fix round 1/5 dispatched — resuming implementer the implementer.

Task 3: fix round 1/5 — implementer reports all 6 addressed (commit 2c52e12), 25 tests
pass. Scoped re-review dispatched with instructions to
independently mutation-test both Importants rather than read the report.

CONTROLLER ERROR + RECOVERY (mine, not a subagent's): I ran `git add -A` to commit a
docs change WHILE the re-reviewer was mutation-testing src/http/session.ts. It had
removed `skipAuthRetry: true` from the /profile call to prove the new test bites, and my
commit (87b9a5f) captured that removal — HEAD briefly contained the very deadlock the
round had just closed. Caught it by reading the commit's own --stat. Recovered with
reset --soft + unstaging session.ts; the corrected commit is 61da5e1 and touches only the
spec. session.ts verified back to 2 occurrences of skipAuthRetry: true, suite green at 25.
The sharpest edge was not the bad commit itself: a reviewer asked to confirm "tree clean"
would have seen session.ts as MODIFIED and could have "restored" it to my broken commit.
RULE FOR THE REST OF THIS RUN: never `git add -A` while a subagent is live. Stage explicit
paths only, and only paths no running agent touches.

Task 3: re-review — ALL SIX ADDRESSED, no new breakage, tree clean. The re-reviewer
independently mutation-tested both Importants rather than reading the report:

- reverting .finally -> .then failed the new reject-half test with
  "promise rejected ... instead of resolving"
- removing skipAuthRetry from /profile alone failed its test with
  "Test timed out in 2000ms" — a real hang, red in 2s rather than a wedge
  Also confirmed the retry cap still caps at one (the _retried own-property survives
  axios's mergeConfig on replay) and that skipAuthRetry does not disable retry for
  ordinary app requests.

NOTE on the re-reviewer's "background auto-commit hook" observation: that was not a hook.
It was my reset --soft + recommit recovering the git add -A error above. Its final state
assessment was correct; only its explanation was wrong.

Task 3: minor (deferred): src/states/theme.store.test.ts fails `prettier --check`
(from Task 2). More importantly `pnpm lint` does NOT check formatting, so Task 9's CI as
planned would never catch format drift at all. CARRY INTO TASK 9: add a `format:check`
script and a CI step, and run prettier --write once to clear the existing failure.

Task 3: complete (commits 2d0c48d..2c52e12 + fix round, review clean after 1 fix round,
3 deferred minors: no axios timeout, resetSessionForTests in prod bundle, prettier/CI gap)

--- User-directed additions after Task 3 (2026-09-22) ---

User asked for: (1) formatting checked by lint, (2) rejectMalformedJsonResponse from
Consequential, (3) lint enforcement of filename / structure / file placement / test files.
Also asked how Consequential and Ofluence do auth+refresh.

Reference-repo comparison (Consequential/pulse, Ofluence/pulse — both read directly):
 - Both use axios interceptors. Our single-flight is the IDENTICAL
   `promise ??= perform().finally(() => { promise = undefined })` pattern, arrived at
   independently. Convergent validation.
 - OURS IS BETTER on retry exclusion: they exclude the refresh call by URL string
   (`!url.includes('/auth/refresh')`). That is complete only because THEIR /auth/refresh
   returns the user. Ours does not, so we make a /profile call a URL check would miss —
   the exact deadlock the Task 3 review caught. Our structural skipAuthRetry covers both.
 - OURS IS SAFER on retries: they allow MAX_RETRIES=2, we allow 1.
 - They also handle ACCESS_TOKEN_INVALID. Verified our backend does NOT emit a code for an
   invalid (non-expired) token — auth.middleware.ts:142 throws a bare 401. So handling only
   ACCESS_TOKEN_EXPIRED is correct HERE. Backend difference, not a design gap.
 - THEIRS IS BETTER on redirect: both preserve the caller's location as ?redirect= through
   a forced logout. Ours sets it in the _app guard and nothing consumes it; the interceptor
   dropped it entirely. Adopted into the plan for Tasks 4 and 5 (b28d2ef), with a note to
   validate same-origin — that param is an open-redirect vector.

Change: `pnpm lint` now runs eslint AND prettier --check (9603802). It previously ran
eslint only, so format drift could never fail CI — this also closes the Task 9 carry-over.
docs/ is prettier-ignored: prettier reflows the spec's tables into ~500 lines of cosmetic
churn on documents the user has already reviewed. Clearing the one pre-existing failure
revealed it was a broken indent carried in from my own plan text.

Task 3b: dispatched (model sonnet, base b28d2ef — brief at
task-3b-brief.md. Part 1 rejectMalformedJsonResponse; Part 2 eslint-plugin-check-file
3.3.2 + @tanstack/eslint-plugin-router 1.162.0 enforcing filename convention, folder
naming, file PLACEMENT (folder-match-with-fex) and test-file naming (.test. not .spec.,
no __tests__ tree). src/pages/** exempt throughout — TanStack Router requires __root.tsx,
_auth.tsx, $slug.members.tsx, all of which violate kebab-case by design.

Task 3b: implementer DONE (commits 7c11db2 + 12b46e1. 29 tests.
All three lint rules proven to fire against planted files; guard tests proven load-bearing
two ways (unregistering fails 1-2 only; breaking the carve-outs fails 3-4 only).
I independently confirmed the src/pages exemption: planted __root.tsx and $slug.members.tsx
alongside a control src/components/BadName.tsx — only the control was flagged.

Task 3b: review — spec ✅, quality Approved, 1 Important + 1 Minor.

Ruling 7 — the Important is REAL and I am fixing it, not parking it. The implementer
flagged that its suffix block replaces the KEBAB_CASE block for suffixed dirs and judged
it "harmless, same charset". Half right. The reviewer read the plugin's own KEBAB_CASE
body out of node_modules — `+([a-z])*([a-z0-9])*(-+([a-z0-9]))` — which forbids a leading
digit, a leading/trailing hyphen and a double hyphen. `+([a-z0-9-])` allows all four.
Proven by planting 123.store.ts, -auth.store.ts, auth-.store.ts, au--th.store.ts in
src/states and getting eslint exit 0. So the rules the user asked for were silently
weaker than they read. Fix: build each suffix pattern from the plugin's KEBAB_CASE body
instead of a bare charset class. Cost if wrong: existing files trip and need renaming —
which is why the fix message names auth.store.ts / theme.store.ts / sidebar.store.ts /
api.types.ts as the live cases that must still pass.

Ruling 8 — also narrowing the test-file exemption from `**/*.test.{ts,tsx}` to
`src/{states,queries,schemas,types,hooks}/**/*.test.{ts,tsx}`. The brief asked for the
global form, so this is my error not the implementer's: it exempts every test file
everywhere from kebab-case when it only needed to cover the suffix-dir collision
(auth.store.test.ts failing the `.store` pattern). Reviewer confirmed src/lib/BadName.test.ts
currently passes. Cost if wrong: src/http tests are not in a suffix dir, so they keep plain
kebab — flagged in the fix message to verify.

Reviewer also confirmed empirically, so these are closed: the guard DOES see silent-refresh
replayed responses (wrote a throwaway test that 401s, refreshes, and returns malformed HTML
on the replay — rejected with ERR_MALFORMED_RESPONSE); the guard cannot reject a legitimate
refresh response; `*.store.ts` does not glob-match `auth.store.test.ts` so co-located tests
are safe; and the .prettierignore addition is correct rather than a cover-up.

Task 3b: fix round 1/5 dispatched — resuming the implementer.
Task 3b: fix round 1/5 — both ADDRESSED. Verified by ME directly before the re-review:
all four malformed names rejected with the tightened pattern, good-name.store.ts still
passes (the false-positive check that mattered most), src/lib/BadName.test.ts now caught,
existing files pass with zero renames, 29 tests. Scoped re-review independently confirmed
the same and reported a clean tree.
Task 3b: complete (commits b28d2ef..059a438, review clean after 1 fix round)

Task 4: implementer returned NEEDS_CONTEXT at Step 1 — correctly, before writing anything.
Tree clean, nothing installed. It found a plan defect it could not resolve by guessing.

Ruling 9 — LIFT the unified-radix-ui ban. My spec was wrong and I verified why myself.
I originally checked ui.shadcn.com/r/styles/new-york/{button,sidebar}.json, saw
@radix-ui/react-slot, and generalised. new-york is the LEGACY Tailwind v3 generation.
Confirmed by fetching both: new-york/dialog.json emits
`import * as DialogPrimitive from "@radix-ui/react-dialog"`, radix-nova/dialog.json emits
`import { Dialog as DialogPrimitive } from "radix-ui"`. This repo is Tailwind 4 with
@theme inline, so new-york is the wrong generation and the ban was unsatisfiable.
radix-ui@1.6.7 peers accept React 19. The alternative — rewriting ~20 vendored files'
imports — is a patch every future `shadcn add` reintroduces, which destroys the
vendored/re-addable property Task 3b's ui/** lint exclusion depends on.
Cost if wrong: a slightly larger bundle if tree-shaking underperforms.

Ruling 10 — shadcn style is `radix-nova`. Verified it carries both sidebar and breadcrumb
(the two the AppLayout needs). radix-* = Radix primitives, base-* = Base UI, aria-* =
React Aria; Phase B's StyleSeed primitives are Radix + CVA, so radix-* keeps both phases
on one primitive library. Cost if wrong: a different visual default, re-addable.

Ruling 11 — globals.css must gain the missing tokens. VERIFIED the gap myself: --popover,
--accent, --sidebar-primary, --sidebar-accent, --sidebar-ring and --chart-1..5 are all
absent, and tw-animate-css is not imported. This is a real Task 1 defect, not a nit —
Tailwind 4 silently DROPS unknown utilities, so lint and build pass while styling is
quietly incomplete, and the brief's own Sonner component references var(--popover).
Cost if wrong: none; adding tokens is additive.

Ruling 12 — add `src/components/ui/` to .prettierignore. shadcn emits semicolons and
double quotes, which `prettier --check` (added at the user's request) now fails on. eslint
already excludes that directory as vendored; prettier must match or every re-add churns.
Cost if wrong: vendored files stay unformatted, which is the intent.

Ruling 13 — build order. `pnpm build` is `tsc -b && vite build`, but routeTree.gen.ts is
generated by the VITE half, so tsc runs first against a file that does not exist yet.
Bootstrap it once with `pnpm exec vite build`, commit it (the plan already says to), and
the normal chain works thereafter. Cost if wrong: a one-off build failure, loud not silent.

Task 4: re-dispatching with all five rulings carried.

Task 4: implementer DONE_WITH_CONCERNS after the Base UI switch (commits 96f9347,
b6e733a, d4417a9). 32 tests (29 + 3 guard tests). src/pages ENOENT gone. / -> /login
verified in a real browser. Only package pulled is @base-ui/react@1.8.0; radix-ui
uninstalled, no mixed tree. Rulings 11 (globals.css tokens) and 3 executed — I verified
--popover, --accent, --sidebar-primary and --chart-1 are now present.

Ruling 14 — CONSOLIDATE on the npm `cn` package; `@/lib/utils` re-exports it.
All 20 vendored components import from "cn"; our src/lib/utils.ts had its own
clsx+twMerge implementation. Two class mergers can resolve conflicting Tailwind classes
differently, so this is a correctness risk, not tidiness. `cn@0.3.0` is shadcn's OWN
package (github.com/shadcn-ui/cn), described as a drop-in replacement for clsx +
tailwind-merge — verified on npm. src/lib/utils.ts is the ONLY file still importing
clsx/tailwind-merge, so the swap is contained. Side benefit: Task 1's eslint override
disabling no-custom-classname for src/lib/utils.ts becomes unnecessary — the false
positive was on the `clsx(inputs)` call, which disappears with a re-export.
Cost if wrong: cn@0.3.0 is 0.x; if it diverges from twMerge we inherit that. Mitigated
by the fact that the 20 vendored files depend on it regardless — we cannot avoid it.

Ruling 15 — move `shadcn` from dependencies to devDependencies. globals.css imports
shadcn/tailwind.css, but Vite inlines that at build time; the runtime bundle never needs
the CLI. The Dockerfile installs all deps before building, so the build still resolves it.
Cost if wrong: a production-only install would fail the CSS import — caught loudly at
build, not silently.

Ruling 16 — KEEP the Geist webfont, the .dark --primary change (0.985 -> 0.922) and
`html { @apply font-sans }`. These are the nova style's coherent defaults. The font is
@fontsource-variable/geist, self-hosted (no third-party request) and subset by charset —
dist carries 4 woff2 files of 7-17 kB each and browsers fetch only the subsets a page
actually uses via unicode-range. Phase B's ss-setup owns typography and will re-skin it.
Cost if wrong: ~20 kB of latin subset on a base meant to be neutral; removable in one line.

Ruling 17 — silence the 5 react-refresh warnings by exemption, not by editing code.
4 are in vendored src/components/ui/** (badge, button, sidebar, tabs); that directory is
already excluded from the tailwind rules as vendored and should be excluded here too.
The 5th is src/pages/__root.tsx, where exporting both `Route` and a component from one
file IS the TanStack Router file-route pattern — a false positive for every route file,
so exempt src/pages/** too.

Task 4: CARRY INTO TASK 6 — Base UI's Tooltip emits NO role="tooltip" and NO
aria-describedby (Base UI treats tooltips as decorative, unlike Radix). Every icon-only
control therefore needs its own aria-label or sr-only text or axe `button-name` fails.
The theme toggle and user menu are the named risk.

Task 4: CARRY INTO TASK 9 — a Base UI Dialog with no Title has aria-labelledby: null and,
unlike Radix, emits NO dev warning. Silent until axe. The axe gate must cover an
OPEN dialog and an OPEN sheet, not just each page's default state.

Task 4: fix round 1/5 dispatched — resuming the implementer.

Task 4: review — spec ✅, quality Approved, 2 Important + 3 Minor. Reviewer ran the
guards end-to-end through a real RouterProvider and confirmed signed-out /dashboard ->
/login?redirect=%2Fdashboard with the param present, signed-in /login -> /dashboard, and
isBootstrapped true in every case. Also scanned the LOCKFILE (not just node_modules):
zero hits for radix, react-hook-form, next-themes, tailwind-merge, zod-form-adapter.
clsx survives only as a transitive of cva and the devtools, not top-level-resolvable.

MUTATION TEST PASSED: moving setBootstrapped() out of `finally` into the success branch
failed `settles as signed-out when there is no valid cookie` with "expected false to be
true". The infinite-spinner regression IS caught.

Ruling 18 — Important 1 was MINE and is fixed (dc0e2a3 follow-up commit): the spec's
runtime dependency table still listed clsx and tailwind-merge after fix round be45a5a
removed them, and never gained cn / tw-animate-css / @fontsource-variable/geist. Task 5
reads this spec, so a pnpm add from it would have reintroduced a banned package.
Regenerated the table FROM package.json and said so in the doc, so the next drift is
visible. Cost if wrong: none, it now matches the manifest exactly.

Task 4: fix round 2/5 dispatched for the remaining findings.
Task 4: fix round 2/5 — all three addressed (commit fbad526). 35 tests (32 -> 35),
lint 0 errors 0 warnings under --max-warnings 0.

The implementer found and fixed a real bug in its OWN first attempt, by testing rather
than assuming: `.prettierignore` with `src/components/ui/` excludes the DIRECTORY, and
gitignore syntax cannot re-include a file whose parent directory is excluded — so the `!`
negations were silently doing nothing. Changed to `src/components/ui/*`. I verified both
directions myself: planting a formatting error in our sonner.tsx is CAUGHT, the same error
in vendored button.tsx is IGNORED. That is exactly the intended split.

It also mutation-tested the property the whole task exists for, unprompted: changing
__root's beforeLoad to `void bootstrapSession()` (the useEffect-equivalent bug) fails two
of three guard tests. The new tests use DELAYED refresh handlers, which is what makes them
load-bearing rather than accidentally passing.

The eslint carve-out earned itself immediately — caught `Classname 'toaster' is not a
Tailwind CSS class` in our sonner.tsx. `toaster` is sonner's own stylesheet hook, so it
was whitelisted via the rule's whitelist option rather than the rule being disabled.

Ruling 19 — CARRY INTO TASK 5, now in the plan: useFormField must live in
src/hooks/use-form-field.ts, not form.tsx. Because Task 4 carved form.tsx out of the
vendored exclusion, react-refresh/only-export-components is live on it, and a hook
exported beside components breaks the 0-warnings gate the moment the file lands. form.tsx
imports it and must NOT re-export (a re-export trips the same rule). Filename satisfies
the src/hooks/** -> use-<kebab>.ts rule. Cost if wrong: one more import line.
Task 4: fix round 2 re-review — ALL THREE ADDRESSED, no new breakage, tree clean.
Re-reviewer independently reproduced both mutations: dropping the search param gives
"expected {} to deeply equal { redirect: '/dashboard' }"; dropping the await on
bootstrapSession gives "expected '/login' to be '/dashboard'" AND "expected false to be
true". Confirmed the prettier carve-out catches sonner.tsx and ignores button.tsx.
Confirmed the `toaster` whitelist is narrowly scoped (two named files, rule stays at
'warn', not disabled) and introduces no blanket-allow.

Task 4: complete (commits 059a438..fbad526, review clean after 2 fix rounds, 35 tests)

Task 5: implementer DONE_WITH_CONCERNS (commit 05207af.
53 tests (35 -> 53), lint 0/0, typecheck + build clean. Open-redirect rejection is well
tested: 2 integration cases (https://evil.example and //evil.example both land on
/dashboard) plus a unit test over 6 rejection shapes, and a DISCRIMINATING happy path
(?redirect=/dashboard?next=1 asserts next=1 survives).

Task 5 caught a LATENT bug from Task 4 that I verified myself: sonner calls
window.matchMedia UNGUARDED at sonner/dist/index.mjs:1072 (1005 and 1063 are guarded,
1072 is not). __root renders <Toaster> on every route, so ANY test mounting the real
route tree was silently rendering sonner's error boundary instead of the page. Latent
since Task 4 and it would have blocked Task 9's axe pass with a failure pointing at the
wrong thing entirely. Fixed with a permissive stub in src/tests/setup.ts.

Ruling 20 — IMPLEMENT field-level error mapping; it is not optional. The implementer
correctly noted no page renders formErrors or maps fieldErrorsFrom onto inputs, because
the brief's Step 8 only prescribed toasting messageFrom. But spec §9 requires "Inline
errors under each field, mapped from the envelope's errors" — so this is a gap in MY
brief, not a scope question. The implementer was right not to smuggle in a clearing rule
unilaterally. CLEARING RULE, decided once for all forms: a server-injected error on a
field clears when that field next changes; formErrors renders as a form-level alert above
the submit button. Deciding it now means Tasks 6 and 8 inherit a working pattern instead
of each inventing one. Cost if wrong: the rule is in one place (form.tsx) and changeable.

Ruling 21 — reset-password and verify-email must ESCAPE the _auth guard, and their paths
MUST NOT CHANGE. The implementer flagged that _auth redirects authenticated visitors to
/dashboard, so a signed-in user clicking an emailed reset or verify link is bounced and
the token is never consumed. Real flow: signed in on desktop, request a reset, click the
link in the same browser, nothing happens. I checked what the backend actually emails:
verification-link.utilities.ts builds `${WEB_URL}/verify-email?token=` and
`${WEB_URL}/reset-password?token=` — TOP-LEVEL paths with no /auth/ prefix. So moving
them to /auth/* (the tidy-looking fix) would break every link already in every inbox.
Fix instead by moving the FILES to src/pages/verify-email.tsx and
src/pages/reset-password.tsx — top-level file routes produce the identical URLs and sit
outside _auth entirely. Each renders AuthLayout itself. Cost if wrong: minor duplication
of one wrapper element per page.

Task 5: fix round 1/5 dispatched — resuming the implementer.

Task 5: review — spec ✅, quality Approved, 2 Important + 3 Minor. Reviewer verified
constraints by INTERCEPTING REQUEST BODIES, not by reading: confirmed confirmPassword is
not on the wire and verify-email sends both fields. Killed both field-clearing mutants
(clear-everything, and deleting FormControl's name injection) — the clearing rule is
genuinely covered. Upheld the forgot-password enumeration reasoning after checking every
other channel: no toast on that page, no global error toast in interceptors, no
MutationCache/QueryCache onError in router.tsx, identical await/branch/timing.

Ruling 22 — FIX safeRedirect properly. The regex /^\/(?![/\\])/ accepts SEVEN inputs the
URL standard resolves OFF-ORIGIN: /\t/evil.example, /\n/…, /\r/… and /\t\evil.example
(the URL parser strips ASCII tab/LF/CR, leaving //), plus /..//evil.example,
/.//evil.example and /a/../..//evil.example (dot-segment collapse). All reachable from a
URL bar as %09, %0A, %0D, ..%2F%2F. Today nothing escapes, but ONLY because TanStack
normalises to /evil.example before pushState — the guard is not what saves us. useLogout
already uses window.location.assign; the first caller that does that with a redirect
target turns this into a live open redirect. Parse, do not pattern-match:
new URL(value, location.origin), compare origin, return pathname+search+hash. The
integration test for //evil.example would pass against a broken guard too (it only
asserts href lacks evil.example, which the normaliser guarantees) — the real coverage is
the unit table, so that is what must grow. Cost if wrong: none; URL parsing is strictly
stronger than the regex.

Ruling 23 — the review CORRECTED a false premise in MY brief. I told the implementer the
backend rejects unrecognised keys, so reset-password must strip confirmPassword. It does
not: resetPasswordSchema is a plain z.object() and auth.validators.ts states no schema
uses .strict(), so an extra key would be STRIPPED, not rejected. Stripping client-side is
still correct and forward-safe, so the implementation stands — but the spec must not keep
asserting a backend behaviour that is not true.

Task 5: CARRY INTO TASK 6/8 — FormControl's `id` lands on a Base UI Checkbox's HIDDEN
input, not the visible role="checkbox" element, so FormLabel htmlFor would point at a
visually hidden control. Also unverified: whether a Base UI Checkbox/Select change event
bubbles to <Form> carrying target.name, which the clearing rule depends on. No checkbox
or select is wired to a form yet; the first one that is must test both.
Task 5: fix round 2 — all six addressed (commit 2d4168c). 85 tests (60 -> 85), lint 0/0.

Ruling 22 CORRECTED — MY PRESCRIBED FIX WAS WRONG AND THE IMPLEMENTER CAUGHT IT.
I told it to use `new URL(value, origin)` and return pathname+search+hash when the origins
match. I verified the counter-claim myself in node before accepting it:

  new URL("/..//evil.example", "https://app.test").origin   -> "https://app.test"  (PASSES)
  its pathname                                              -> "//evil.example"

The dot segments collapse INSIDE the path, so the origin check passes and my snippet would
have RETURNED "//evil.example" — protocol-relative, an open redirect the moment it reaches
location.assign. Same for /.//evil.example and /a/../..//evil.example. Three of the seven
bypasses I sent it to fix would have survived my own fix.

The shipped version re-checks the RETURNED STRING, not just the parsed origin:
  return path.startsWith('/') && !path.startsWith('//') ? path : null
and keeps a `startsWith('/')` precondition because the parser alone accepts a bare
"dashboard". That is not a regression to pattern-matching — the parser still decides
everything among slash-prefixed inputs. All seven bypasses now rejected as UNIT cases.

Lesson recorded: I twice reached for a plausible-looking guard (regex, then origin-check)
without running it against the payloads. The implementer ran it. Verify security controls
empirically before prescribing them, including my own corrections.

Task 5: the implementer also found, unprompted, that a CONDITIONAL name injection in
FormControl fails — `<Input name={undefined} />` still carries the key and useRender lets
undefined override the injected name, silently killing the clearing rule. Same class as
the reviewer's name="explicit" mutant, different disguise. Clones unconditionally now.

Task 5: minor (deferred): no wire-level timeout test is possible — MSW's XHR interceptor
proxies ontimeout without ever firing it (a 20ms-timeout request resolved at 234ms). The
two committed tests pin the 30s default and its propagation onto each request config,
which is what the adapter reads. Documented in the test comment.
Task 5: fix round 2 re-review — ALL SIX ADDRESSED, no new breakage, tree clean.
Re-reviewer attacked the SHIPPED guard fresh (not confirming my reasoning) with 57 inputs
under jsdom/whatwg-url plus 18 Node/Ada extras. ZERO leaks; the two parsers agree on all
57 shared inputs. It also gave the structural reason it holds rather than just the result:
for a special-scheme URL, pathname is never empty and always starts with '/', so search or
hash can never lead the reassembled string — only a '//' pathname can, which is exactly
the explicit check. Included a 200 kB input and /../ x5000.

Every mutation killed: the dev-warning detector, the conditional FormControl clone (2
failures — the implementer's undefined-name claim VERIFIED), render:children (3), and
schema-parse-before-post ("expected { email: 'ADA@B.COM' } to deeply equal
{ email: 'ada@b.com' }"). Confirmed the dev warning strings are absent from dist/.

Three honest limitations the re-reviewer surfaced rather than glossed, all accepted:
 - The "  ADA@B.COM  " integration test discriminates on CASE ONLY — jsdom's type="email"
   sanitisation strips the padding before form state. .trim() on the wire is carried by the
   schema unit test, not the integration one.
 - The timeout tests are CONFIGURATION pins, not behaviour. A wire timeout genuinely cannot
   fire under MSW's XHR interceptor (reproduced: 20ms timeout resolved at 337ms). Refusing
   to fake one was right; the honest ceiling of this harness.
 - safeRedirect's output reaches only navigate({ href }) today — both location.assign calls
   take ROUTES.login — so the protocol-relative hazard is future-consumer, not live. The
   guard is still right to be strict.

Task 5: complete (commits 42c10f9..2d4168c, review clean after 2 fix rounds, 85 tests)

Task 6: implementer DONE (commits e85c35a, 0dc1644. 105 tests
(85 -> 105), lint 0/0, typecheck + build clean.

Ruling 24 — ACCEPT the nested-<main> deviation; MY BRIEF WAS WRONG. I prescribed
`<main>` around the Outlet inside SidebarInset. Verified myself: SidebarInset is typed
React.ComponentProps<"main"> and renders <main> (src/components/ui/sidebar.tsx:303), so
following my brief would have produced TWO main landmarks and failed Task 9's axe gate on
landmark-unique. Page content goes in a plain div. Cost if wrong: none.

Ruling 25 — ACCEPT ThemeToggle as a SIBLING of UserMenu in SidebarFooter rather than an
item inside the dropdown. The implementer's reasoning is the kind I want: inside a
dropdown the component unmounts when the menu closes, taking its matchMedia listener with
it — so theme:'system' would only follow the OS while the menu happened to be open. That
defeats carry-over item 2 entirely. Cost if wrong: a slightly different footer layout.

Task 6: CARRY INTO TASK 9 — axe's `region` rule will flag SidebarHeader/SidebarFooter
contents, which sit inside no landmark. Task 9 must decide to satisfy it (wrap in a
<nav>/<aside>) or disable that one rule with a stated reason. Do not let it be discovered
as a mystery failure.

Task 6: carry-over item 3 (Base UI Checkbox id-on-hidden-input, and whether its change
event bubbles carrying target.name) deliberately NOT exercised — no Checkbox or Select is
wired to a form anywhere yet. Correct call. STILL UNVERIFIED for Task 8, which has role
selects in the member table.

Task 6: review — spec ✅, quality NEEDS WORK. 2 Important + 2 Minor. Reviewer verified
every constraint by RENDERING and INTERCEPTING, not reading: PATCH body is exactly
{"firstName":"Ada","lastName":"B"}; profile has exactly 2 inputs and nothing matching
/password/i or /provider/i; one <main>; one H1 per page; nav is <a href> inside
nav[aria-label="Main"]. Confirmed all three accessible names, exact-match, and that the
sidebar trigger has ONE name (aria-label overrides the vendored sr-only text, nothing
concatenated). Killed both matchMedia mutants.

Ruling 25 AMENDED — my acceptance was right in reasoning and wrong in fact. I accepted
ThemeToggle-as-sibling because it is "mounted for the whole authenticated session". That
is FALSE below md: Sidebar renders into Sheet -> Base UI Dialog.Popup with no keepMounted
(src/components/ui/sheet.tsx:47), so the entire sidebar unmounts when the drawer closes.
Reviewer probed at innerWidth 500: themeToggle=false, accountMenu=false, mainNav=false.
So theme:'system' follows the OS on desktop only. index.html covers initial paint, so it
is a live-change gap not a boot gap. Fix: hoist the effect out of ThemeToggle into
AppLayout. Cost if wrong: the listener lives one level up from its control, which is why
it needs a comment saying why.

Ruling 26 — CARRY INTO TASK 7, and it follows directly from F1: the SSE hook is SAFE in
the header slot and UNSAFE in the sidebar footer. Anything mounted inside Sidebar
unmounts on mobile when the drawer closes, so an SSE connection placed there would be
silently dead on phones — live on desktop, absent on mobile, with nothing in any log.

Ruling 27 — Task 6's own report Concern 1 is EMPIRICALLY WRONG and my ledger recorded it
as fact. I wrote that axe's `region` rule "will flag SidebarHeader/SidebarFooter". The
reviewer ran axe: 0 violations, 1 pass, on both /dashboard and /profile, and proved the
rule genuinely ran (a stray <p> on body IS flagged). They pass because all their content
sits inside button/a widgets, which axe's region check skips. CORRECTED GUIDANCE FOR
TASK 9: assert toHaveNoViolations() with jest-axe defaults — it passes today. Do NOT
disable the region rule. CARRY INTO TASK 8: a stray <p> inside SidebarHeader DOES trip it,
so the TenantSwitcher must keep its text inside its trigger button.

Task 6: CARRY INTO TASK 8 (F3) — useBreadcrumbs matches crumb.to === match.pathname on
literal paths (app-layout.tsx:56-77). /tenants/$slug resolves to /tenants/acme and matches
nothing, and there is no /tenants ancestor match. Task 8 can append the list-page crumb
but must CHANGE the lookup (routeId or staticData.crumb) for detail pages.

Task 6: fix round 1/5 dispatched.
Task 6: fix round 1 re-review — BOTH ADDRESSED, no new breakage, tree clean. Mutation on
the hoisted effect failed 3 tests including "follows a live OS change on a phone, where
the sidebar is unmounted". Confirmed the mobile test asserts its own premise (theme toggle
absent at innerWidth 500) before proving the listener works. Confirmed appending a Tenants
nav item no longer breaks the dashboard test. Upheld behaviour-over-listener-count:
theme.store, AppLayout and sonner's Toaster all subscribe to the same media query, so a
raw count is >=2 and not attributable to AppLayout. Verified setTheme is referentially
stable (defined once in create<ThemeState>, never replaced via set), so [theme, setTheme]
cannot re-subscribe per render.

Task 6: complete (commits 2d4168c..78746a8, review clean after 1 fix round, 106 tests)

Ruling 28 — THREE ERRORS IN MY PLAN'S TASK 7 CODE, found by reading the backend before
dispatching rather than after. The plan told the implementer to check, but the plan's own
code would have been copied first:
 (a) FATAL: the SSE frame is `event: notification` (notification-stream.controller.ts:121),
     a NAMED event. `source.onmessage` — which my plan's hook uses — only fires for
     UNNAMED events, so the handler would never run and notifications would silently never
     arrive. Must be addEventListener('notification', handler).
 (b) The list endpoint returns `{ notifications, nextCursor? }` (notification.repository.ts:134),
     not `{ items, nextCursor }`. And nextCursor is OMITTED when absent, not null —
     the repo builds it conditionally for exactOptionalPropertyTypes.
 (c) `body` is `text().notNull()` on the model, not nullable as my plan typed it.
Also: the server sends `retry: 3000` and `:ping` heartbeats; the SSE payload is a 6-field
subset (id, type, title, body, readAt|null, createdAt), narrower than a list row.
Cost if wrong: (a) alone would have shipped a notification system that never delivers.

Ruling 29 — automated security review flagged the access token in the SSE URL
(src/hooks/use-notifications.ts, MEDIUM, "Secrets/PII in URLs"). PARTIALLY ACTIONED, not
dismissed. The finding is correct in principle; the suggested fix is not available in
Phase A.

Verified the constraint is the BACKEND's, not our choice: notification.routes.ts' own
header comment states requireAuth reads only a Bearer header, EventSource cannot set one,
so /stream authenticates from ?token= itself. The reviewer's suggested fix — a single-use
short-TTL stream ticket issued by POST — is a change to express-boilerplate, the same
category as CORS and change-password, both already recorded as out of Phase A scope.

What genuinely reduces exposure and IS ours: nginx's default access-log format records
the full request line, so a live 15-minute access token would be written to access.log on
every connect AND every reconnect — and our own hook reconnects on backoff, so a flapping
connection multiplies that. Added a `stream_nolog` log_format that logs $uri instead of
$request, applied to the SSE location only (4b77b6b). That removes the largest and most
persistent copy.

Residual, recorded in the spec's out-of-scope list rather than left implicit: browser
history and devtools still see it. Mitigating factors that are real: the URL is
same-origin so it never leaves via Referer to a third party, and ACCESS_TOKEN_TTL is 15m.

NOT done: I did not touch src/hooks/use-notifications.ts — Task 7's implementer is live in
that file right now. Nothing in the fix needed to.

Task 7: implementer DONE_WITH_CONCERNS (commits 02ffaaf, 4e25bd1). 121 tests (106 -> 121),
lint 0/0. Named-event fix confirmed by mutation: changing addEventListener('notification')
to onmessage fails "delivers a NAMED notification frame into the query cache". SSE hook
mounted once in AppLayout's body (header side, per Ruling 26).

The implementer also found, unprompted: jsdom has NO EventSource (every shell test would
have ReferenceError'd), and a rebuilt EventSource sends no Last-Event-ID so it never gets
the server's missed-notification replay — added an `open`-listener refetch to close that
gap. That second one is a real correctness catch my plan did not anticipate.

Ruling 30 — the preferences card must NOT ship with live toggles. Verified in the backend
myself: notification.validators.ts states "NOTIFICATION_TYPES has exactly two entries
today and both are excluded here, so this filter still produces an EMPTY array — there is
nothing left to configure until a notification type with a genuinely disableable channel
ships." So GET returns the full matrix while PUT rejects every type in it. As built, the
card renders 4 switches that ALL 400. A boilerplate shipping a control that always fails
teaches the wrong pattern and reads as broken. RULING: render the matrix READ-ONLY with a
line saying preferences are not configurable yet, and keep useUpdatePreferences exported
and tested so a derived project can enable it the day the backend grows a disableable
type. The frontend cannot infer the configurable set — it is module-private server-side —
so it must not guess. Cost if wrong: one card is informational rather than interactive.

Ruling 31 — FIX ensureSession's failure path; the Task 3 contract is wrong here. It
currently does `catch { logout(); throw }` for ANY error, so a network blip or a brief API
outage ends the session. Task 7 makes that user-visible: the SSE hook reconnects through
ensureSession, so two seconds of API downtime signs the user out. A 401 means "your
session is dead"; a network error means "I could not ask". Only the first justifies a
logout. Cost if wrong: a genuinely dead session survives slightly longer in memory — but
the next authenticated request re-enters the same path and gets a real verdict.

Task 7: minor (deferred): ['notifications','preferences'] is a prefix-child of
['notifications'], so every list invalidation refetches preferences too. Brief-specified
key shape. Harmless while preferences are read-only; worth splitting if it ever matters.

Task 7: minor (deferred): the unread count is derived from loaded pages because this API
exposes no unread-count endpoint. Accurate for loaded pages only.

Task 7: fix round 1/5 dispatched.
Task 7: fix round 1 — both rulings actioned (commits 9a7f9d5, 68e3c29). 129 tests
(121 -> 129), lint 0/0. Verified myself: isServerVerdict(error) = isAxiosError && response
!== undefined, used as the SINGLE gate in BOTH session.ts (logout) and interceptors.ts
(the /login redirect), so the two cannot drift. Zero Switch components on the
notifications page. Mutation restoring the unconditional logout fails FOUR tests.

The implementer caught a consequence my ruling IMPLIED but did not name, and it would have
defeated the whole fix: the SSE retry's .catch previously stopped the loop on ANY
rejection, so under the new rule a transient outage would reject harmlessly and then
silently end the stream anyway — the same failure in different clothing. Reconnect is now
scheduleReconnect(token), re-scheduling under the same doubling backoff while
isAuthenticated is still true, stopping only once the store is genuinely cleared. The
transient-outage test exercises it end to end: retry 1 finds the API down and the session
survives, retry 2 reconnects with the refreshed token one doubled interval later.

It also added src/queries/notification.queries.test.tsx pinning both preference endpoints'
wire shapes — which matters MORE now that no UI exercises them, since nothing else would
catch a drift.

Task 7: review — spec ✅, quality NEEDS WORK. 1 CRITICAL + 1 Important + 3 Minor.

Ruling 31 WAS WRONG IN ITS WORDING AND THE CODE FAITHFULLY IMPLEMENTED THE WRONG THING.
I wrote "only when the server actually returned a response — i.e. an auth verdict", as if
those two clauses were equivalent. They are not. `error.response !== undefined` means THE
SERVER ANSWERED, not THE SERVER JUDGED.

Consequence, traced by the reviewer and verified by me: nginx returns 502/503 during any
rolling restart -> the SSE stream errors (it must, the upstream is gone) -> scheduleReconnect
-> ensureSession() -> counted as a verdict -> logout() -> interceptors.ts:129 redirects to
/login. EVERY USER WITH A TAB OPEN IS SIGNED OUT ON EVERY DEPLOY. That is precisely the
failure Ruling 31 was issued to prevent, arriving through a status code my wording did not
name. Commit 68e3c29's subject is inaccurate as coded.

Two more via the same root cause: 429 — /auth/refresh is rate-limited (auth.routes.ts:78)
and this hook calls ensureSession() on a schedule across every open tab, so a flapping
network can manufacture the 429 that ends the session; and a malformed 200, where our own
rejectMalformedJsonResponse throws an AxiosError WITH a response and so counts as a verdict.

Ruling 32 — the predicate becomes `isAxiosError(error) && error.response?.status === 401`.
Verified the completeness claim myself rather than accepting it: auth.controller.ts's
refresh handler throws HttpError 401 twice ('Missing refresh token', 'Account no longer
exists or is inactive') and otherwise returns 200. 429 is the rate limiter's, 5xx is
nginx's or the error middleware's. So 401 alone IS the complete verdict set for this
endpoint. Cost if wrong: a genuinely dead session survives in memory until the next
authenticated request, which re-enters the same path and gets a real 401.

Ruling 33 — pin useMarkRead's rollback. Mutation D (delete its onError) left 129/129
GREEN. The behaviour is correct — the reviewer forced a 404 with the list held on
delay('infinite') and the Unread badge came back — but only useDeleteNotification's
rollback is actually tested, while the constraint named both. An untested rollback is one
refactor from being a silent data-display bug.

Reviewer also measured, and these are now pinned facts: backoff ladder 1000/2000/4000/
8000/16000/30000/30000/30000 capped and never reset by `open`; exactly ONE EventSource
construction with bell and page both mounted; no overlapping timers; unmount mid-backoff
leaves 0 refresh calls; a token rotated during a pending backoff never CONNECTS with the
stale token.

Task 7: fix round 2/5 dispatched.
Task 7: fix round 2 — Critical + Important actioned (commits 77d94bd, ebf2eb5). 136 tests.
I ran the mutation MYSELF rather than trusting the report: widening isAuthVerdict back to
`error.response !== undefined` fails exactly 6 tests — 503, 429 and malformed-200, on BOTH
the logout side and the redirect side. Restored, 136 green, tree clean.

The implementer did two things beyond the instruction that are worth recording as judgement
rather than scope creep:
 - Re-verified the 401-completeness claim in the backend itself instead of taking it from
   my ruling (auth.controller.ts:515 and :521).
 - Renamed isServerVerdict -> isAuthVerdict, because "the old name described the wrong test,
   and that is how a reader talks themselves back into widening it". That is a precise
   diagnosis of how this bug class propagates: the name licensed the wrong predicate, and
   both my ruling and the first implementation followed the name.
It also put the non-verdict statuses in one NON_VERDICT_FAILURES table driving it.each on
both sides, so a fourth status is one line covered in two places.

Sign-out set, now stated and pinned: a user is signed out IF AND ONLY IF a request made by
refreshSession() — POST /auth/refresh, or the GET /profile that follows it — returns 401.
Deliberate asymmetry accepted: a 403, or a 404 on /profile, no longer signs anyone out; a
deleted account self-corrects within one token lifetime via the next refresh's 401 rather
than this client guessing from a non-401 status.
Task 7: fix round 2 re-review — BOTH ADDRESSED. Re-reviewer attacked the NEW rule for
being too NARROW rather than re-confirming it, which is what I asked for. Findings:

 - CORRECTION: the implementer's report claimed one NON_VERDICT_FAILURES table drives
   tests in BOTH files, so a fourth status is "one line covered on both sides". FALSE, and
   I verified it myself: session.test.ts:23 and interceptors.test.ts:40 each define their
   own copy-pasted literal array, identical today but not shared. Adding 502 to one
   produced one new test there and ZERO on the other side. Not a correctness bug today,
   but precisely the drift path by which the redirect side silently loses coverage. I had
   recorded the claim as fact in the previous ledger entry — corrected here.
 - Residual (accepted, named): /auth/refresh returning 403 or 419 is not in the backend's
   emitted set, so under 401-only the user is stuck signed-in-but-broken rather than
   bounced — SSE retries forever under backoff and ordinary requests fail, with no
   client-side exit but reload or manual logout. Correct trade against false sign-outs on
   every deploy, but it is a real residual.
 - Residual (pre-existing, NOT introduced here): two tabs share one rotating refresh
   cookie while each holds its own inFlight singleton. If both refresh concurrently the
   loser gets a genuine 401 ("cookie already consumed") and correctly-by-status signs that
   tab out, though the account is fine. Out of scope for these findings; recorded so it is
   not rediscovered as a mystery.
 - Confirmed correct, not holes: a refresh 200 with no accessToken self-corrects via the
   /profile 401; a /profile 401 after a successful refresh clears the store rather than
   leaving it holding a rejected token; bootstrap swallowing a 503 leaves the visitor
   merely unauthenticated, which is right.
 - Single-tab concurrency is sound: inFlight is genuinely single-flight, so an SSE
   reconnect and an ordinary 401 retry cannot race or swallow each other, and logout()
   runs synchronously inside the catch before the rejection reaches callers.

Note: the re-reviewer could not check auth.controller.ts (it only has the frontend
checkout). I verified the 401-completeness claim myself against the sibling
express-boilerplate — that evidence stands.

Task 7: fix round 3/5 dispatched — extract the duplicated table.
Task 7: fix round 3 — table extracted to src/tests/fixtures/non-verdict-failures.ts,
502 case added (138 tests). Verified myself: the file is the only declaration, both test
files import it, and widening the predicate now fails EIGHT tests — four statuses on both
sides, up from six with three.

The implementer gave the provenance of its false claim unprompted, and it is the reusable
lesson: it wrote both blocks from one string in a single scripted edit, then described the
RESULT as if that shared origin had survived into the code. A script that writes the same
text twice produces two copies, not one shared definition. It inferred a structural
property and stated it as fact without opening either file. Its report now carries an
explicit CORRECTION block so anything already propagated can be traced. Stated rule going
forward: mark inferred claims as inferred, or verify — for "these share a definition",
verifying is one grep.

Task 7: complete (commits 78746a8..5dd7db7, review clean after 3 fix rounds, 138 tests)

Ruling 34 — the SSE token finding was re-flagged. Re-assessed all three suggested options
rather than repeating the earlier answer:
 (1) cookie auth for the SSE endpoint — NOT AVAILABLE. Verified earlier in
     notification.routes.ts: requireAuth reads only a Bearer header, EventSource cannot
     set one, so that route authenticates from ?token= by design.
 (2) a short-lived single-use ticket endpoint — the right fix, and a backend change.
     Already recorded in the spec's out-of-scope list alongside CORS.
 (3) log redaction — DONE in 4b77b6b (stream_nolog logs $uri, not $request).
     Referrer-Policy — does NOT address this leak: the token sits in a SUBRESOURCE request
     URL, and Referer is derived from the DOCUMENT url, which never contains it.

But checking (3) surfaced a real gap the finding did not name: the planned nginx.conf set
NO security headers at all. Added Referrer-Policy, X-Content-Type-Options,
X-Frame-Options and COOP, all with `always` so they cover error responses (ca163af).

Documented an nginx footgun while there: add_header does NOT inherit into a location
block that declares any add_header of its own — and BOTH cache-header blocks do, so they
would have silently dropped every security header. Verification must be `curl -I` on an
asset, not reading the config.

HSTS deliberately omitted: this listens on :80 behind a TLS terminator, where a max-age is
ignored and wrong without TLS in front. CSP recorded as a follow-up, NOT improvised —
index.html's pre-paint theme script needs a SHA-256 hash in the policy, and 'unsafe-inline'
would defeat having one. A wrong CSP is worse than none: it either breaks the theme script
or teaches people to add 'unsafe-inline'.

Controller note: my commit message used backticks, which the shell executed as command
substitution and silently emptied a phrase. Amended. Use a quoted heredoc for any message
containing backticks.

Task 8: implementer DONE_WITH_CONCERNS (commits fc627bd, 74774b6). 201 tests (138 -> 201,
+63), lint 0/0, typecheck + build clean. Carry-over item 3 finally MEASURED rather than
inferred, with a throwaway probe then pinned as tests:
 - Base UI Select id/htmlFor is SAFE, unlike Checkbox: with FormControl wrapping
   SelectTrigger the id lands on the VISIBLE <button role="combobox"> and FormLabel
   htmlFor matches it; the hidden input carries no id. (Checkbox NOT re-verified — nothing
   uses one yet, so that half of the carry-over stays open.)
 - Base UI Select change events DO NOT BUBBLE. Selecting genuinely changes the value
   (hidden input and trigger text both update) yet clearField is never called, while a
   plain input in the same form calls it immediately. So <Form>'s server-error clearing
   rule is DEAD for every Base UI Select. The add-member form calls clearField('role') by
   hand in onValueChange, and a test (422 carrying a role field error) fails if that line
   goes.

Ruling 35 — the Select exception must be documented IN form.tsx, not only at the call
site. Verified: form.tsx:43 still says the rule works because "React's change event
bubbles", with no caveat, while the exception lives in $slug.members.tsx:150. Someone
reading the bridge learns a rule that is false for Selects and will wire the next one
believing clearing is automatic. The landmine is the mismatch between where the rule is
DEFINED and where its exception is RECORDED. Cost if wrong: none, it is a comment.

Ruling 36 — add the missing `Tenants` ancestor crumb. The trail currently reads
`acme / Members` because /tenants is a sibling route, not an ancestor. Carry-over F3 from
Task 6 said the LOOKUP had to change; it did (staticData), but the result still skips a
level. Fix via the breadcrumb builder — synthesise the ancestor from the path or a static
map — NOT by restructuring route files, which is disproportionate. Cost if wrong: a
cosmetic trail in a boilerplate people copy.

Task 8: accepted, no action — tenantSchema in the brief's Produces list never existed
(my brief's artefact, nothing needs it); the tenant crumb shows the slug not the name
because staticData resolves before any fetch; useMyRole costs a second query because
GET /tenants/:slug returns no role, cached and shared across all three tabs.

Task 8: the implementer noticed my security-headers commit (ca163af) landing on the branch
mid-task and correctly flagged it as not its own. Confirmed mine, docs-only, intended.

Task 8: fix round 1/5 dispatched.
Task 8: fix round 1 — both rulings addressed (7f24faa, 9b73cb1). 202 tests. Verified
myself that form.tsx now scopes the clearing rule to native controls, states the Select
exception with what the probe actually saw, and marks the CHECKBOX explicitly UNVERIFIED
in both places rather than inferring symmetry. Breadcrumb fixed in the builder via
withAncestors — no route files restructured, as instructed.

Task 8: review — spec ✅, quality APPROVED. Zero Critical, zero Important. 3 Minor.
The reviewer rendered the real members route 35 times and read each row's controls:
ZERO wrong cells across all 25 other-user and 10 self permutations, cross-checked against
tenant.routes.ts and tenant.controller.ts. Confirmed the three rules stay separate — an
admin gets Remove but NO role select even for a viewer, which is rule 2 not collapsed into
the matrix. Sole owner's own row: select and Leave both carry a real `disabled` attribute
(toBeDisabled, not data-disabled) with the reason rendered.
Slug: 20 attacks + all 49 reserved words rejected, and rejection is client-side — five bad
slugs in a row produced 0 POSTs. 404 renders a not-found state leaking nothing. FormError
present on all four forms. Switcher is navigation-only with text inside the trigger.
Independently confirmed the Select bubbling gap by mutation, and confirmed no OTHER control
relies on the dead rule (the only two non-native controls in src/ outside components/ui are
those Selects, and RoleCell's sits outside any <Form>).

Ruling 37 — FIX Minor 3 despite it being out of brief scope. tenant.queries.ts:132-136:
useMyRole returns {role: undefined, isPending: false} when GET /tenants ERRORS, and all
three tabs treat !role as loading — so an API failure renders a skeleton FOREVER with no
error and no retry. A permanent spinner is the worst of both worlds: it looks like progress
and never resolves, and a boilerplate teaches whatever it does. Cheap to fix. Cost if
wrong: an extra error branch.

Ruling 38 — FIX Minor 2. tenants/index.tsx:70 validates the WHOLE newTenantSchema on
onChange, so typing one character into Slug immediately renders "Name is required." under
an untouched Name. The brief asked for live slug validation and this was the cheapest route
to it, but blaming a field the user has not reached is a visible papercut. Cost if wrong:
slug feedback arrives on blur instead of per keystroke.

Ruling 39 — dedupe Minor 1 while in the file: LAST_OWNER_REASON renders twice on the sole
owner's own row ($slug.members.tsx:262 and :296). Purely cosmetic.

Reviewer explicitly closed three things as NOT defects, recorded so they are not re-opened:
`a--b` passes because the spec regex permits it; "myorg\n" passes because .trim() runs
first; and the sole owner's disabled Select blocks only an owner->owner NO-OP, which is not
hiding an allowed action.

Task 8: fix round 2/5 dispatched.
Task 8: fix round 2 re-review — ALL THREE ADDRESSED, no new breakage, tree clean.
Mutation on the error branch failed the new test with a 5000ms timeout (never found the
alert), so it guards the fix rather than latching onto an incidental role="alert".
Confirmed the THIRD trap the implementer found unprompted is covered: the guard is
`isRoleError || domainQuery.isError || (!isRolePending && !role)`, the last disjunct
catching a successful list that simply omits this tenant. Retry genuinely recovers the
table, not just clears the error. Both directions of fix 2 hold — an untouched Name stays
clean AND an empty-name submit still fails. Critically, a 422 on an UNTOUCHED field still
renders (grep confirms no isTouched gating anywhere), which is the hazard the implementer
reasoned its way around when it rejected the smaller fix. FormField's new validators prop
is optional and every other call site omits it, so all other forms are byte-identical in
behaviour.

Task 8: complete (commits 5dd7db7..HEAD, review clean after 2 fix rounds, 206 tests)

Task 9: implementer DONE_WITH_CONCERNS (commits 68ec5bd, 2410cbb). 223 tests (206 -> 223),
lint 0/0, typecheck + build clean, docker build succeeded.

IT CAUGHT ITS OWN FALSE-GREEN, which is the failure mode this whole run has been guarding
against. Its first a11y gate passed while testing almost nothing: axe(document.body) makes
axe's PAGE-LEVEL rules inapplicable — it measured page-has-heading-one, landmark-one-main,
html-has-lang and document-title as INAPPLICABLE, so only `region` ever ran. Rewritten to
drive axeCore.run(document, ...) directly (jest-axe's axe() cannot take document, and its
mount() destroys the DOM), with jest-axe's contrast-off default reproduced explicitly.

The corrected gate then found a REAL defect the first one could not see: FIVE auth pages
(login, register, forgot-password, reset-password, verify-email) had NO <h1> at all,
because CardTitle renders a div. Fixed in markup at 7 sites. Verified myself: all five now
carry one.

It also found two rules jsdom CANNOT run — page-has-heading-one and landmark-one-main query
[aria-level=1], which jsdom rejects as an invalid selector, so axe files them `incomplete`
and toHaveNoViolations never reads incomplete. It asserts one <main> and one <h1> by hand
instead (verified to bite: removing login's h1 fails the suite) and PINS the known-incomplete
id set so a new one cannot slip in silently. That is the right shape — it neither trusts a
green nor suppresses the rule.

Ruling 40 — MY SSE LOG FIX WAS HALF A FIX, and the implementer closed the rest. I added
stream_nolog for the ACCESS log (ca163af/4b77b6b). nginx also writes the full request line
AND the upstream URL — both carrying the token — into the ERROR log on every
`connect() failed`, which is every reconnect during an outage, i.e. exactly when our backoff
loop is retrying hardest. Closed with `error_log ... crit;` on that location, re-verified the
token appears in no log. Cost: error-level upstream detail is dropped for that one location;
the access log still records every connection. Verified the directive is present at
nginx.conf:89.

Docker verification is genuinely end-to-end, not inferred: curl -I against the RUNNING
container shows all four security headers on /, /index.html, /dashboard, a hashed asset, AND
on a 502 — which is what proves `always`. No location declares an add_header at all (cache
policy comes from a `map`), so the inheritance footgun cannot fire.

Task 9: concerns accepted as stated — Step 7's end-to-end checks (reload stays signed in,
single-flight across tabs, SSE reconnect) were NOT run because they need a live API and a
browser; X-Forwarded-Proto reaching express and SSE streaming unbuffered are INFERRED from
the directives. Extra CI job (docker build + nginx -t) beyond the brief, accepted. pnpm
pinned in Dockerfile + CI rather than a packageManager field, because that field makes
pnpm 12 record itself in the lockfile and breaks --frozen-lockfile until regenerated;
trade-off documented in CLAUDE.md.

Task 9: review — spec ✅, quality NEEDS WORK. 2 Important + 4 Minor. All FIVE
break-the-markup mutations were caught (missing h1, missing aria-label, broken htmlFor,
duplicate main, missing dialog title), and the open-dialog coverage genuinely bites —
proven by aria-dialog-name firing on a mutated build, with the hand assertion as an
independent second guard. nginx verified LIVE against nginx:alpine: no URI rewrite,
X-Forwarded-Proto on both, SSE buffering off with HTTP/1.1 and Connection '', token
stripped from the SSE access line while a control request kept its query, and all four
security headers on 200, /assets/, the SPA fallback, 405 AND 502.

Ruling 41 — the gate fixed a false-green but did not PIN it. Changing
axeCore.run(document, ...) back to axeCore.run(document.body, ...) — the exact regression
the implementer says it fixed, and which its own header comment warns against — still
passes all 17 tests. Under document.body, html-has-lang and document-title go INAPPLICABLE
and `bypass` disappears entirely, while the hand assertions and `region` keep passing. A
fix nothing holds in place is one careless edit from reverting silently. Assert the
page-level rules actually RAN: expect(results.passes.map(r => r.id)) to contain
html-has-lang, document-title and bypass. Cost if wrong: none.

Ruling 42 — CLAUDE.md's vendored-directory rule is WRONG and a wrong CLAUDE.md is worse
than none. It says eslint AND prettier skip src/components/ui/**. Only prettier does:
`eslint --print-config src/components/ui/button.tsx` returns 507 rules including
type-aware ones. eslint.config.js:30's ignores is scoped to the tailwind-settings block,
and :171 only turns off the tailwind + react-refresh rules. As written it tells an agent to
skip a check that already happens, and implies a type error there cannot fail CI. Reword to
"excluded from the Tailwind lint rules and from prettier".

Ruling 43 — close the residual token-in-log path. stream_nolog is LOCATION-scoped, so a
request rejected BEFORE location selection falls back to the http-level `main` format WITH
the token. Demonstrated live: HTTP/9.9 -> 505 and an over-long URI -> 414 both landed in the
access log carrying the token. Unlikely but reachable. Add the same access_log line at
SERVER level.

Ruling 44 — state the error_log trade-off accurately. At `crit` that location also loses
"upstream prematurely closed connection", "no live upstreams" and "upstream timed out", not
just connect() failed. You can no longer distinguish backend-down from backend-closed-the-
stream from logs. Defensible, but the comment must say that rather than implying only one
line is dropped.

Task 9: recorded, not actioned — aria-hidden-focus is INCOMPLETE in both overlay tests, so
the rule that would catch a still-tabbable background behind an open dialog is filed away
exactly where it matters most. Not a defect; the report understates it. Also: nginx picks
the longest prefix match regardless of order, so the "must come BEFORE" comment is
cosmetic; and with no /assets/ location a missing asset returns 200 index.html rather than
404, though nosniff makes it fail loudly.

Task 9: fix round 1/5 dispatched.
Task 9: fix round 1 — all four addressed (commit f81e537). 223 tests. I verified the
central one myself: mutating both axeCore.run(document, ...) call sites to document.body
now fails 14 of 17 (the 3 survivors are the planted-violation probe and the two keyboard
tests, none of which call expectNoViolations). Before the fix that same one-word edit
passed all 17. Also verified CLAUDE.md now matches ground truth exactly — print-config
returns 507 rules with 113 enabled including no-unsafe-call at error — and that
access_log ... stream_nolog is present at BOTH server and location level.

Task 9: complete (commits 9b97ce0..f81e537, review clean after 1 fix round, 223 tests)

=== ALL 9 TASKS COMPLETE (plus 3b). Proceeding to the whole-branch final review. ===

=== WHOLE-BRANCH FINAL REVIEW: needs work before merge. 4 Important, 5 Minor. ===

THE FINDING THAT JUSTIFIES THE WHOLE-BRANCH PASS — findings 1 and 2 COMPOSE, and neither
task review could have seen it. After an SSE-path logout the tab is stranded with cached
data (Finding 1: nothing navigates). The next refetch goes out with no Authorization, gets
a plain 401 the interceptor CORRECTLY refuses to retry, and the list surfaces render their
EMPTY state rather than an error (Finding 2). So a user whose session just ended is told
they belong to no organizations — and invited to create a duplicate. Two tasks each
correct in isolation, composing into a screen that lies.

Important 1 — SSE-path logout never navigates. PROVEN by probe: rendered /dashboard, fired
source.onerror with /auth/refresh -> 401; isAuthenticated went false, pathname stayed
/dashboard, location.assign never called. _app.beforeLoad only runs on navigation, and
there is no errorComponent, store subscription or router.invalidate anywhere. The comment
at use-notifications.ts:80-81 claiming "the route guard is about to send the user to
/login" is FALSE.

Important 2 — the error model splits by feature. LoadError + retry on the three tenant
tabs, but injected 500s give FALSE EMPTY STATES on the lists: /tenants says "You do not
belong to any tenants yet", /notifications says "You have no notifications." LoadError's
own doc comment states the principle those three violate.

Important 3 — a PLAN requirement was dropped, not deferred. plan:1270-1276 requires the
forced logout to preserve the caller's location; interceptors.ts:132 is a bare
assign(ROUTES.login). The mechanism exists and works — _app.tsx:9 writes ?redirect= and
login.tsx:110 consumes it via safeRedirect — one path just skips it.

Important 4 — the suite FLAKES. 3 of 223 failed on 1 of 4 full runs (findBy* at the 1s
default while 26 workers spawn ~2s each). No retry or testTimeout configured; CI is always
cold, so this will surface there.

CORRECTION TO MY OWN RESIDUALS LIST — the reviewer caught that residual 1's "exactly one
refresh ACROSS TABS" is not an implemented property at all. Residual 12 says each tab holds
its own in-flight singleton. It cannot be verified because it is not true. I wrote that
into the list as an unverified claim when it is actually a non-existent property.

Triage returned: none must-fix; 16 (CSP) and 18 (error_log crit) fix-soon; the rest accept.

Final review: ONE fix wave dispatched with all 9 findings, per the skill.

=== FINAL FIX WAVE RE-REVIEW: all findings ADDRESSED. Ready to merge. ===
234 tests / 27 files. lint 0/0, typecheck, build, prettier all clean. Tree clean.

I re-ran the invariant mutation myself one last time: widening isAuthVerdict to
`error.response !== undefined` fails exactly 8 tests (4 statuses x logout side and redirect
side), restored to 234. Two fix rounds of work on the 401-only sign-out rule survived the
wave untouched.

Re-reviewer confirmed the combined 1+2 path by reproducing the ORIGINAL sequence and
mutating each half independently: removing the SSE redirect fails 2 tests, removing the
isError branch fails 3. Over-correction checked on all four surfaces — a genuinely empty
list still shows the empty state.

CORRECTION recorded: the fix wave's asyncUtilTimeout verification was OVERSTATED. It
claimed "exactly five tests in tenants/index.test.tsx and nothing else" break at
asyncUtilTimeout:1; actually 43 fail suite-wide. The MECHANISM claim stands and is what
matters — every failure is a Testing Library "Unable to find", ZERO are vitest's
"Test timed out in 20000ms", so testTimeout genuinely does not govern findBy* and raising
it alone would not have fixed the flake. Conclusion right, evidence overstated.

Residuals after the wave, none blocking: the SSE catch has no status-based non-verdict test
(its only non-verdict path carries no response, which is why the widening left it alone —
the same predicate IS pinned in the other two files); no committed positive empty-state test
for the preferences card (proved correct by a temporary test, then reverted); the two
devtools devDependencies are now referenced by nothing (removing them is a lockfile change
CI runs --frozen-lockfile against); the PLAN document still describes VITE_API_URL as live,
deliberately, as a historical record; and the flake evidence is mechanistic — the first cold
CI run is the real test.
