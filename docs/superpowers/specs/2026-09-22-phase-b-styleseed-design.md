# Phase B — adopt StyleSeed's method, keep Base UI

Written 2026-09-22. Companion to `../decisions/2026-09-22-open-items.md` §8, which recorded
Phase B as blocked on one decision. This spec unblocks it and says what to build.

StyleSeed is pinned to **v4.2.0, commit `44475742e96ffa66d869274b0643042f5c6b47e9`**
(`github.com/bitjaru/styleseed`). Its README is already stale against its own repo and the
registry schema carries legacy-vs-v2 drift, so an unpinned adoption would move under us.

---

## 0. The recorded blocker was real but mis-framed

Open-items §8 said StyleSeed's 32 primitives are Radix-based and cannot co-own
`src/components/ui/` with Base UI. The 19 `@radix-ui/*` packages are real — they are declared
in `engine/scaffold/package.json`. That scaffold is a **fresh-project starter** (React 18,
Vite 6), not something an existing repo receives.

Measured against the pinned commit:

- `ss-lint`, `ss-score`, `ss-a11y`, `ss-verify` and `ss-setup` contain **zero** references to
  Radix or `engine/components`.
- `ss-component` instructs the agent to "read an existing nearby primitive (such as the
  project's button)" and says `src/components/ui/` "is a common layout, not" an assumption.
- `ss-pattern` says "compose the pattern from existing components — DO NOT recreate primitives."
- Nothing vendors `.engine/` into a host project. `demo-pricing/.engine/` is StyleSeed's own
  demo, materialised for that demo alone.

