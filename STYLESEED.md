# StyleSeed design lock — react-boilerplate

StyleSeed is pinned to **v4.2.0, commit `44475742e96ffa66d869274b0643042f5c6b47e9`**
(`github.com/bitjaru/styleseed`). Rules move; an unpinned adoption would change under us.
Upgrades go through `/ss-update` and are reviewed as a diff.

Design spec: `docs/superpowers/specs/2026-09-22-phase-b-styleseed-design.md`
Implementation plan: `docs/superpowers/plans/2026-09-22-phase-b-styleseed.md`

## Ownership

**Base UI (`@base-ui/react`) owns `src/components/ui/` permanently.** StyleSeed contributes
method, rules and review — never components. Its 32 Radix primitives and its Vite 6 / React 18
scaffold are not used and must not be introduced. Do not reopen without new evidence.

This was the question that blocked Phase B. It is settled: the gate chain references neither
Radix nor `engine/components`, `ss-component` reads the project's own primitives, and the 19
`@radix-ui/*` packages live only in a fresh-project scaffold that does not apply here.

## Selection

- Output grammar: `operations-console`
- Page type: `detail`
- Brand recipe / palette recipe / profile: none — `base-nova` is the approved visual system
- Score floor: 80

## Approved tokens

`src/styles/globals.css` is the single token file. It is written in `oklch()`, not hex.
Tailwind 4 spacing base is the default `--spacing: 0.25rem`, so `N` → `N × 4px`.

| StyleSeed role | base-nova variable |
| --- | --- |
| `semantic/background` | `--background` |
| `semantic/surface` | `--card`, `--popover` |
| `semantic/foreground` | `--foreground` |
| `semantic/muted` | `--muted`, `--muted-foreground` |
| `semantic/border` | `--border` |
| `semantic/input-background` | `--input` |
| `semantic/switch-background` | `--input` (no dedicated variable exists) |
| `semantic/destructive` | `--destructive` |
| `chart/1`–`chart/5` | `--chart-1`–`--chart-5` |

`semantic/success`, `semantic/warning` and `semantic/info` are **deliberately absent**.
Nothing renders status colour and there are zero ad-hoc palette classes in the codebase.
**When the first one is needed, add the token — never reach for `green-500`.**

## Recorded exceptions

These are intentional and must not be "fixed" by a future pass.

| Rule | Location | Value | Why |
| --- | --- | --- | --- |
| SS002 | `ui/tabs.tsx` | `p-[3px]` | Optical inset; the scale offers 2px or 4px, neither matches |
| SS002 | `ui/tabs.tsx` | `bottom-[-5px]` | Optical underline offset; the scale offers −4px or −6px |
| SS002 | `ui/switch.tsx` | `h-[18.4px]` `w-[32px]` `h-[14px]` `w-[24px]` | Base UI thumb/track geometry; `18.4px` is fractional on purpose |
| SS005 | `ui/alert-dialog.tsx` | `outline-none` | `AlertDialogPopup` sets no `tabIndex`; not tab-reachable |
| SS005 | `ui/dialog.tsx` | `outline-none` | `DialogPopup` sets no `tabIndex`; not tab-reachable |
| SS005 | `ui/dropdown-menu.tsx` | `outline-none` ×2 | `MenuPositioner` is a wrapper and `MenuPopup` sets no `tabIndex`; neither is tab-reachable |
| SS001 | `features/notification-bell.tsx` | `&#9679;` | HTML entity for a decorative `aria-hidden` bullet, not a colour |

Rounding any of the SS002 values to the nearest scale step changes how the control renders.
**Appearance wins over rule compliance** — the rule exists to prevent *unintentional* drift.

## Known detector limits

- **SS005 has a ~50% false-positive rate here.** Its message claims "without a detected
  replacement" but its regex performs no replacement detection. Five of the ten it reported
  were paired with `focus-visible:` in the same class string. Read findings; do not obey them.
- **`isTokenOrThemeFile` silently skips real code.** `src/components/features/theme-toggle.tsx`
  and `src/states/theme.store.ts` match its `theme[.-]` pattern and are never scanned.
  `tokenFiles` adds to the skip set rather than whitelisting into it, so this cannot be fixed
  from our side. Review those two by hand.
