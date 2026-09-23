# Toolchain & CI Hardening (react-boilerplate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `packageManager` the single pnpm pin with an explicitly installed Corepack, commit real git hooks, ignore agent files, switch to Renovate, add release-please, and turn `ci.yml` into the gate of a new `deploy.yml`.

**Architecture:** Repo-hygiene only — no application code changes. `package.json` gains `packageManager`/`engines` (lockfile regenerated once), `.husky/` gains three tracked hooks, `.github/workflows/` gains `deploy.yml` and `release.yml`, and `ci.yml` gains `workflow_call`.

**Tech Stack:** Node 24, pnpm 12.4.1, husky 9, commitlint 21, lint-staged 17, GitHub Actions, Renovate, release-please v5.

**Spec:** `~/Mahaverick/express-boilerplate/docs/superpowers/specs/2026-09-24-toolchain-and-ci-hardening-design.md` (Sections 1 and 3 apply here). The express half is `express-boilerplate/docs/superpowers/plans/2026-09-24-toolchain-and-ci-hardening.md`; run it first — this plan mirrors its Tasks 6–9.

**Branch:** `feat/toolchain-ci-hardening` (already created from `main` at `db0dbc3`).

## Global Constraints

- Node **24** (`.nvmrc` `24`, `engines.node >=24`, `node:24-alpine`). No Node 26 until the dated follow-up after 2026-10-28.
- `packageManager: "pnpm@12.4.1"` becomes the only place the pnpm version is written.
- Corepack is installed explicitly: `npm i -g corepack@0.36.0 && corepack enable`.
- TypeScript stays `~6.0.3` (CLAUDE.md "Versions"). ESLint stays. The `CLAUDE.md` "Never install" list still applies — nothing here adds to it.
- Exact versions: `@commitlint/cli@21.2.3`, `@commitlint/config-conventional@21.2.3`, `lint-staged@17.5.1` (all devDependencies).
- The lint gate is `pnpm exec eslint . --max-warnings 0` (CLAUDE.md "Commands"), not bare `pnpm lint`.
- Hooks call `pnpm exec`, never `npx`.
- Conventional commits; every commit ends with the two attribution lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01TSY5ETVc1EHHmpEnAqTa7v`.
- Implementers: if the brief is wrong against the code, argue with evidence rather than comply.

## Review Focus

1. **Lockfile regeneration smuggling upgrades.** Adding `packageManager` must change only `packageManagerDependencies` in `pnpm-lock.yaml`. Task 1 diffs the lockfile and fails the task on any other change.
2. **Hooks that exist but don't run.** `git ls-files .husky` was empty before; hooks must be tracked, executable (`100755`) and actually fire. Task 2 proves a bad commit message is rejected.
3. **pre-push long enough to drop the push.** Long pre-push hooks have dropped SSH pushes in this workspace before. Task 2 excludes e2e from pre-push and times it.
4. **Reusable-workflow concurrency collision.** Same as express: CI's group must be keyed on `github.event_name`, not `github.workflow`. Task 5 asserts it.
5. **`main` tested twice or not at all.** `push: main` moves from `ci.yml` to `deploy.yml`; Task 5 checks `ci.yml` no longer lists `push`, and `deploy.yml` calls it.

---

## File map

| File | Change | Task |
|---|---|---|
| `package.json`, `pnpm-lock.yaml` | `packageManager`, `engines`, devDeps, `lint-staged` | 1, 2 |
| `.nvmrc`, `.npmrc` | new | 1 |
| `Dockerfile` | Corepack | 1 |
| `.github/workflows/ci.yml` | drop `version:`; triggers; concurrency | 1, 5 |
| `README.md`, `CLAUDE.md` | prerequisites, Versions, hooks, CI | 1, 2, 4, 5 |
| `commitlint.config.js`, `.husky/{pre-commit,commit-msg,pre-push}` | new | 2 |
| `.gitignore` | agent entries | 3 |
| `renovate.json` | new | 4 |
| `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json` | new | 4 |
| `.github/workflows/deploy.yml` | new | 5 |

---

### Task 1: `packageManager` as the single pnpm pin; Corepack installed explicitly

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`, `Dockerfile`, `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md` ("Versions")
- Create: `.nvmrc`, `.npmrc`