So adopting the method costs no primitives. **Option 1 in open-items §8 is not a compromise;
it is the intended use of the tool.** Option 2 (swap to StyleSeed's Radix primitives) is
rejected: React 18 / Vite 6 against our React 19 / Vite 8, and StyleSeed scopes that scaffold
to greenfield. Option 3 (run both) stays rejected on its original grounds.

**Ruling: Base UI owns `src/components/ui/` permanently.** StyleSeed contributes method,
rules and review — never components. Do not reopen this without new evidence.

## 1. The gate chain is two tiers

This is the fact that shapes everything below. `styleseed-check.mjs` contains **zero**
occurrences of the string "score". The 0–100 number comes from an agent applying the rubric in
`ss-score/SKILL.md`, which instructs it to "start at full marks and **subtract** for violations
*you find*".

| Tier | Contents | Machine-checkable |
| --- | --- | --- |
| Deterministic | `SS001`–`SS006`, plus contract / manifest / hash errors | Yes — `styleseed-check.mjs scan` |
| Agent-judged | `ss-score` (0–100), `ss-a11y`, `ss-audit`, `ss-verify` | No |

"Score ≥ 80" is therefore an acceptance ritual with attached evidence, never a CI assertion.

## 2. Enforcement: on demand, not in CI

**Decision: no CI wiring, nothing vendored.**

The alternative was rejected on cost. StyleSeed publishes no npm package (it has no root
`package.json`), and the Claude Code plugin declares `"skills": ["./engine/.claude/skills"]`,
landing in `~/.claude/plugins/cache/` — invisible to CI. Blocking CI would mean copying
`styleseed-check.mjs` and its five sibling modules into the repo and owning their updates, plus
maintaining a suppression list for the SS005 false positives documented in §7. That is a
standing maintenance cost for a rule set whose findings require reading rather than obeying.

The gate fires when invoked, by a human or an agent doing UI work. `jest-axe`, `eslint`,
`tsc` and Vitest remain the CI gates and are untouched by this spec.

## 3. Files this adds to the repo

Text only. The StyleSeed adoption itself adds no dependency. (`package.json` was later
modified once, when §9 was reversed and Playwright was added for the visual gate.)

| Path | Contents | Authored by | Committed |
| --- | --- | --- | --- |
| `STYLESEED.md` | The design lock: grammar, brand recipe, palette recipe, token alias table, pinned version, recorded exceptions | `ss-setup`, then hand-edited | Yes |
| `.styleseed/project.json` | Registry root | Hand-authored | Yes |
| `.styleseed/artifacts/index.json` | Artifact list | Hand-authored | Yes |
| `.styleseed/artifacts/<id>.json` | One per route | Hand-authored | Yes |
| `.styleseed/bundles/<id>.md` | Compiled effective rules | `resolve-context.mjs` | Yes |
| `.styleseed/manifests/<id>.json` | Hash manifest | `resolve-context.mjs` | Yes |
| `.styleseed/evidence/` | Screenshots, run records | Tools, locally | **No — gitignored** |

No script in `skills/*/scripts/` writes `project.json`. The registry is hand-authored; that is
the tool's design, not a gap being worked around.

`ss-setup` §9 scaffolds a first screen only "if the user asked for a first screen". It will not
touch the existing 22 primitives uninvited. Note that §9 emits the **legacy** pair
(`.styleseed/effective-rules.md` + `manifest.json`) while `styleseed-check.mjs scan` hard-fails
without the **registry** (`project.json` + `artifacts/index.json`); the registry must be authored
by hand regardless of whether `ss-setup` is run.

## 4. Skill adoption — all 23 classified

**Adopted, core method (9)**
`ss-setup` · `ss-resolve` · `ss-lint` · `ss-score` · `ss-a11y` · `ss-audit` · `ss-verify` ·
`ss-tokens` · `ss-update`

**Adopted for new UI work (4)**
`ss-component` · `ss-pattern` · `ss-page` · `ss-review`

**Excluded (10)**

| Skill | Why |
| --- | --- |
| `ss-build` | Its enforced loop scaffolds a screen first; our screens exist |
| `ss-studio` | Three-direction creative exploration — not what Phase B is for |
| `ss-reference` | Compiles screenshots/Figma into a grammar; we have a chosen grammar |
| `ss-restyle` | Re-skins an existing look; base-nova is the approved look |
| `ss-dial` | Tunes brand values; the lock fixes them |
| `ss-motion` | Motion library authoring; Phase A's reduced-motion path already passes SS004 |
| `ss-copy` | UX writing; out of scope |
| `ss-flow` | Multi-screen flow design; out of scope |
| `ss-feedback` | Feedback-state generation; out of scope |
| `styleseed` | Meta-router; we invoke skills directly |

Recorded so that "why didn't we use `/ss-studio`" has an answer on file.

## 5. The artifact registry

One artifact per route, `validation.scoreFloor: 80`. `src/components/ui` appears in
`sourceRoots` so the primitives are genuinely covered by the scan.

```json
{
  "schemaVersion": 1,
  "id": "members",
  "target": { "kind": "route", "locator": "/$slug/members" },
  "selection": {
    "grammar": "operations-console",
    "adapter": null, "domain": null, "page": "detail",
    "recipe": null, "palette": null, "profile": null, "fallback": null
  },
  "decisions": {
    "primaryDecision": "Who has access to this tenant, and at what role?",
    "primaryAction": "Change a member's role",
    "signatureMove": "Keep the member list readable while a role change is in flight."
  },
  "implementation": {
    "sourceRoots": [
      "src/pages/$slug.members.tsx",
      "src/components/ui",
      "src/components/features"
    ],
    "tokenFiles": ["src/styles/globals.css"]
  },
  "validation": {
    "scoreFloor": 80,
    "requiredRenders": [
      { "id": "desktop-loaded", "state": "loaded", "viewport": { "width": 1440, "height": 900 } },
      { "id": "mobile-loaded", "state": "loaded", "viewport": { "width": 390, "height": 844 } }
    ],
    "temporal": { "required": false, "scenarios": [] },
    "humanAcceptance": false
  }
}
```

`src/styles/globals.css` **must** be listed in `tokenFiles`. It is not auto-detected —
`isTokenOrThemeFile` matches on `tokens|theme|themes` path segments, and `styles/globals.css`
matches none of them. It produced zero `SS001` findings only because base-nova is written in
`oklch()` rather than hex. A future hex value there would be reported unless it is registered.

`requiredRenders` **cannot** be empty — `normalizeArtifact` rejects `[]`, and `validation` also
requires `temporal` and `humanAcceptance`. Both renders above were captured on 2026-09-22; see
§9 and `../decisions/2026-09-22-phase-b-evidence.md`.

## 6. Token bridge — alias, add nothing

base-nova is declared the approved token set in `STYLESEED.md`. StyleSeed's semantic roles map
onto it:

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

`semantic/success`, `semantic/warning` and `semantic/info` are **deliberately absent**. Phase A
renders no status colour and contains zero ad-hoc palette classes — a grep for
`(text|bg|border)-(green|red|amber|yellow|blue|emerald|orange)-[0-9]{3}` across `src/**/*.tsx`
returns nothing. Adding three role pairs across light and dark themes for a consumer that does
not exist is speculative work.

The lock records the rule for when one is first needed: **add the token, never reach for
`green-500`.**

Renaming base-nova's variables to StyleSeed's vocabulary was rejected — it is a sweeping rename
through code Phase A just shipped, it breaks the shadcn upgrade path, and the alias table buys
the same alignment for nothing.

## 7. The cleanup — 13 findings

Measured by running the pinned detectors directly over 76 source files. Every genuine finding
is inherited shadcn/base-nova idiom; **application code produced none.**

### SS003 `transition-all` (5) — fix

`tabs.tsx:58` · `switch.tsx:16` · `sidebar.tsx:290` · `badge.tsx:7` · `button.tsx:6`

Name the transitioned properties explicitly. These are genuine: `transition-all` animates every
animatable property, including ones that change for unrelated reasons.

### SS002 arbitrary pixel values (8) — fix or record

Tailwind 4's spacing scale is `--spacing: 0.25rem` (the default — `globals.css` does not
override it), so `N` → `N × 4px`. Each value was checked against it:

