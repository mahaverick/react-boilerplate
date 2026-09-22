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
   `members` declares `desktop-loaded` (1440×900) and `mobile-loaded` (390×844). **Neither has
   been rendered** — see "Not done" below.
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

## Not done, deliberately

- **`ss-verify` did not run. No screenshot exists. Nothing was rendered in a browser.**
  Playwright is out of scope per spec §9, so the score above stands on code review alone. The
  two `requiredRenders` entries record intent, not evidence.
- **Colour contrast is unchecked.** jest-axe disables every `cat.color` rule under jsdom. A
  green a11y run says nothing about contrast.
- **No CI enforcement.** The deterministic tier runs on demand. `eslint`, `tsc`, Vitest and
  jest-axe remain the CI gates.
- **Open-items §1 is untouched** — the three never-executed behaviours still need a live
  express-boilerplate and a browser.