- [ ] **Step 1: package.json.** Add after `"type": "module",`:

```json
  "packageManager": "pnpm@12.4.1",
  "engines": {
    "node": ">=24"
  },
```

- [ ] **Step 2: Version files.** Create `.nvmrc` containing `24` (single line) and `.npmrc` containing `engine-strict=true` (single line).

- [ ] **Step 3: Regenerate the lockfile and prove nothing else moved.**

```bash
pnpm install --lockfile-only
git diff --stat pnpm-lock.yaml
git diff pnpm-lock.yaml | grep '^[+-]' | grep -v '^+++\|^---' | grep -v -i 'packageManagerDependencies\|pnpm@12.4.1\|@pnpm/' | head -20
```

Expected: the diff adds a `packageManagerDependencies` section (~160 lines of per-platform pnpm binaries); the last command prints nothing, or only lines that are part of that section. **If any other package version changed, stop and report** — do not commit an unrelated upgrade.

Then: `pnpm install --frozen-lockfile` → succeeds.

- [ ] **Step 4: Dockerfile.** Replace the comment block that explains why pnpm is pinned in the Dockerfile rather than via `packageManager` (it begins "PINNED, not \"whatever pnpm this Node image bundles\"" and ends at "which pins the same one.") and the two lines under it:

```dockerfile
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
```

with:

```dockerfile
# Corepack is installed explicitly: Node 25+ no longer bundles it, and doing
# it now makes the Node 26 move a version bump only. The pnpm version comes
# from package.json's packageManager field (corepack install, below) — the
# one place it is written. It must be pnpm 12: pnpm-workspace.yaml uses
# allowBuilds and minimumReleaseAgeExclude, which older pnpm ignores in
# silence, and allowBuilds is what lets msw's postinstall run at all.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm i -g corepack@0.36.0 && corepack enable
```

and directly after `COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./` add:

```dockerfile
RUN corepack install
```

- [ ] **Step 5: CI.** In `.github/workflows/ci.yml`, delete every `with: { version: 12.4.1 }` under `pnpm/action-setup@v6` (three jobs) so the action reads `packageManager`, and delete the comment that says to keep the version in step with the Dockerfile's `corepack prepare`.

- [ ] **Step 6: Docs.**
  - `README.md` Prerequisites: replace `(\`corepack enable && corepack prepare pnpm@12.4.1 --activate\`)` with `(\`npm i -g corepack@0.36.0 && corepack enable\` — pnpm's version comes from \`packageManager\` in package.json; Node 25+ no longer ships Corepack, so this works on 24 and 26 alike)`.
  - `CLAUDE.md` "Versions": replace the paragraph beginning "The pnpm version is pinned in **two** places" with: "**The pnpm version lives in one place: `packageManager` in package.json.** The Dockerfile runs `corepack install` and CI's `pnpm/action-setup` reads the same field. pnpm 12 records itself in the lockfile (`packageManagerDependencies`), so changing the field means regenerating `pnpm-lock.yaml` in the same commit, or `--frozen-lockfile` fails."

- [ ] **Step 7: Verify.**

Run: `docker build -t react-boilerplate:corepack . && docker run --rm react-boilerplate:corepack nginx -t`
Expected: build succeeds; `nginx: configuration file /etc/nginx/nginx.conf test is successful` (add `--add-host=api:127.0.0.1` if nginx needs the upstream host, as CI does).

Run: `grep -rn "12\.4\.1" --exclude=pnpm-lock.yaml --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=dist .`
Expected: only `package.json` (`packageManager`).

Run: `pnpm exec eslint . --max-warnings 0 && pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml .nvmrc .npmrc Dockerfile .github/workflows/ci.yml README.md CLAUDE.md
git commit -m "chore: pin pnpm via packageManager and install Corepack explicitly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TSY5ETVc1EHHmpEnAqTa7v"
```

---

### Task 2: Tracked git hooks, commitlint and lint-staged