| Location | Value | Scale equivalent | Disposition |
| --- | --- | --- | --- |
| `sidebar.tsx:290` | `w-[2px]` | `w-0.5` = 2px — **exact** | **Fix** |
| `dropdown-menu.tsx:137` | `min-w-[96px]` | `min-w-24` = 96px — **exact** | **Fix** |
| `tabs.tsx:24` | `p-[3px]` | `p-0.5` = 2px / `p-1` = 4px — no exact step | **Exception** |
| `tabs.tsx:61` | `bottom-[-5px]` | `-bottom-1` = −4px / `-bottom-1.5` = −6px — no exact step | **Exception** |
| `switch.tsx:16` | `h-[18.4px]`, `w-[32px]`, `h-[14px]`, `w-[24px]` | fractional / control geometry | **Exception** |

Only two of the eight have an exact scale equivalent, and only those two are edited. The rule
exists to prevent *unintentional* drift; `p-[3px]` and `bottom-[-5px]` are deliberate optical
adjustments, and `switch.tsx`'s four are Base UI's measured thumb-and-track geometry, with
`h-[18.4px]` fractional on purpose. Rounding any of them to the nearest step changes how the
control renders. **Appearance wins over rule compliance** — the six become documented
exceptions in `STYLESEED.md`, not edits.

### SS005 focus suppression (10 reported, 5 to examine)

**Detector false positives (5)** — `outline-none` paired with a `focus-visible:` replacement in
the same class string: `switch.tsx:16`, `button.tsx:6`, `input.tsx:11`, `select.tsx:43`,
`textarea.tsx:9`.

**One genuine defect (1)** — `tabs.tsx:73`. `TabsPrimitive.Panel` renders
`tabIndex: open ? 0 : -1` (`@base-ui/react@1.8.0`, `tabs/panel/TabsPanel.js:76`), so an open
tab panel **is** keyboard-focusable and currently has its focus indicator removed with nothing
put back. This is a real WCAG 2.4.7 failure that the detector found correctly, and it is fixed.

**Non-focusable containers (4)** — `alert-dialog.tsx:55`, `dialog.tsx:56`,
`dropdown-menu.tsx:35`, `dropdown-menu.tsx:43`. None of `DialogPopup`, `AlertDialogPopup`,
`MenuPopup` or `MenuPositioner` sets `tabIndex` at all, so none is tab-reachable; they receive
focus only programmatically, and a visible ring around an entire dialog or menu surface is not
wanted. Recorded as exceptions.

