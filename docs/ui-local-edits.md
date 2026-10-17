# Local edits to the vendored shadcn components

The files in `src/components/ui/` come from the shadcn registry (style
`base-vega`). These are the places they differ, and why. `pnpm ui:drift`, a
step of CI's `lint` job, compares each file with its registry snapshot in
`scripts/ui-registry/` and accepts exactly the edits listed here, through
each section's rules.

The rules are fenced blocks under a `### <file>` heading (`*` for every file):

- A `ui-drift` block holds `skip` (the file is ours, nothing to compare) or
  line rewrites: `ours: s/<re>/<to>/` rewrites our changed lines and
  `theirs: s/<re>/<to>/` the registry's. A changed line a rewrite turns blank,
  or into a line the other side has in the same hunk, is explained, and so is
  a blank line. Use them for an edit that recurs on many lines or files.
- A `ui-drift-hunk` block records one hunk exactly: a `reason:` line, then the
  registry's lines as `-<line>` and ours as `+<line>`, indentation included.
  What the line rewrites leave of a hunk must equal one recorded hunk, and a
  recorded hunk that matches nothing fails the check. On unrecorded drift the
  check prints the block to paste; fill in the reason.

`pnpm ui:drift:refresh` rewrites the snapshot from the registry through the
pinned CLI (it needs the network). The registry moves without a CLI release,
so a refresh is a change of its own: review the snapshot's diff, then run
`pnpm ui:drift`.

Re-pulling a component (`pnpm dlx shadcn@4.21.4 add <name> --overwrite`)
drops these edits: re-apply every one marked "re-apply: yes".

### *

Edits on every file.

- **`aria-hidden="true"` on each Tabler icon.** Tabler, unlike Lucide, does
  not hide its icons from assistive tech. `tests/unit/ui-icons-aria-hidden.test.ts`
  fails when one is missing. `spinner.tsx` is the one exception: its icon
  is announced through its own `role="status"` and `aria-label`, so it stays
  as the registry has it. Re-apply: yes, except in `spinner.tsx`.
- **A `"use client"` line** in files added before this record. The registry
  (`rsc: false`) omits it from most components; where it ships one
  (`sidebar` among them), that file's section records it. The directive
  does nothing in a Vite single-page app. The rule treats the line as
  noise on our side. Re-apply: no.
- **Narrowed `transition`.** The registry writes `transition-all`; we list the
  properties that animate (as `button.tsx` does) so layout properties are not
  transitioned. The rule reads any `transition-[...]` as `transition-all`.
  Re-apply: yes, with the properties that animate.
- **Quote style in `[class*=...]` selectors.** The registry prints
  `[class*='size-']`; our files carry `[class*="size-"]`. The two are the
  same class. Re-apply: no.

```ui-drift
ours: s/ aria-hidden="true"//
ours: s/^"use client"$//
ours: s/transition-\[[^\]]*\]/transition-all/
ours: s/\[class\*="size-"\]/[class*='size-']/g
```

### alert.tsx

- **`warning` and `info` variants** next to `default` and `destructive`,
  tinted with `--warning-strong` and `--info` (`src/styles/globals.css`).
  Re-apply: yes.

```ui-drift-hunk
reason: warning and info variants
+        warning:
+          "border-warning-strong/40 bg-warning-strong/10 text-foreground *:[svg]:text-warning-strong",
+        info: "border-info/40 bg-info/10 text-foreground *:[svg]:text-info",
```

### avatar.tsx

- **Fallback text is `text-foreground`**, not `text-muted-foreground`, on the
  `bg-muted` fill: the registry's pairing measured under 4.5:1 in the light
  theme (`pnpm test:contrast`). Re-apply: yes.

```ui-drift
ours: s/bg-muted text-sm text-foreground/bg-muted text-sm text-muted-foreground/
```

### combobox.tsx

- **`aria-label="Clear"` and `aria-label="Remove"`** on the clear and
  chip-remove buttons, which are icon-only and otherwise have no name.
  Re-apply: yes.

```ui-drift
ours: s/^\s+aria-label="(Clear|Remove)"$//
```

### command.tsx

Hand-written, not vendored: the registry's `command` is built on cmdk, which
pulls in Radix. Ours composes Base UI's Autocomplete and keeps the registry's
export names and styling; there is no registry file to compare.

```ui-drift
skip
```

### dropdown-menu.tsx

- **`min-w-24`** for the sub-menu content, where the registry writes
  `min-w-[96px]`: the lint rule for canonical Tailwind classes rejects the
  arbitrary value. Re-apply: yes.

```ui-drift
ours: s/min-w-24/min-w-[96px]/
```

### form.tsx

Hand-written, not vendored; there is no registry file to compare.

```ui-drift
skip
```

### sidebar.tsx

- **`after:w-0.5`** on the rail, where the registry writes `after:w-[2px]`: the
  lint rule for canonical Tailwind classes rejects the arbitrary value.
  Re-apply: yes.
- **No `"use client"` line.** The registry adds one; the app does not need it.
  Re-apply: no.

```ui-drift
ours: s/after:w-0\.5/after:w-[2px]/
theirs: s/^"use client"$//
```

### tabs.tsx

- **The tab panel keeps a focus ring** (`rounded-md`,
  `focus-visible:ring-3 focus-visible:ring-ring/50`). A panel is focusable
  and the registry drops its indicator. Re-apply: yes.

```ui-drift
theirs: s/className=\{cn\("flex-1 text-sm outline-none", className\)\}$//
ours: s/^\s+className=\{cn\($//
ours: s/^\s+"flex-1 rounded-md text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring\/50",$//
ours: s/^\s+className$//
ours: s/^\s+\)\}$//
```

### toast.tsx

Ours: the viewport sits at the top, the toast manager is `src/lib/toast.ts`'s,
and the toasts carry the PII mask, status colours and a labelled viewport.
The edits are too many to list line by line, so the file is skipped.

```ui-drift
skip
```
