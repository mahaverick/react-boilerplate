# Phase B gate evidence

Recorded 2026-09-22 against StyleSeed v4.2.0, commit
`44475742e96ffa66d869274b0643042f5c6b47e9`. Satisfies the acceptance list in
`../specs/2026-09-22-phase-b-styleseed-design.md` §11.

## The command

```bash
node "<styleseed>/skills/ss-resolve/scripts/resolve-context.mjs" \
  --project-root . --artifact members --agent claude
node "<styleseed>/skills/ss-score/scripts/styleseed-check.mjs" \
  scan --project-root . --artifact members --format json
```

Exit 0. No `SS000` contract error.

## Deterministic tier

**24 findings before, 17 after.** `SS003` and `SS004` are now zero.

| Rule | Before | After | What changed |
| --- | --- | --- | --- |
| SS001 hardcoded-color | 1 | 1 | Unchanged — recorded false positive |
| SS002 arbitrary-pixel | 8 | 6 | Two fixed; six are recorded exceptions |
| SS003 transition-all | 5 | **0** | All five replaced with named properties |
| SS004 reduced-motion | 1 | **0** | Fixed by declaring `src/styles` as a `sourceRoot` |
| SS005 focus-suppression | 10 | 10 | One real defect fixed; count unchanged, composition changed |
| SS006 unlabeled-icon | 0 | 0 | — |

### Every remaining finding, reconciled

Nothing below is unexplained.

**SS001 (1)** — `features/notification-bell.tsx:101` `#9679`.
Recorded false positive. It is `&#9679;`, the HTML entity for a decorative bullet, inside an
`aria-hidden="true"` span. Not a colour.

**SS002 (6)** — all recorded exceptions in `STYLESEED.md`:

| Location | Value | Why it stays |
| --- | --- | --- |
| `ui/tabs.tsx:24` | `p-[3px]` | Scale offers 2px or 4px; neither matches |
| `ui/tabs.tsx:61` | `bottom-[-5px]` | Scale offers −4px or −6px; neither matches |
| `ui/switch.tsx:16` | `h-[18.4px]` `h-[14px]` `w-[32px]` `w-[24px]` | Base UI thumb/track geometry; `18.4px` fractional on purpose |

The two that *did* have exact equivalents were fixed: `w-[2px]` → `w-0.5` and
`min-w-[96px]` → `min-w-24`, both identical renderings on Tailwind 4's `0.25rem` base.

**SS005 (10)** — measured pairing, not assumed:

| Disposition | Count | Locations |
| --- | --- | --- |
| Detector false positive — `outline-none` paired with `focus-visible:` in the same class string | 6 | `button.tsx:6`, `input.tsx:11`, `select.tsx:43`, `switch.tsx:16`, `tabs.tsx:74`, `textarea.tsx:9` |
| Recorded exception — non-focusable container, sets no `tabIndex` | 4 | `alert-dialog.tsx:55`, `dialog.tsx:56`, `dropdown-menu.tsx:35`, `dropdown-menu.tsx:43` |

`tabs.tsx` moved from the second group to the first during this work — see below.

## The one real defect this found

`ui/tabs.tsx` suppressed its focus outline on `Tabs.Panel` with nothing in its place.
`@base-ui/react@1.8.0` renders that panel with `tabIndex: open ? 0 : -1`
(`tabs/panel/TabsPanel.js:76`), so an open panel **is** keyboard-reachable. That is a WCAG
2.4.7 failure which 243 tests and ten reviews had not caught. It now carries the same
`focus-visible:ring-3 focus-visible:ring-ring/50` the other focusable primitives use.

Of ten `SS005` findings: six detector false positives, four correct-but-inapplicable, one real
accessibility bug. That ratio is the argument for reading findings rather than obeying them.

**`Tabs` is not mounted by any route.** `$slug.tsx` deliberately uses a nav of real links
because those tabs are routes. The fix is still worth having — the primitive is part of the
approved set — but its test renders it directly, because nothing else would.

## Three corrections to the spec, found by running the contract

1. **`requiredRenders` cannot be empty.** The spec said `[]`; `normalizeArtifact` rejects it.
   `members` declares `desktop-loaded` (1440×900) and `mobile-loaded` (390×844). Both have
   since been rendered — see "Visual tier" below.
2. **An artifact only sees what it declares.** `SS004` fired until `src/styles` joined
   `sourceRoots`, because the app's only `prefers-reduced-motion` block is `globals.css:140`.
   Listing a file in `tokenFiles` does not put it in the scanned inventory. An under-declared
   artifact produces confident, wrong findings.
3. **The resolver emits a palette the app does not use.** `.styleseed/palettes/members.{css,json}`
   define `--ss-*` variables that nothing imports. They are committed because the manifest
   hashes them and verification fails without them; `STYLESEED.md` states plainly that
   base-nova remains the only live token set.

## Agent-judged tier

`styleseed-check.mjs` computes no score. The number below is a verdict from applying the
`ss-score` rubric, not a measurement.

**Design Score: 93 / 100** — `src/pages/_app/tenants/$slug.members.tsx`

