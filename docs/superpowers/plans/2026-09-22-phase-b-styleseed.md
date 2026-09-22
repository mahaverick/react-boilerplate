# Phase B — StyleSeed Method Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt StyleSeed's design-method layer (lock, registry, on-demand gates) into react-boilerplate while Base UI keeps sole ownership of `src/components/ui/`, and clear the findings its deterministic detectors report.

**Architecture:** Text-only adoption — a `STYLESEED.md` design lock plus a hand-authored `.styleseed/` registry, no npm dependency and no CI wiring. The deterministic tier (`SS001`–`SS006`) runs on demand via StyleSeed's `styleseed-check.mjs`; the agent-judged tier (`ss-score`, `ss-a11y`) runs per artifact. Three source fixes follow from findings that were verified against Base UI's actual source, not assumed.

**Tech Stack:** React 19, Vite 8, Tailwind 4 (`--spacing: 0.25rem` default), TypeScript ~6.0.3, Base UI `@base-ui/react@1.8.0` on shadcn `base-nova`, Vitest 5, jest-axe, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-22-phase-b-styleseed-design.md`

## Global Constraints

- **Base UI owns `src/components/ui/` permanently.** StyleSeed contributes method, rules and review — never components. No `@radix-ui/*` package is added.
- **No dependency is added.** `package.json` is not modified by this plan. Playwright is explicitly out of scope.
- **No CI wiring.** `eslint`, `tsc`, Vitest and jest-axe remain the CI gates, unchanged.
- **StyleSeed is pinned to v4.2.0, commit `44475742e96ffa66d869274b0643042f5c6b47e9`.**
- **Scanner location:** a clone at `$SS` — set `SS=/private/tmp/claude-501/-Users-abhijeet-Mahaverick/7a20c39c-6154-4b16-952e-acd4a540259f/scratchpad/styleseed`. If absent, re-clone: `git clone --depth 1 https://github.com/bitjaru/styleseed.git "$SS"`.
- **Baseline is 28 test files / 243 tests, all passing** (measured 2026-09-22, 13.9s). Final count must be ≥ 243 with zero failures.
- **Verification after every file edit:** `pnpm lint && pnpm typecheck && pnpm test --run`. Not once at the end.
- **Branch:** `feat/phase-b-styleseed-method`, already created off `main` at `5e634c6`.
- **Commit trailer** on every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017YD2VpVGPXFNkCuKHKuCi2
  ```

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `STYLESEED.md` | Design lock: grammar, token alias table, pinned version, recorded exceptions, skill classification | 1 |
| `.styleseed/project.json` | Registry root | 1 |
| `.styleseed/artifacts/index.json` | Artifact list | 1 |
| `.styleseed/artifacts/members.json` | The one route artifact | 1 |
| `.gitignore` | Add `.styleseed/evidence/` | 1 |
| `src/components/ui/{tabs,switch,sidebar,badge,button}.tsx` | `transition-all` → named properties | 2 |
| `src/components/ui/{sidebar,dropdown-menu}.tsx` | Two exact-match spacing fixes | 3 |
| `src/components/ui/tabs.tsx` | Focus indicator on the focusable tab panel | 4 |
| `src/components/ui/tabs.test.tsx` | Test for the above | 4 |
| `src/tests/a11y.test.tsx` | Opened-menu axe coverage (open-items §3) | 5 |

---

### Task 1: The lock and the registry

Nothing in this task touches source code. It creates the text that makes every later task's scan possible — `styleseed-check.mjs scan` hard-fails with `SS000` until the registry exists.

**Files:**
- Create: `STYLESEED.md`
- Create: `.styleseed/project.json`
- Create: `.styleseed/artifacts/index.json`
- Create: `.styleseed/artifacts/members.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: artifact id `members`, scannable via `node "$SS/skills/ss-score/scripts/styleseed-check.mjs" scan --project-root . --artifact members --format json`. Tasks 2–4 and 6 all depend on this command running without an `SS000` error.

- [ ] **Step 1: Confirm the scanner currently fails, so you know the registry is what fixes it**

```bash
cd /Users/abhijeet/Mahaverick/react-boilerplate
SS=/private/tmp/claude-501/-Users-abhijeet-Mahaverick/7a20c39c-6154-4b16-952e-acd4a540259f/scratchpad/styleseed
node "$SS/skills/ss-score/scripts/styleseed-check.mjs" scan --project-root . --all --format json
```

Expected: a finding with `"id": "SS000"` and `"message": "StyleSeed registry is missing."`

- [ ] **Step 2: Create `.styleseed/project.json`**

```json
{
  "schemaVersion": 1,
  "name": "react-boilerplate",
  "defaults": {
    "agent": "claude",
    "grammar": "operations-console",
    "scoreFloor": 80
  },
  "lock": "STYLESEED.md"
}
```

- [ ] **Step 3: Create `.styleseed/artifacts/members.json`**

`sourceRoots` includes `src/components/ui` deliberately — the primitives are inside the gate. `tokenFiles` must list `globals.css` explicitly; it is not auto-detected, because `isTokenOrThemeFile` matches only `tokens|theme|themes` path segments and `styles/globals.css` matches none.

```json
{
  "schemaVersion": 1,
  "id": "members",
  "target": { "kind": "route", "locator": "/$slug/members" },
  "selection": {
    "grammar": "operations-console",
    "adapter": null,
    "domain": null,
    "page": "detail",
    "recipe": null,
    "palette": null,
    "profile": null,
    "fallback": null
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
  "validation": { "scoreFloor": 80, "requiredRenders": [] }
}
```

If `src/pages/$slug.members.tsx` does not exist at that exact path, run `ls src/pages/` and use the real filename — do not invent one.

- [ ] **Step 4: Create `.styleseed/artifacts/index.json`**

```json
{
  "schemaVersion": 1,
  "artifacts": [
    { "id": "members", "path": "members.json" }
  ]
}
```

- [ ] **Step 5: Gitignore the evidence directory**

Evidence is screenshots and local run records — it does not belong in git.

```bash
printf '\n# StyleSeed local evidence (screenshots, run records)\n.styleseed/evidence/\n' >> .gitignore
```

- [ ] **Step 6: Create `STYLESEED.md`**

This is the design lock. Every section below is required — the exceptions table is what stops Tasks 3 and 4 from being re-litigated later.

````markdown
# StyleSeed design lock — react-boilerplate

StyleSeed is pinned to **v4.2.0, commit `44475742e96ffa66d869274b0643042f5c6b47e9`**.
Rules move; an unpinned adoption would change under us. Upgrades go through `/ss-update`
and are reviewed as a diff.

Design spec: `docs/superpowers/specs/2026-09-22-phase-b-styleseed-design.md`

## Ownership

**Base UI (`@base-ui/react`) owns `src/components/ui/` permanently.** StyleSeed contributes
method, rules and review — never components. Its 32 Radix primitives and its Vite 6 / React 18
scaffold are not used and must not be introduced. Do not reopen without new evidence.

## Selection

- Output grammar: `operations-console`
- Page type: `detail`
- Brand recipe / palette recipe / profile: none — `base-nova` is the approved visual system
- Score floor: 80

## Approved tokens

`src/styles/globals.css` is the single token file. It is written in `oklch()`, not hex.
Tailwind 4 spacing base is the default `--spacing: 0.25rem`.

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
| SS002 | `ui/tabs.tsx:24` | `p-[3px]` | Optical inset; scale offers 2px or 4px, neither matches |
| SS002 | `ui/tabs.tsx:61` | `bottom-[-5px]` | Optical underline offset; scale offers −4px or −6px |
| SS002 | `ui/switch.tsx:16` | `h-[18.4px]` `w-[32px]` `h-[14px]` `w-[24px]` | Base UI thumb/track geometry; `18.4px` is fractional on purpose |
| SS005 | `ui/alert-dialog.tsx:55` | `outline-none` | `AlertDialogPopup` sets no `tabIndex`; not tab-reachable |
| SS005 | `ui/dialog.tsx:56` | `outline-none` | `DialogPopup` sets no `tabIndex`; not tab-reachable |
| SS005 | `ui/dropdown-menu.tsx:35` | `outline-none` | `MenuPositioner` is a wrapper; not tab-reachable |
| SS005 | `ui/dropdown-menu.tsx:43` | `outline-none` | `MenuPopup` sets no `tabIndex`; not tab-reachable |
| SS001 | `features/notification-bell.tsx:101` | `&#9679;` | HTML entity for a decorative `aria-hidden` bullet, not a colour |

## Known detector limits

- **SS005 has a ~50% false-positive rate here.** Its message claims "without a detected
  replacement" but its regex performs no replacement detection. Read findings; do not obey them.
- **`isTokenOrThemeFile` silently skips real code.** `src/components/features/theme-toggle.tsx`
  and `src/states/theme.store.ts` match its `theme[.-]` pattern and are never scanned.
  `tokenFiles` adds to the skip set rather than whitelisting into it, so this cannot be fixed
  from our side. Review those two by hand.
- **The 0–100 score is an agent verdict**, not a computed number. `styleseed-check.mjs`
  contains no scoring. Evidence attaches to the score; the number is judgment.

## Skills

**Adopted, core method:** `ss-setup` `ss-resolve` `ss-lint` `ss-score` `ss-a11y` `ss-audit`
`ss-verify` `ss-tokens` `ss-update`

**Adopted for new UI work:** `ss-component` `ss-pattern` `ss-page` `ss-review`

**Excluded:** `ss-build` (scaffolds a screen first; ours exist) · `ss-studio` (creative
exploration) · `ss-reference` (we have a chosen grammar) · `ss-restyle` (base-nova is approved)
· `ss-dial` (the lock fixes brand values) · `ss-motion` (reduced-motion already passes SS004) ·
`ss-copy` · `ss-flow` · `ss-feedback` (all out of scope) · `styleseed` (meta-router; we invoke
skills directly)

## Accessibility

`jest-axe` asserts and stays in CI — it is authoritative. `ss-a11y` discovers, per artifact,
and its findings become tests. One model, two instruments.
````

- [ ] **Step 7: Verify the registry is valid and the scan now runs**

```bash
node "$SS/skills/ss-score/scripts/styleseed-check.mjs" scan --project-root . --artifact members --format json
```

Expected: **no** `SS000` finding. You should see `SS002`/`SS003`/`SS005` warnings — those are Tasks 2–4. If you get a different hard error, fix the registry JSON before proceeding; do not continue with a broken contract.

- [ ] **Step 8: Verify nothing was broken**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: lint clean, typecheck clean, 243 tests passing.

- [ ] **Step 9: Commit**

```bash
git add STYLESEED.md .styleseed .gitignore
git commit -m "$(cat <<'EOF'
feat: add the StyleSeed design lock and artifact registry

Text only - no dependency, no CI wiring. The registry is hand-authored
because no script in StyleSeed writes project.json, and the scanner hard
-fails without it. globals.css is listed in tokenFiles explicitly since
isTokenOrThemeFile does not match styles/globals.css.

Records Base UI's permanent ownership of src/components/ui/, the token
alias table, and the exceptions that later passes must not "fix".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017YD2VpVGPXFNkCuKHKuCi2
EOF
)"
```

---

### Task 2: Replace `transition-all` with named properties

`transition-all` animates every animatable property, including ones that change for unrelated reasons — a layout shift elsewhere can drag an unintended transition through these components. Five occurrences, each in a different file.

**Files:**
- Modify: `src/components/ui/tabs.tsx:58`
- Modify: `src/components/ui/switch.tsx:16`
- Modify: `src/components/ui/sidebar.tsx:290`
- Modify: `src/components/ui/badge.tsx:7`
- Modify: `src/components/ui/button.tsx:6`

**Interfaces:**
- Consumes: the registry from Task 1.
- Produces: zero `SS003` findings. No exported signature changes — these are className edits only.

- [ ] **Step 1: Confirm the five findings exist**

```bash
grep -rn "transition-all" src --include="*.tsx"
```

Expected: exactly 5 lines — `tabs.tsx:58`, `switch.tsx:16`, `sidebar.tsx:290`, `badge.tsx:7`, `button.tsx:6`.

- [ ] **Step 2: Fix `button.tsx:6`**

What actually transitions here: background on `hover:bg-primary/80`, border and ring on `focus-visible:`/`aria-invalid:`, and `transform` on `active:not-aria-[haspopup]:translate-y-px`.

Replace `transition-all` with:

```
transition-[color,background-color,border-color,box-shadow,transform]
```

- [ ] **Step 3: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: all green, 243 passing.

- [ ] **Step 4: Fix `badge.tsx:7`**

Transitions here: border and ring on `focus-visible:`/`aria-invalid:`, plus variant colour changes.

Replace `transition-all` with:

```
transition-[color,background-color,border-color,box-shadow]
```

- [ ] **Step 5: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

- [ ] **Step 6: Fix `switch.tsx:16`**

Transitions here: `data-checked:bg-primary` / `data-unchecked:bg-input`, border and ring on focus and invalid states. The thumb has its own transition; this is the track.

Replace `transition-all` with:

```
transition-[background-color,border-color,box-shadow]
```

- [ ] **Step 7: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

- [ ] **Step 8: Fix `tabs.tsx:58`**

Transitions here: `text-foreground/60` → `hover:text-foreground`, `data-active:bg-background`, border and ring on `focus-visible:`, and `shadow-sm` on active. Note the `after:transition-opacity` later in the same class list is separate and stays as it is.

Replace `transition-all` with:

```
transition-[color,background-color,border-color,box-shadow]
```

- [ ] **Step 9: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

- [ ] **Step 10: Fix `sidebar.tsx:290`**

This is the drag rail. What moves: its `right`/`left` offset via `group-data-[side=*]` and its `translate-x`. The `hover:after:bg-sidebar-border` is on a pseudo-element and is not inherited from the parent's transition, so do not list background here. Keep `ease-linear` exactly where it is.

Replace `transition-all ease-linear` with:

```
transition-[right,left,transform] ease-linear
```

- [ ] **Step 11: Verify the whole SS003 class is gone**

```bash
grep -rn "transition-all" src --include="*.tsx" || echo "SS003 clear"
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: `SS003 clear`, and 243 tests passing.

- [ ] **Step 12: Commit**

```bash
git add src/components/ui/
git commit -m "$(cat <<'EOF'
fix: name the transitioned properties instead of transition-all

transition-all animates every animatable property, so an unrelated layout
change can drag an unintended transition through these five components.
Each now lists what it actually animates.

The sidebar rail omits background deliberately: hover:after:bg-sidebar-border
is on a pseudo-element and does not inherit the parent's transition.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017YD2VpVGPXFNkCuKHKuCi2
EOF
)"
```

---

### Task 3: The two spacing values that have exact token equivalents

Tailwind 4's scale is `--spacing: 0.25rem`, so `N` → `N × 4px`. Only two of the eight `SS002` findings land exactly on a step. The other six are recorded exceptions in `STYLESEED.md` and **must not be touched** — rounding them changes how the controls render.

**Files:**
- Modify: `src/components/ui/sidebar.tsx:290`
- Modify: `src/components/ui/dropdown-menu.tsx:137`

**Interfaces:**
- Consumes: the registry from Task 1. Note `sidebar.tsx:290` was already edited in Task 2 — this is a second, independent change on the same line.
- Produces: `SS002` reduced from 8 findings to the 6 recorded exceptions.

- [ ] **Step 1: Confirm the eight findings and their values**

```bash
grep -rnoE "\b(p|m|gap|space-[xy]|inset|top|right|bottom|left|w|h|min-w|max-w|min-h|max-h)-[^ \"']*\[[^]]*px\]" src --include="*.tsx"
```

Expected: 8 lines. `w-[2px]` in `sidebar.tsx:290` and `min-w-[96px]` in `dropdown-menu.tsx:137` are the two you change. The four in `switch.tsx:16` and the two in `tabs.tsx` (`p-[3px]`, `bottom-[-5px]`) are exceptions — leave them.

- [ ] **Step 2: Fix `sidebar.tsx:290`**

`w-0.5` is `0.125rem` = 2px — identical rendering, no arbitrary value.

Change `after:w-[2px]` to:

```
after:w-0.5
```

- [ ] **Step 3: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: 243 passing.

- [ ] **Step 4: Fix `dropdown-menu.tsx:137`**

`min-w-24` is `6rem` = 96px — identical rendering.

Change `min-w-[96px]` to:

```
min-w-24
```

- [ ] **Step 5: Verify, and confirm exactly six arbitrary values remain**

```bash
grep -rnoE "\b(p|m|gap|space-[xy]|inset|top|right|bottom|left|w|h|min-w|max-w|min-h|max-h)-[^ \"']*\[[^]]*px\]" src --include="*.tsx" | wc -l
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: `6`, and 243 tests passing. If the count is not 6, you changed something you should not have — check it against the exceptions table in `STYLESEED.md`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/sidebar.tsx src/components/ui/dropdown-menu.tsx
git commit -m "$(cat <<'EOF'
fix: use scale steps for the two spacings that have exact equivalents

w-0.5 is 2px and min-w-24 is 96px on Tailwind 4's default 0.25rem base, so
both render identically without an arbitrary value.

The other six arbitrary pixel values stay. p-[3px] and bottom-[-5px] are
optical adjustments with no matching step, and switch.tsx's four are Base
UI's thumb/track geometry with h-[18.4px] fractional on purpose. All six
are recorded in STYLESEED.md so a later pass does not "fix" them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017YD2VpVGPXFNkCuKHKuCi2
EOF
)"
```

---

### Task 4: Give the focusable tab panel a focus indicator

This is the one genuine accessibility defect the detector found. `TabsPrimitive.Panel` renders `tabIndex: open ? 0 : -1` (`@base-ui/react@1.8.0`, `tabs/panel/TabsPanel.js:76`), so an open panel is keyboard-reachable — and `tabs.tsx:73` removes its focus outline with nothing in its place. That is a WCAG 2.4.7 failure that 243 tests and ten reviews did not catch.

The other four `SS005` findings are exceptions: `DialogPopup`, `AlertDialogPopup`, `MenuPopup` and `MenuPositioner` set no `tabIndex` at all.

**Files:**
- Modify: `src/components/ui/tabs.tsx:73`
- Test: `src/components/ui/tabs.test.tsx`

**Interfaces:**
- Consumes: the registry from Task 1.
- Produces: no signature change. `TabsContent` keeps its existing props; only its default className grows.

- [ ] **Step 1: Confirm the panel really is focusable, rather than trusting this plan**

```bash
P="node_modules/.pnpm/@base-ui+react@1.8.0_@types+react@19.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@base-ui/react"
grep -n "tabIndex" "$P/tabs/panel/TabsPanel.js"
```

Expected: `tabIndex: open ? 0 : -1`. If this does not match, stop — the premise of this task has changed and the finding may be an exception after all.

- [ ] **Step 2: Write the failing test**

Append to `src/components/ui/tabs.test.tsx`. Match the import style already used at the top of that file; if it imports from `@/components/ui/tabs`, keep that.

```tsx
it('gives the focusable panel a visible focus indicator', () => {
  render(
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
      </TabsList>
      <TabsContent value="one">Panel body</TabsContent>
    </Tabs>
  )

  const panel = screen.getByText('Panel body')

  // Base UI makes an open panel keyboard-reachable, so removing the outline
  // without a replacement is a WCAG 2.4.7 failure.
  expect(panel).toHaveAttribute('tabindex', '0')
  expect(panel.className).toMatch(/focus-visible:/)
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm test --run src/components/ui/tabs.test.tsx
```

Expected: FAIL on the second assertion — the className has `outline-none` but no `focus-visible:` rule.

- [ ] **Step 4: Fix `tabs.tsx:73`**

Keep `outline-none` — it suppresses the UA outline — and add a ring that matches how every other focusable primitive in this codebase indicates focus (`button.tsx` and `switch.tsx` both use `focus-visible:ring-3 focus-visible:ring-ring/50`).

Change:

```tsx
className={cn("flex-1 text-sm outline-none", className)}
```

to:

```tsx
className={cn(
  "flex-1 rounded-md text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
  className
)}
```

`rounded-md` is included so the ring follows the panel's corners rather than boxing a square around rounded content.

- [ ] **Step 5: Run the test and watch it pass**

```bash
pnpm test --run src/components/ui/tabs.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Verify the whole suite and confirm four SS005 sites remain**

```bash
grep -rn "outline-none" src --include="*.tsx" | grep -v "focus-visible:" | wc -l
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: `4` (the recorded dialog/alert-dialog/dropdown-menu exceptions), and 244 tests passing — the baseline 243 plus the one you just added.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/tabs.tsx src/components/ui/tabs.test.tsx
git commit -m "$(cat <<'EOF'
fix: restore the focus indicator on the focusable tab panel

Base UI renders Tabs.Panel with tabIndex 0 while open, so it is keyboard
-reachable, but the panel suppressed its outline with no replacement - a
WCAG 2.4.7 failure that 243 tests and ten reviews had not caught. It now
carries the same focus-visible ring the other focusable primitives use.

The remaining four outline-none sites are non-focusable containers: none of
DialogPopup, AlertDialogPopup, MenuPopup or MenuPositioner sets tabIndex.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017YD2VpVGPXFNkCuKHKuCi2
EOF
)"
```

---

### Task 5: Bring the opened menus into the axe gate

Open-items §3: the a11y gate's overlay block covers a dialog and a sheet, but no open menu. That blind spot hid a page-crashing bug — `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and throws outside a `Menu.Group`, replacing the whole app with the root error boundary on every authenticated route, through 234 passing tests. This closes the gap for the four menus that exist.

**Files:**
- Modify: `src/tests/a11y.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: four axe assertions over opened menus.

- [ ] **Step 1: Read what the existing overlay block does**

```bash
sed -n '1,80p' src/tests/a11y.test.tsx
```

You need its imports, its render helper, how it awaits `axe(container)`, and how the existing dialog and sheet cases open their overlay. **Follow that shape exactly** — do not invent a new helper. If the file is not at this path, find it: `grep -rln "jest-axe" src/`.

- [ ] **Step 2: Write the four failing tests**

Adapt the skeleton below to the file's actual helper names and component imports. The essential part is that each menu is **opened** before `axe` runs — a closed menu renders no popup and asserts nothing.

```tsx
describe('opened menus', () => {
  it.each([
    ['notification bell', /notifications/i],
    ['tenant switcher', /switch tenant/i],
    ['user menu', /account/i],
    ['theme toggle', /theme/i],
  ])('has no axe violations when the %s menu is open', async (_name, trigger) => {
    const { container } = renderWithProviders(<AppShell />)

    await userEvent.click(screen.getByRole('button', { name: trigger }))
    await screen.findByRole('menu')

    expect(await axe(container)).toHaveNoViolations()
  })
})
```

The accessible names in the second column are guesses — replace each with the real one. Find them by grepping the components for their trigger labels:

```bash
grep -rn "aria-label\|sr-only" src/components/features/notification-bell.tsx src/components/features/theme-toggle.tsx
grep -rln "DropdownMenuTrigger" src/components/
```

- [ ] **Step 3: Run them and see what happens**

```bash
pnpm test --run src/tests/a11y.test.tsx
```

Expect failures first — most likely "unable to find role button with name …" because the accessible names differ. Fix the names from the grep output until each test opens its menu. A test that passes without ever finding a `menu` role is asserting nothing; confirm `findByRole('menu')` resolves.

- [ ] **Step 4: Fix any real violations axe reports**

If axe reports a violation, that is the gate doing its job — fix the component, not the test. If it reports none, the tests still have value: they are the regression guard that the crash class stays closed.

- [ ] **Step 5: Verify the full suite**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: 248 tests passing (244 after Task 4, plus these four), zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/tests/a11y.test.tsx
git commit -m "$(cat <<'EOF'
test: axe-check the four opened menus

Closes open-items section 3. The overlay block covered a dialog and a sheet
but no open menu, and that blind spot once hid a page-crashing bug through
234 passing tests: DropdownMenuLabel is Base UI's Menu.GroupLabel and throws
outside a Menu.Group.

Covers the notification bell, tenant switcher, user menu and theme toggle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017YD2VpVGPXFNkCuKHKuCi2
EOF
)"
```

---

### Task 6: Scan, score, and record the evidence

The acceptance gate. Everything before this was changes; this is the proof they add up.

**Files:**
- Create: `docs/superpowers/decisions/2026-09-22-phase-b-evidence.md`
- Modify: `STYLESEED.md` (only if the scan disagrees with its exceptions table)

**Interfaces:**
- Consumes: all of Tasks 1–5.
- Produces: the evidence record that satisfies spec §11.

- [ ] **Step 1: Run the deterministic scan**

```bash
SS=/private/tmp/claude-501/-Users-abhijeet-Mahaverick/7a20c39c-6154-4b16-952e-acd4a540259f/scratchpad/styleseed
node "$SS/skills/ss-score/scripts/styleseed-check.mjs" scan --project-root . --artifact members --format json > /tmp/ss-scan.json
cat /tmp/ss-scan.json
```

- [ ] **Step 2: Reconcile every remaining finding against the exceptions table**

```bash
node -e '
const r = require("/tmp/ss-scan.json");
const f = r.artifacts.flatMap(a => a.findings);
console.log("total:", f.length);
const by = {};
for (const x of f) (by[x.id] ??= []).push(`${x.file}:${x.line} ${x.evidence}`);
for (const [id, list] of Object.entries(by)) { console.log(`\n${id} (${list.length})`); list.forEach(l => console.log("  " + l)); }
'
```

Expected: zero `SS000` and zero `SS003`. Every `SS001`, `SS002` and `SS005` finding must appear in `STYLESEED.md`'s exceptions table. If one does not, either it is a real problem you missed — fix it — or the table is incomplete — add it with a stated reason. **Do not close this task with an unexplained finding.**

- [ ] **Step 3: Run the agent-judged score**

Apply the rubric in `$SS/skills/ss-score/SKILL.md` to the members route. This is a judgment, not a command — read the rubric's categories and deduct honestly. Record the category breakdown, not just the total.

Remember the score is an agent verdict; `styleseed-check.mjs` computes nothing. A number without a breakdown is not evidence.

- [ ] **Step 4: Write the evidence record**

Create `docs/superpowers/decisions/2026-09-22-phase-b-evidence.md` containing:

- the exact scan command and its date
- the total finding count and the per-rule breakdown from Step 2
- a line per remaining finding mapping it to its `STYLESEED.md` exception
- the `ss-score` total **and** category breakdown from Step 3
- the test count before (243) and after
- explicitly: that `ss-verify` was **not** run, because Playwright is out of scope per spec §9

- [ ] **Step 5: Final full verification**

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
```

Expected: all four clean. `pnpm build` is included because this is the last task — a className change cannot break a build, but a stray edit can.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/decisions/2026-09-22-phase-b-evidence.md STYLESEED.md
git commit -m "$(cat <<'EOF'
docs: record the Phase B gate evidence

The scan, the score with its category breakdown, and a line per remaining
finding mapping it to its recorded exception. Notes that ss-verify did not
run: Playwright is out of scope, so no rendered check was made and the
score stands on code review alone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017YD2VpVGPXFNkCuKHKuCi2
EOF
)"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §0 Base UI ownership ruling | 1 (`STYLESEED.md` → Ownership) |
| §1 Two-tier gate | 1 (Known detector limits), 6 (steps 1 and 3 are the two tiers) |
| §2 On demand, not CI | 1 — no CI file is touched anywhere in this plan |
| §3 Files added | 1 |
| §4 Skill adoption, all 23 | 1 (`STYLESEED.md` → Skills) |
| §5 Artifact registry | 1 steps 2–4 |
| §6 Token bridge, alias only | 1 (`STYLESEED.md` → Approved tokens) |
| §7 SS003 (5) | 2 |
| §7 SS002 (2 fix, 6 except) | 3 |
| §7 SS005 (1 fix, 4 except) | 4 |
| §7 Test safety after each file | 2, 3, 4 — every fix step is followed by a verify step |
| §8 a11y ownership + open-items §3 | 1 (Accessibility), 5 |
| §9 Playwright out of scope | 6 step 4 records it; `requiredRenders` is `[]` in Task 1 |
| §10 Accepted limits | 1 (Known detector limits) |
| §11 Acceptance 1–8 | 6 |

No gaps.

**Placeholder scan**

No "TBD", no "similar to Task N", no "add error handling". Two steps deliberately require the executor to look something up rather than trusting a literal: Task 1 step 3 (the members route filename) and Task 5 step 2 (the four accessible names). Both say exactly which command reveals the answer and both are flagged as guesses in the text — that is the honest treatment, since inventing a selector that does not exist would be the worse failure.

**Type consistency**

No new types, functions or exported signatures are introduced. `TabsContent` in Task 4 keeps its existing props. Artifact id `members` is used identically in Task 1 steps 3/4/7 and Task 6 step 1. The `$SS` variable is defined in Global Constraints and re-exported in Task 1 step 1 and Task 6 step 1, the two places it is used at the start of a shell session.

**Cross-task hazard**

`sidebar.tsx:290` is edited in both Task 2 (step 10) and Task 3 (step 2). Task 3 step 1 notes this. If the tasks run out of order or in parallel worktrees, that line conflicts — run them in sequence.

---

## Deviations — what execution actually did

The plan above is kept as written. These are the places reality differed, recorded so the
document is not a false account of the work. Evidence for all of them is in
`../decisions/2026-09-22-phase-b-evidence.md`.

| Task | Plan said | Executed as | Why |
| --- | --- | --- | --- |
| 1 | `sourceRoots` starts at `src/pages/$slug.members.tsx` | `src/pages/_app/tenants` | The route is at `src/pages/_app/tenants/$slug.members.tsx`; the plan's step 3 said to look it up |
| 1 | `validation: { scoreFloor, requiredRenders: [] }` | Added `temporal` and `humanAcceptance`; `requiredRenders` has two entries | `normalizeArtifact` requires both keys and **rejects an empty `requiredRenders`**. Neither render was performed |
| 1 | `project.json` with `name`/`lock`/`grammar` keys | The contract's exact shape — `projectId`, `defaults`, `brand` | `exactObject` rejects unknown keys. Brand values were read from `globals.css`, including `keyColor: #171717` converted from `oklch(0.205 0 0)` |
| 1 | `index.json` entries use `path` | `config` | The contract's key name |
| 1 | Three `sourceRoots` | Four — added `src/styles` | `SS004` fired otherwise: the only `prefers-reduced-motion` block is `globals.css:140`, and `tokenFiles` does not put a file in the scanned inventory |
| 1 | — | Added `.prettierignore` entries | The manifest hashes the bundle and both palette files; prettier reformatting them would turn a clean scan into `SS000` |
| 3 | Four `SS002` fixes expected | Two | Only `w-[2px]`→`w-0.5` and `min-w-[96px]`→`min-w-24` land on exact scale steps. `p-[3px]` and `bottom-[-5px]` became exceptions, as the spec's rule allowed |
| 4 | Test at `src/components/ui/tabs.test.tsx` | `src/tests/a11y.test.tsx` | `src/components/ui/*` is eslint- and prettier-excluded as upstream's to own. The test renders the primitive directly because **no route mounts `Tabs`** — `$slug.tsx` uses a nav of real links |
| 5 | Four tests via `expectNoViolations` | Via a new `expectNoViolationsIn` | At document scope every open menu trips axe's `region` rule: Base UI portals the popup to `document.body`. The new helper narrows the context without disabling any rule, and pins `aria-required-children` so it cannot pass vacuously |
| 5 | Theme toggle opened on `/dashboard` | Opened inside the mobile sheet at width 500 | `ThemeToggle` is not in the desktop shell |
| 6 | — | Added a per-test `menuitem` count assertion | A menu that opened empty would otherwise pass axe while grading nothing |