- **The 0–100 score is an agent verdict**, not a computed number. `styleseed-check.mjs`
  contains no scoring; the number comes from an agent applying the `ss-score` rubric. Evidence
  attaches to the score; the number is judgment.
- **The scanner is registry-bound.** It scans only artifacts registered in
  `.styleseed/artifacts/`, never the whole repo. Adding a route means adding an artifact.
- **An artifact only sees what it declares.** `SS004` (motion without a reduced-motion path)
  fired until `src/styles` was added to `sourceRoots`, because the app's only
  `prefers-reduced-motion` block lives in `globals.css:140`. Listing a file in `tokenFiles`
  does **not** put it in the scanned inventory — it must also sit under a `sourceRoot`. An
  under-declared artifact produces confident, wrong findings.
- **`requiredRenders` must not be empty.** The contract rejects `[]`, so `members` declares a
  desktop and a mobile loaded state. Both were rendered on 2026-09-22 with Playwright; see
  `docs/superpowers/decisions/2026-09-22-phase-b-evidence.md`. Colour contrast is still
  unmeasured — seeing a render is not measuring it.

## Generated files that are not our tokens

`resolve-context.mjs` writes `.styleseed/palettes/members.css` and `members.json` from
`project.json`'s `keyColor`. They are committed because the manifest hashes them and
verification fails without them.

**They are not used by the application.** They define `--ss-*` variables that nothing imports.
`src/styles/globals.css` and its base-nova tokens remain the only live design tokens. Do not
wire `--ss-*` into components, and do not treat that file as a source of truth.

## Skills

**Adopted, core method:** `ss-setup` `ss-resolve` `ss-lint` `ss-score` `ss-a11y` `ss-audit`
`ss-verify` `ss-tokens` `ss-update`

**Adopted for new UI work:** `ss-component` `ss-pattern` `ss-page` `ss-review`

**Excluded:** `ss-build` (scaffolds a screen first; ours exist) · `ss-studio` (creative
exploration) · `ss-reference` (we have a chosen grammar) · `ss-restyle` (base-nova is approved)
· `ss-dial` (the lock fixes brand values) · `ss-motion` (reduced-motion already passes SS004) ·
`ss-copy` · `ss-flow` · `ss-feedback` (all out of scope) · `styleseed` (meta-router; we invoke
skills directly)

## Enforcement

On demand, not in CI. StyleSeed publishes no npm package and its plugin installs outside the
repo, so wiring the scanner into CI would mean vendoring it and owning its updates. `eslint`,
`tsc`, Vitest and `jest-axe` remain the CI gates.

Run the deterministic tier with:

```bash
node "<styleseed>/skills/ss-score/scripts/styleseed-check.mjs" \
  scan --project-root . --artifact members --format json
```

**The committed tree scans clean on its own** — no resolver step is needed first. The
manifest's nine `sources` are all StyleSeed catalog entries (`catalog:core`,
`built-in:operations-console`, and so on), **not** project files, so editing `globals.css`,
a component or this file does not invalidate it.

Re-run `resolve-context.mjs` only when one of these changes: an artifact's `selection`, its
`implementation` paths, `project.json`, or StyleSeed's pinned version. Re-running it rewrites
the bundle, the manifest and the palette, so commit those together.

## Visual verification

`ss-verify` was run on 2026-09-22 with Playwright 1.63.0 at 1440×900 and 390×844,
`deviceScaleFactor: 2`. **Visual score 85/100, against a code score of 93** — the eight-point
gap is what source cannot show. Renders and findings:
`docs/superpowers/decisions/2026-09-22-phase-b-evidence.md`.

Playwright now has a committed consumer: the e2e suite in `e2e/`, run with `pnpm test:e2e`.
Its `fixtures` project turns the visual gate's findings into standing assertions — webfont
loaded, nothing overflowing at 390px, the empty and error states rendering as more than a bare
header — so a regression fails a test rather than waiting for the next screenshot. See
CLAUDE.md's end-to-end section for the conventions.

All four findings the visual gate produced have since been fixed; re-scored **95/100**.

## Accessibility

`jest-axe` asserts and stays in CI — it is authoritative. `ss-a11y` discovers, per artifact,
and its findings become tests. One model, two instruments.
