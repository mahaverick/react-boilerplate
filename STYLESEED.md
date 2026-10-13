# StyleSeed design lock

StyleSeed is the design method this repo checks its UI against. The lock below records
what the method may and may not change here. The pinned engine (`github.com/bitjaru/styleseed`) is **4.2.0**, revision
`sha256:2ac39abb22417fa30964c3bd89667231ee18a5ae699aef9b588273f094606444`
(`.styleseed/manifests/members.json`). Rules move, so an unpinned adoption would change
under the repo. Upgrades go through `/ss-update` and are reviewed as a diff.

## Ownership

**Base UI (`@base-ui/react`) owns `src/components/ui/` permanently.** StyleSeed contributes
method, rules and review, never components. Its Radix primitives and its Vite/React
scaffold are not used and must not be introduced. `ss-component` reads the project's own
primitives, and nothing in the gate chain needs StyleSeed's components.

## Selection

The selection lives in `.styleseed/project.json` and `.styleseed/artifacts/members.json`.

- Output grammar: `operations-console`
- Page type: `detail`
- Surface adapter `product-ui`, domain `saas`
- Brand recipe `enterprise-workbench`, palette recipe `quiet-mineral`, profile `none`.
  These feed the resolver only. shadcn's `base-vega` style with the `mist` base colour,
  Inter Variable and Tabler icons (`components.json`) is the approved visual system.
- `.styleseed/project.json` records the brand (`Inter Variable`, key colour `#171717`). The
  manifest hashes that file, so it changes only through a reviewed re-pin with the pinned
  engine (`resolve-context.mjs --project-root . --artifact members --agent claude`).
- Score floor: 80
- One artifact, `members`, targeting the route `/settings/workspace/$slug/members` (Settings ›
  Workspace › Members)

## Approved tokens

`src/styles/globals.css` is the single token file. It is written in `oklch()`, not hex.
The Tailwind 4 spacing base is the default `--spacing: 0.25rem`, so `N` is `N × 4px`.

| StyleSeed role              | base-vega variable                       |
| --------------------------- | ---------------------------------------- |
| `semantic/background`       | `--background`                           |
| `semantic/surface`          | `--card`, `--popover`                    |
| `semantic/foreground`       | `--foreground`                           |
| `semantic/muted`            | `--muted`, `--muted-foreground`          |
| `semantic/border`           | `--border`                               |
| `semantic/input-background` | `--input`                                |
| `semantic/switch-background`| `--input` (no dedicated variable exists) |
| `semantic/destructive`      | `--destructive`                          |
| `chart/1` to `chart/5`      | `--chart-1` to `--chart-5`               |

`semantic/success`, `semantic/warning` and `semantic/info` are **deliberately absent**.
Nothing renders a status colour, and no component uses an ad-hoc palette class such as
`green-500`. **When the first status colour is needed, add the token to `globals.css`.
Never reach for a palette class.**

`--muted-foreground` is `oklch(0.52 0.021 213.5)`. A lighter value fails contrast against `--muted`;
`pnpm test:contrast` (`e2e/contrast/contrast.test.ts`) measures it.

## Recorded exceptions

These are intentional. A later pass must not "fix" them.

| Rule  | Location                          | Value                                          | Why                                                                                 |
| ----- | --------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| SS002 | `ui/tabs.tsx`                     | `p-[3px]`                                      | Optical inset; the scale offers 2px or 4px, neither matches                         |
| SS002 | `ui/tabs.tsx`                     | `bottom-[-5px]`                                | Optical underline offset; the scale offers -4px or -6px                             |
| SS002 | `ui/switch.tsx`                   | `h-[18.4px]` `w-[32px]` `h-[14px]` `w-[24px]`  | Base UI thumb and track geometry; `18.4px` is fractional on purpose                 |
| SS005 | `ui/alert-dialog.tsx`             | `outline-none`                                 | `AlertDialogPopup` sets no `tabIndex`, so it is not tab-reachable                   |
| SS005 | `ui/dialog.tsx`                   | `outline-none`                                 | `DialogPopup` sets no `tabIndex`, so it is not tab-reachable                        |
| SS005 | `ui/dropdown-menu.tsx`            | `outline-none` ×2                              | `MenuPositioner` is a wrapper and `MenuPopup` sets no `tabIndex`; neither is tab-reachable |
| SS001 | `features/notification-bell.tsx`  | `&#9679;`                                      | An HTML entity for a decorative `aria-hidden` bullet, not a colour                  |

Rounding an SS002 value to the nearest scale step changes how the control renders.
**Appearance wins over rule compliance.** The rule exists to prevent _unintentional_ drift.

`outline-none` elsewhere in the app sits on elements that are paired with a
`focus-visible:` ring in the same class string (`ui/button.tsx`, `ui/input.tsx`, ...), on
focus targets with `tabIndex={-1}` (`layouts/app-layout.tsx`, `layouts/auth-layout.tsx`),
or on the chip input inside `ui/combobox.tsx`, which has neither. Read an SS005 finding
before acting on it.