| Category | Score | Reasoning |
| --- | --- | --- |
| Color discipline | 16/16 | Zero hardcoded hex, zero emoji-as-icon, zero ad-hoc palette classes, no unlocked default indigo. Fully token-driven |
| Distinctiveness | 8/10 | No icon-chip cliché, no all-even card grid, no placeholder hero. −2: a plain functional table with no focal point beyond itself |
| Hierarchy & typography | 15/16 | Consistent scale, real table semantics. −1: limited differentiation on a table-dominant page |
| Layout & rhythm | 12/12 | Consistent `gap` rhythm; grouping matches the `operations-console` grammar |
| Cards & elevation | 10/10 | One surface language — hairline borders, restrained shadow |
| States & a11y | 14/18 | Loading (Skeleton), error (`LoadError` with retry, stacked so either query can fail alone), disabled states, aria-labels, axe-gated. **−4: no explicit empty state** — an empty member list renders an empty table body |
| Motion & interaction | 6/6 | No ad-hoc fades; transitions now name their properties; reduced-motion honoured globally |
| Coherence | 12/12 | One radius scale, one palette, one type scale, consistent control sizes |

Above the floor of 80. The one actionable item is the missing empty state; it is arguably
unreachable in practice, since a tenant always has at least its owner.

## Tests

| | Count |
| --- | --- |
| Before Phase B | 243 across 28 files |
| After | **248 across 28 files** |

Added: one focus-indicator assertion on the tab panel, and four opened-menu axe checks —
the notification bell, tenant switcher, user menu and theme toggle. Those four close
open-items §3, the blind spot that once hid a page-crashing `DropdownMenuLabel` bug through
234 passing tests.

`pnpm lint`, `pnpm typecheck`, `pnpm test --run` and `pnpm build` all pass.

## Visual tier — `ss-verify`

**Run 2026-09-22, after this document was first written.** Playwright 1.63.0 was added as a
devDependency and the visual gate was run, reversing spec §9's original out-of-scope call.
Five renders, exact viewports, `deviceScaleFactor: 2`, headless Chromium.

Renders are in `2026-09-22-phase-b-renders/`.

| Render | Viewport | Verdict |
| --- | --- | --- |
| `desktop-loaded` | 1440×900 | Pass, with layout findings below |
| `mobile-loaded` | 390×844 | Pass — genuinely responsive |
| `desktop-empty` | 1440×900 | **Fail** — no empty state |
| `mobile-empty` | 390×844 | **Fail** — same |
| `desktop-error` | 1440×900 | Pass — the best-designed state on the page |

### What the gate confirmed that code review only inferred

**The empty state is a bare table header.** With no members, the page renders
`Name / Email / Role / Actions` floating over nothing. The −4 taken on "States & a11y" in the
code score was read from source; this is it seen. It is the skill's canonical "blank void for
no data" failure.

The contrast with the error state is what makes it a real finding rather than a nitpick. The
error state renders a bordered panel reading *"We could not load this tenant's members, so none
are listed here. This is not a sign that it has none."* plus a **Try again** button — it goes out
of its way to disambiguate error from empty. The empty case, which that sentence explicitly
refers to, was never designed.

**`min-w-2xl` is now verified rather than reasoned.** Open-items §4 recorded the member table's
horizontal scroll as "reasoned CSS; jsdom cannot demonstrate it." Measured at 390×844:

```
tableScrollWidth: 672   tableClientWidth: 326   tableScrolls: true
docScrollWidth:   390   docClientWidth:   390   pageOverflows: false
```

The table scrolls inside its container and the page itself does not overflow — exactly the
intent. **That open item can be closed.**

**Fonts load.** `document.fonts.check('16px "Geist Variable"')` returned true in every render,
with `font-family` resolving to `"Geist Variable", sans-serif`. The skill's canonical silent
failure — a webfont falling back to Times — is not happening.

### New findings, visible only in pixels — all four since fixed

Recorded here as found, with what was done about them. The renders in
`2026-09-22-phase-b-renders/` are the **post-fix** ones; the descriptions below are what
they replaced.

1. **Desktop is under-filled.** At 1440×900 the content occupies roughly the upper-left: the
   lower third and the right ~30% are empty. The page reads sparse on a wide canvas.
2. **Type scale is small for the desktop canvas.** The `h1` is undersized at 1440px — the
   surface-scale tell. At 390px the same scale reads well, so this is specifically a desktop
   problem.
3. **Mobile clips the owner helper text.** "A tenant must always have an owner. Add another
   owner first." is cut mid-sentence at the scroll container's edge, reading "A tenant must
   always have". It is recoverable by scrolling, but it looks broken at rest.
4. **Mobile hides the Actions column.** Leave/Remove sit off-screen behind the horizontal
   scroll. That is the deliberate consequence of `min-w-2xl`, but it means the primary per-row
   action is invisible on a phone until the user scrolls.

**What was done (2026-09-22):**