**Files:**
- Create: `.husky/pre-commit`, `.husky/commit-msg`, `.husky/pre-push`, `commitlint.config.js`
- Modify: `package.json` (devDeps + `lint-staged`), `pnpm-lock.yaml`, `CLAUDE.md` (new "Git hooks" section)

- [ ] **Step 1: Install.** `pnpm add -D @commitlint/cli@21.2.3 @commitlint/config-conventional@21.2.3 lint-staged@17.5.1`

- [ ] **Step 2: commitlint config.** Create `commitlint.config.js` (identical to express-boilerplate's):

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: { 'body-max-line-length': [0, 'always'] },
}
```

- [ ] **Step 3: lint-staged config.** Add to `package.json` (top level, after `devDependencies`):

```json
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix --max-warnings 0",
      "prettier --write"
    ],
    "*.{js,jsx,css,json,md,html}": [
      "prettier --write"
    ]
  }
```

(`src/components/ui/**` is vendored shadcn output with its own rules in CLAUDE.md — if `eslint.config.js` ignores it, lint-staged inherits that; do not add a separate exclusion unless a staged ui file fails and CLAUDE.md says it shouldn't be linted.)

- [ ] **Step 4: Hooks.** Create the three files and make them executable:

`.husky/pre-commit`:

```sh
# Fast checks on what you changed; the full sweep is in pre-push.
set -e

# Lockfile drift: under a second, and it catches the mistake that sends PRs
# to CI red, since CI installs with --frozen-lockfile and refuses.
pnpm install --frozen-lockfile --lockfile-only --ignore-scripts >/dev/null

pnpm exec lint-staged

# Tests for what you touched and everything importing it.
pnpm exec vitest run --changed HEAD --passWithNoTests
```

`.husky/commit-msg`:

```sh
pnpm exec commitlint --edit "$1"
```

`.husky/pre-push`:

```sh
# No e2e here on purpose: long pre-push hooks have dropped SSH pushes in this
# workspace. CI runs e2e (fixtures project) on every PR.
set -e
pnpm exec eslint . --max-warnings 0
pnpm lint
pnpm typecheck
pnpm test
```

```bash
chmod +x .husky/pre-commit .husky/commit-msg .husky/pre-push
```

- [ ] **Step 5: Prove the hooks are tracked and fire.**

Run: `git add .husky commitlint.config.js package.json pnpm-lock.yaml && git ls-files -s .husky`
Expected: three lines, each mode `100755`.

Run: `git commit -m "bad message" --allow-empty; echo "exit=$?"`
Expected: commitlint rejects it (`subject may not be empty` / `type may not be empty`), `exit=1`.

Run: `time sh .husky/pre-push`
Expected: passes; note the wall time in the report (it should be well under a minute; if it is not, report the number rather than trimming checks).

- [ ] **Step 6: Docs.** Add a `CLAUDE.md` section "Git hooks" after "Commands":

```md
## Git hooks

- **Tracked in `.husky/`, executable.** pre-commit: lockfile drift, lint-staged
  (eslint `--fix --max-warnings 0` + prettier on staged files), `vitest --changed`.
  commit-msg: commitlint (conventional commits). pre-push: the full lint gate,
  typecheck and unit tests — **no e2e**, on purpose: long pre-push hooks have
  dropped SSH pushes in this workspace. CI runs e2e.
- **Hooks call `pnpm exec`, never `npx`** — `npx` on a fresh machine downloads
  whatever version is newest, not the one this repo tested against.
- **Before this, `.husky/` held only husky's generated `_/` directory** — `prepare`
  ran, but no hook was ever committed, so nothing ran locally. If `git ls-files
  .husky` is ever empty again, that is the bug.
```

- [ ] **Step 7: Commit** (this commit itself goes through the new hooks)

```bash
git add .husky commitlint.config.js package.json pnpm-lock.yaml CLAUDE.md
git commit -m "chore: commit git hooks with commitlint and lint-staged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TSY5ETVc1EHHmpEnAqTa7v"
```

---

### Task 3: Ignore agent files

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1:** Append to `.gitignore`:

```gitignore

# Agent tooling: per-machine files that must never be committed
.claude/worktrees/
.claude/settings.local.json
.superpowers/
# May hold credentials (e.g. a database DSN) — commit an .mcp.json.example instead
.mcp.json
```

- [ ] **Step 2: Verify.**

Run: `for p in .claude/worktrees/x .claude/settings.local.json .superpowers/x .mcp.json; do git check-ignore -q "$p" && echo "ignored $p" || echo "NOT ignored $p"; done`
Expected: four `ignored` lines.

Run: `git ls-files .superpowers .claude/worktrees .mcp.json`
Expected: no output (nothing already tracked that the new rules would hide).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore agent worktrees, local settings and .mcp.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TSY5ETVc1EHHmpEnAqTa7v"
```

---

### Task 4: Renovate and release-please

**Files:**
- Create: `renovate.json`, `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`
- Modify: `CLAUDE.md` ("Versions": one bullet on Renovate), `README.md` (a short "Releases" section)

- [ ] **Step 1: Create `renovate.json`:**

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits", "helpers:pinGitHubActionDigests"],
  "schedule": ["before 6am on monday"],
  "minimumReleaseAge": "3 days",
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 6am on the first day of the month"]
  },
  "packageRules": [
    {
      "description": "typescript-eslint peers typescript <6.1.0; TS 7 breaks type-aware lint (see CLAUDE.md Versions)",
      "matchPackageNames": ["typescript"],
      "allowedVersions": "<6.1.0"
    },
    {
      "description": "Stay on Node 24 LTS until the planned move to Node 26 after 2026-10-28",
      "matchDatasources": ["docker"],
      "matchPackageNames": ["node"],
      "allowedVersions": "<25"
    },
    {
      "groupName": "dev tooling",
      "matchPackageNames": [
        "eslint",
        "eslint-*",
        "@eslint/*",
        "typescript-eslint",
        "prettier",
        "prettier-*",
        "@ianvs/prettier-plugin-sort-imports",
        "vitest",
        "@vitest/*"
      ]
    },
    { "groupName": "tanstack", "matchPackageNames": ["@tanstack/*"] },
    { "groupName": "types", "matchPackageNames": ["@types/*"] }
  ]
}
```

Run: `pnpm dlx --package=renovate@44 renovate-config-validator renovate.json`
Expected: validation success, no errors.

- [ ] **Step 2: release-please config.** Create `release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "bootstrap-sha": "db0dbc3",
  "packages": {
    ".": {
      "release-type": "node",
      "include-component-in-tag": false,
      "changelog-path": "CHANGELOG.md"
    }
  }
}
```

(`db0dbc3` is `main` when this plan was written; if `git merge-base origin/main HEAD` differs, use that and say so.)

Create `.release-please-manifest.json`:

```json
{ ".": "1.0.0" }
```

- [ ] **Step 3: Create `.github/workflows/release.yml`:**

```yaml
name: Release

# Opens/updates a release PR from conventional commits on main; merging that
# PR tags vX.Y.Z and creates the GitHub Release. The PR is opened with
# GITHUB_TOKEN, so it gets NO CI runs (GitHub never triggers workflows from
# GITHUB_TOKEN events) — acceptable while main is unprotected; switch to a
# GitHub App token once required checks exist.
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: googleapis/release-please-action@v5
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 4: Docs.** `CLAUDE.md` "Versions" gains: "**Renovate proposes updates** (weekly, grouped, 3-day minimum release age, actions pinned to SHAs). `renovate.json` holds TypeScript `<6.1.0` and the `node` image `<25`; lift those rules deliberately." `README.md` gains a "Releases" section: release-please opens a release PR from conventional commits on `main`; merging it tags and publishes a GitHub Release; release PRs show no CI checks (reason in `release.yml`).

- [ ] **Step 5: Commit**

```bash
git add renovate.json release-please-config.json .release-please-manifest.json .github/workflows/release.yml CLAUDE.md README.md
git commit -m "ci: add Renovate and release-please

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TSY5ETVc1EHHmpEnAqTa7v"
```

---

### Task 5: CI as the gate of a new deploy workflow

**Files:**
- Modify: `.github/workflows/ci.yml` (header)
- Create: `.github/workflows/deploy.yml`
- Modify: `CLAUDE.md` (a "CI and deploy" section), `README.md` ("Deploying")

- [ ] **Step 1: Rewrite the `ci.yml` header.** Replace everything from `on:` through the `permissions:` block with:

```yaml
on:
  pull_request:
    branches: [main]
  # Called by deploy.yml as the gate before an image is built. `push: main`
  # lives in deploy.yml now, so main isn't tested twice.
  workflow_call:
  workflow_dispatch:

# Keyed on the event, NOT github.workflow: when deploy.yml calls this file,
# github.workflow is the CALLER's name, and concurrency group names are
# case-insensitive — "Deploy-refs/heads/main" would collide with deploy.yml's
# own "deploy-refs/heads/main" group. Only PR runs are cancelled by a newer
# push; a gate run on main is never killed half-way.
concurrency:
  group: ci-${{ github.event_name }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read
```

The `lint`, `test`, `e2e` and `docker` jobs are unchanged (Task 1 already removed their `version:` inputs).

- [ ] **Step 2: Create `.github/workflows/deploy.yml`:**

```yaml
name: Deploy

# main → CI gate → image on GHCR → deploy. The deploy job is a placeholder
# until a target (Cloud Run / GKE / VM) is chosen; replace its step then.
on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  image:
    needs: ci
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    outputs:
      digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,format=long
            type=raw,value=main
      - id: build
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: mode=max
          sbom: true
      - uses: actions/attest-build-provenance@v4
        with:
          subject-name: ghcr.io/${{ github.repository }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
      - name: Summary
        run: |
          {
            echo "### Image"
            echo ""
            echo "\`ghcr.io/${{ github.repository }}@${{ steps.build.outputs.digest }}\`"
          } >> "$GITHUB_STEP_SUMMARY"

  deploy:
    needs: image
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: production
    steps:
      - name: Deploy (placeholder — no target chosen yet)
        run: echo "Would deploy ghcr.io/${{ github.repository }}@${{ needs.image.outputs.digest }}"
```

- [ ] **Step 3: Lint the workflows.**

Run: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.7 -color`
Expected: no errors for `ci.yml`, `deploy.yml`, `release.yml`.

Run: `grep -n "^  push:" .github/workflows/ci.yml; grep -n "group:" .github/workflows/ci.yml .github/workflows/deploy.yml`
Expected: no `push:` in `ci.yml`; groups `ci-${{ github.event_name }}-${{ github.ref }}` and `deploy-${{ github.ref }}`.

- [ ] **Step 4: Docs.** `CLAUDE.md` gains a "CI and deploy" section: "`ci.yml` runs on PRs and is called by `deploy.yml` on push to `main` as the gate; then `deploy.yml` builds and pushes `ghcr.io/<repo>:sha-<commit>` and `:main` with SBOM and provenance attestations, then runs a placeholder `deploy` job bound to the `production` environment. Keep CI's concurrency group keyed on `github.event_name` (comment in `ci.yml`)." `README.md` gains a two-sentence "Deploying" section saying the same.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml CLAUDE.md README.md
git commit -m "ci: reuse CI as the gate of a deploy workflow that publishes to GHCR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TSY5ETVc1EHHmpEnAqTa7v"
```

---

### Task 6: Whole-branch verification

- [ ] **Step 1:** `pnpm install --frozen-lockfile && pnpm exec eslint . --max-warnings 0 && pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
- [ ] **Step 2:** `pnpm test:e2e` — fixtures project green.
- [ ] **Step 3:** `docker build -t react-boilerplate:final . && docker run --rm --add-host=api:127.0.0.1 react-boilerplate:final nginx -t` — succeeds.
- [ ] **Step 4:** `git log --oneline main..HEAD` — one commit per task, conventional, with attribution lines.
- [ ] **Step 5:** Report the manual follow-ups: install the Renovate GitHub App; the `production` environment appears on the first `deploy.yml` run (or create it in Settings → Environments first); after merging, confirm `ci → image → deploy` and the GHCR package tags.