## Known scanner limits

These describe the pinned engine's scanner (`styleseed-check.mjs`). This repo holds no
scanner source, so the engine-behaviour claims below cannot be checked here; only the
registry, `sourceRoots` and `requiredRenders` points can.

- **SS005 reports false positives.** Its message says "without a detected replacement", but
  it does not look for a replacement. Many reported lines carry `focus-visible:` in the same
  class string. Read findings; do not obey them.
- **`isTokenOrThemeFile` skips real code.** `src/components/features/theme-toggle.tsx` and
  `src/states/theme.store.ts` match its `theme[.-]` pattern and are never scanned.
  `tokenFiles` adds to the skip set rather than whitelisting into it, so the repo cannot fix
  this. Review those two files by hand.
- **The 0 to 100 score is an agent verdict**, not a computed number. The scanner computes no
  score; an agent applies the `ss-score` rubric. Evidence attaches to the score, and the
  number is judgment.
- **The scanner is registry-bound.** It scans only artifacts registered in
  `.styleseed/artifacts/index.json`, never the whole repo. A new route needs a new artifact.
- **An artifact sees only what it declares.** `members` lists `src/styles` in `sourceRoots`
  because the app's `prefers-reduced-motion` block lives in `globals.css`; without it `SS004`
  (motion with no reduced-motion path) fires. A file in `tokenFiles` must also sit under a
  `sourceRoot` to be scanned. An under-declared artifact gives confident, wrong findings.
- **`requiredRenders` must not be empty.** The contract rejects `[]`, so `members` declares a
  desktop (1440×900) and a mobile (390×844) loaded state. A render does not measure colour
  contrast; `pnpm test:contrast` does.

## Generated files that are not our tokens

`resolve-context.mjs` writes `.styleseed/palettes/members.css` and `members.json` from the
`keyColor` in `.styleseed/project.json`. They are committed because the manifest hashes them
and verification fails without them.

**The application does not use them.** They define `--ss-*` variables that nothing imports
(`knip.jsonc` lists the CSS as unused on purpose). `src/styles/globals.css` holds the only
live design tokens. Do not wire `--ss-*` into components, and do not treat those files as a
source of truth.

`.prettierignore` excludes `.styleseed/` and this file. A reformat of the generated files
changes their hashes and turns a clean scan into an SS000 contract error.

## Skills

**Core method:** `ss-setup` `ss-resolve` `ss-lint` `ss-score` `ss-a11y` `ss-audit`
`ss-verify` `ss-tokens` `ss-update`

**For new UI work:** `ss-component` `ss-pattern` `ss-page` `ss-review`

**Excluded:** `ss-build` (scaffolds a screen first; the screens exist) · `ss-studio`
(creative exploration) · `ss-reference` (the grammar is chosen) · `ss-restyle` (base-vega is
approved) · `ss-dial` (the lock fixes brand values) · `ss-motion` (the reduced-motion check
already passes) · `ss-copy` · `ss-flow` · `ss-feedback` (out of scope) · `styleseed` (the
meta-router; invoke skills directly)

## Enforcement

On demand, not in CI. StyleSeed publishes no npm package and its plugin installs outside the
repo, so wiring the scanner into CI would mean vendoring it and owning its updates. `eslint`,
`tsc`, Vitest, `jest-axe`, the Playwright `fixtures` project and the `nginx` project's
`@no-api` tests remain the CI gates (`.github/workflows/ci.yml`).

Run the deterministic tier with:

```bash
node "<styleseed>/skills/ss-score/scripts/styleseed-check.mjs" \
  scan --project-root . --artifact members --format json
```

The committed tree scans clean without a resolver step. The manifest's `sources` are
StyleSeed catalog entries (`catalog:core`, `built-in:operations-console`, and so on), not
project files, so editing `globals.css`, a component or this file does not invalidate it.

Re-run `resolve-context.mjs` only when an artifact's `selection`, its `implementation`
paths, `.styleseed/project.json` or the pinned engine version changes. It rewrites the
bundle, the manifest and the palette, so commit those together.

## Visual verification

`ss-verify` renders with Playwright at the `members` artifact's two viewports and scores what
source cannot show. Re-run it for a current visual score.

`pnpm test:e2e` runs the `fixtures` project in `e2e/fixtures/`. Its `members.test.ts` turns
the visual gate's findings into standing assertions: the webfont is loaded, nothing overflows
at 390px, and the empty and error states render as more than a bare header. A regression
fails a test instead of waiting for the next screenshot. CLAUDE.md's end-to-end section
holds the conventions.

## Accessibility

`jest-axe` asserts and stays in CI; it is authoritative. `ss-a11y` discovers per artifact,
and its findings become tests. One model, two instruments.