| Finding | Fix |
| --- | --- |
| Empty state was a bare header | `$slug.members.tsx` now says "No one has access to this tenant yet. Add someone below." — placed **after** the error branch, for the reason `notifications.tsx` records |
| Desktop under-filled | `$slug.tsx` `max-w-4xl` → `max-w-4xl xl:max-w-6xl`, on **both** wrappers so the page does not jump width on load |
| `h1` undersized at 1440px | `text-2xl` → `text-2xl lg:text-3xl` |
| Mobile: Actions off-screen **and** owner sentence clipped | The list **stacks as cards** below the mobile breakpoint. One fix closes both, because both were consequences of the same horizontal scroll |

The card path is chosen in JS with `useIsMobile()`, not a `hidden`/`md:hidden` CSS pair: a CSS
pair renders both paths into the DOM, which means two role selects per member and two copies
of one `reasonId` — a duplicate-id accessibility failure that reads as a regression.

Covered by three new tests (`$slug.members.test.tsx` ×2, `a11y.test.tsx` ×1) and five e2e
assertions in `e2e/fixtures/members.test.ts`. Unit tests: 249 → **251**.

### Visual score

**Design Score (seen): 85 / 100** — against the same rubric, scoring pixels rather than source.

| Category | Score | Change from the code score |
| --- | --- | --- |
| Color discipline | 16/16 | — one accent confirmed by eye |
| Distinctiveness | 8/10 | — |
| Hierarchy & typography | 13/16 | **−2**: the `h1` is visibly undersized at 1440px |
| Layout & rhythm | 8/12 | **−4**: dead lower third and right third |
| Cards & elevation | 10/10 | — |
| States & a11y | 12/18 | **−2**: empty state confirmed, plus the clipped mobile helper text |
| Motion & interaction | 6/6 | — no mid-transition frame captured; nothing observed as wrong |
| Coherence | 12/12 | — |

85 was above the floor of 80 and **eight points below the code score of 93**. That gap is the
whole argument for the visual gate: every point of it came from something source cannot show.

**Re-scored after the fixes: 95 / 100.** Hierarchy & typography back to 15/16 (the `h1` now
carries the canvas), Layout & rhythm to 11/12 (the content uses the width it has; the
remaining point is that a two-row fixture will look sparse on any large monitor), States &
a11y to 17/18 (empty state designed, mobile controls reachable, nothing clipped). The
remaining point in States is contrast, which is still unmeasured rather than unaddressed.

### Dark theme

Rendered and inspected separately via the browser. Surfaces layer correctly (page darker than
cards), text stays readable, no flash of light on load — the pre-paint script in `index.html`
does its job. Not part of the required renders, since `paletteMode` is `light`.

### How to reproduce

Playwright is installed but **no committed file uses it** — the harness is deliberately not in
the repo, because a root-level `.mjs` and a `src/harness.tsx` would both need changes to the
type-aware lint config to pass `eslint --max-warnings 0`, and that config is carefully tuned.
The harness is reproduced here instead.

`harness.html` is `index.html` with its script src pointed at `/src/harness.tsx`. That file
registers an MSW browser worker with the same fixtures as `src/tests/a11y.test.tsx`
(`TENANT`, `MEMBERS`, `SETTINGS`, `NOTIFICATIONS`, `PREFERENCES`), sets the signed-in store
state, and then — importantly — calls
`history.replaceState(null, '', '/tenants/acme/members')` **before** mounting. Using
`router.navigate` instead does a real navigation, and the dev server answers that path with the
SPA fallback, so the harness never runs. `?state=empty|error|loading` swaps the members handler.
`npx msw init public/` provides the worker; the generated file is not committed.

Then `pnpm dev` and a Playwright script looping the surfaces at `deviceScaleFactor: 2`,
waiting on `document.fonts.ready` and a `tbody tr`, with the error state waiting up to 45s for
**Try again** to outlast TanStack Query's retry backoff.

### Formal evidence attach

Not performed. `evidence-gate.mjs` expects
`.styleseed/evidence/<artifactId>/<runId>/gate-run.json` plus a `verification.json` binding a
deterministic, code, visual and temporal report under one run id. The renders satisfy the
artifact's `requiredRenders` contract by id, state and viewport, but no `gate-run.json` was
written, so **no machine-verified attach exists** — this document is the record.

## Not done, deliberately

- **Colour contrast is still unmeasured.** jest-axe disables every `cat.color` rule under
  jsdom, and looking at a screenshot is not measuring contrast. The renders make it *visible*;
  they do not make it *checked*.
- **No mid-transition frame.** Motion was not captured, so the "cheap fade on everything" tell
  is unassessed.
- **No formal evidence attach** — see above.
- **No CI enforcement.** The deterministic tier runs on demand. `eslint`, `tsc`, Vitest and
  jest-axe remain the CI gates. Playwright is **not** wired into CI.
- **Open-items §1 is untouched** — reload keeps you signed in, SSE reconnects after a real
  backend restart, and `X-Forwarded-Proto` reaches Express still need a live
  express-boilerplate. The harness mocks the API, so it cannot speak to any of them. Playwright
  being installed now makes that task cheaper.
- **Contrast is still unmeasured.** Seeing a render is not measuring it, and jsdom disables
  the rule. A contrast pass is its own task.
- **No mid-transition frame**, so the motion tell is still unassessed.