This is the payoff for reading findings rather than obeying them: of ten reported, five are
detector false positives, four are correct-but-inapplicable, and one is a real accessibility
bug that 243 tests and ten reviews had not caught.

### Test safety

These are className edits inside components covered by 243 tests. Run
`pnpm lint && pnpm typecheck && pnpm test` after **each file**, not once at the end. A
`transition-all` rewrite that breaks a snapshot should be caught against one changed file.

## 8. Accessibility ownership

One model, two instruments.

- **`jest-axe` asserts.** It stays in CI, stays authoritative, and remains the thing that can
  fail a build. Nothing in this spec changes it.
- **`ss-a11y` discovers.** A manual WCAG 2.2 AA review run per artifact. Its findings become
  tests; they do not become a second gate.

`ss-a11y`'s first assignment is open-items §3: no opened dropdown is axe-checked anywhere. A
page-crashing bug (`DropdownMenuLabel` outside a `Menu.Group`) lived in exactly that blind spot
through 234 passing tests. Bring the four opened menus into the axe overlay block — the
notification bell, the tenant switcher, the user menu, the theme toggle.

## 9. Scope boundary

**Playwright was out of scope, and that was reversed on 2026-09-22.** The original reasoning
was that `ss-verify` degrades gracefully — "no way to render at all (no browser, no Playwright,
headless blocked) → say so" — and that installing it pulls in open-items §1. The first half was
sound; the second was a conflation. Rendering the members route needs a browser and fixtures,
not a live backend, so the visual gate and open-items §1 are separable after all.

Playwright 1.63.0 is now a devDependency and the gate has been run. It is **not** wired into
CI. Open-items §1 remains untouched — the harness mocks the API and cannot speak to session
persistence, SSE reconnection or `X-Forwarded-Proto`. Findings and renders:
`../decisions/2026-09-22-phase-b-evidence.md`.

**Out of scope:** CI enforcement (§2), new design tokens (§6), any change to
`src/components/ui/`'s ownership (§0), and the ten excluded skills (§4).

## 10. Accepted limits

- **`SS005` has a ~50% false-positive rate on this codebase.** Its message claims "without a
  detected replacement" but its regex performs no replacement detection. Findings are read,
  not obeyed.
- **`isTokenOrThemeFile` silently skips real code.** `src/components/features/theme-toggle.tsx`
  and `src/states/theme.store.ts` match its `theme[.-]` pattern and are never scanned.
  `tokenFiles` adds to the skip set rather than whitelisting into the scan set, so this cannot
  be fixed from our side. Those two files are reviewed by hand.
- **`SS001` fires on HTML entities.** `&#9679;` in `notification-bell.tsx:101` — an
  `aria-hidden` decorative bullet — is reported as a hardcoded colour. Not a defect in our code.
- **The score is judgment.** Evidence attaches to it; the number itself is an agent's verdict.
- **Rules will move.** The pin in §0 is what makes a future `ss-update` a reviewable diff
  rather than a silent change.

## 11. Acceptance

Done when all of the following hold:

1. `STYLESEED.md` is committed, carrying the alias table (§6), the pinned version (§0), the
   recorded exceptions (§7), and the skill classification (§4).
2. `.styleseed/project.json` and `.styleseed/artifacts/index.json` exist and are valid, with at
   least one route artifact whose `sourceRoots` includes `src/components/ui`.
3. `.styleseed/evidence/` is gitignored.
4. `styleseed-check.mjs scan --project-root . --artifact <id> --format json` runs without an
   `SS000` contract error, and reports only findings recorded as exceptions in `STYLESEED.md`.
5. The five `SS003` findings are fixed; the four non-switch `SS002` findings are fixed or
   recorded; the five unpaired `SS005` findings are each resolved or recorded.
6. The four opened menus (notification bell, tenant switcher, user menu, theme toggle) are
   covered by the jest-axe overlay block, closing open-items §3.
7. `pnpm lint && pnpm typecheck && pnpm test` pass, with no fewer than 243 tests green.
8. One artifact has been scored by `ss-score` at ≥ 80 with its evidence attached.

Acceptance is not "setup ran".
