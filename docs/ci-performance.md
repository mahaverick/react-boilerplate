# CI performance

This file records how long continuous integration (CI) and the local checks
took before and after the Vite+ migration, for anyone tuning CI. Each section
gives its method and its numbers; all four pull requests (PRs) below were
committed on 23 October 2026.

| Name in this file        | Pull request                                                                                                         |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------- |
| PR 1                     | [#142](https://github.com/mahaverick/react-boilerplate/pull/142) `ci: migrate to Vite+`                              |
| PR 2                     | [#143](https://github.com/mahaverick/react-boilerplate/pull/143) `perf(ci): faster tests`                            |
| Bundled fixtures harness | [#145](https://github.com/mahaverick/react-boilerplate/pull/145) `perf(e2e): run fixtures against a bundled harness` |
| The docker split         | [#150](https://github.com/mahaverick/react-boilerplate/pull/150) `perf(ci): take docker off the critical path`       |

"Before" means origin/main at 8fd4f64, before PR 1.

## Method

- **CI:** 20 successful `pull_request` runs of `ci.yml` on origin/main 8fd4f64: the median and the 90th percentile (p90) of wall time.
- **Local:** `hyperfine --warmup 1 --runs 3`. The table shows the mean of 3 runs (hyperfine's markdown export), not the median.
- **Machine:** an Apple silicon laptop with 10 cores. The 1-minute load average was 3.15 at the idle check, 3.86 at the start of the benchmark and 29.5 at its end. Vitest and Playwright spawn their own workers, so the later commands ran under that load plus other processes on the machine. Treat the local numbers as indicative.
- **Exit codes:** hyperfine ran with `--ignore-failure`, so each of the five commands was then run again on its own. All five exited 0, and `pnpm build` produced `dist/` (9.6 MB).
- **Build time:** `pnpm build` is `tsc -b && vp build`. `tsc -b` reuses its incremental cache after the first run, so the 5s mean is a warm build. A cold build took about 14s in the migration's spike.
- **Comparison:** take each "after" table at a comparable load, or the ratios mean little.

## CI before

| Metric           |    Value |
| :--------------- | -------: |
| Median wall time |     356s |
| p90              |     398s |
| Range            | 313-410s |

Per job:

| Job      |                                Time |
| :------- | ----------------------------------: |
| `test`   | 379-396s (`test:coverage` 324-340s) |
| `e2e`    |                            337-407s |
| `lint`   |                            138-142s |
| `docker` |                              59-66s |

## Local before

| Command                                                                        | Mean wall time [s] |
| :----------------------------------------------------------------------------- | -----------------: |
| `pnpm exec eslint . --max-warnings 0`                                          |     26.961 ± 3.915 |
| `pnpm exec prettier --check "**/*.{ts,tsx,js,jsx,mjs,css,json,jsonc,md,html}"` |      5.407 ± 0.016 |
| `pnpm typecheck`                                                               |      6.096 ± 0.038 |
| `pnpm test`                                                                    |     61.098 ± 2.732 |
| `pnpm build`                                                                   |      5.058 ± 0.013 |

`bash .husky/pre-push` (eslint, prettier, typecheck, unit tests; run once, load average 27 at start): `real 116.90s`, `user 469.61s`, `sys 78.74s`.

## CI after PR 1

10 successful `ci.yml` runs on head ebe646a: one first run plus 9 reruns of run 39843374084. None failed.

| Metric           |     Value |
| :--------------- | --------: |
| Median wall time |      410s |
| p90              |     1031s |
| Range            | 365-1062s |

Three of the ten attempts (2, 9 and 10) took 997-1062s. In each, `playwright install-deps chromium` in the `e2e` job took 594-662s, against about 20s in the others: a slow apt mirror, not the code. Without those three, the seven runs span 365-417s, with a median of 397s.

Per job (median of 10, min-max):

| Job      |             Time |
| :------- | ---------------: |
| `test`   |  331s (243-388s) |
| `e2e`    | 406s (329-1056s) |
| `lint`   |     62s (46-66s) |
| `docker` |     67s (54-86s) |

`lint` fell from 138-142s to a 62s median. Coverage dominates `test` both before and after PR 1; PR 2 targets it.

A set of attempts on head 5e8fda7 is discarded. From attempt 5 on, the `test` job failed at "Audit production dependencies" on two dompurify advisories (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr), a cause outside PR 1's code. Commit ebe646a adds the override.

## Local after PR 1

Method as in [Method](#method): `--warmup 1 --runs 3`, mean of 3. The 1-minute load average was 4.71 at the start and 30.9 at the end of the hyperfine run. `pnpm test` spawns its own workers, so the later commands ran under load; treat these numbers as indicative.

| Command              | Mean wall time [s] | Before [s] |
| :------------------- | -----------------: | ---------: |
| `pnpm check`         |     15.206 ± 1.589 |          - |
| `pnpm exec eslint .` |     10.319 ± 0.311 |     26.961 |
| `pnpm test`          |     60.801 ± 5.845 |     61.098 |
| `pnpm build`         |      6.829 ± 1.283 |      5.058 |

`pnpm check` replaces the eslint plus prettier pair, which took 26.961 + 5.407 = 32.4s before PR 1. `pnpm exec eslint .` runs the 17 untyped leftover rules. `pnpm build` varies more than before PR 1 because of the load.

`/usr/bin/time -p pnpm gate`: real 98.88s, user 409.04s, sys 79.86s (load average 30 at the start). The husky pre-push hook before PR 1 took 116.90s.

## CI after PR 2

10 successful `ci.yml` runs on head 15982b3: one first run plus 9 sequential reruns of run 39933843052. Wall-clock is `run_started_at` to `updated_at`. All 10 passed.

| Metric           |   Before | After PR 1 | After PR 2 |
| :--------------- | -------: | ---------: | ---------: |
| Median wall time |     356s |       410s |       189s |
| p90              |     398s |      1031s |       233s |
| Range            | 313-410s |  365-1062s |   151-295s |

Attempt 1 waited 86s for a runner before any job started. Without it, the nine reruns span 151-226s with a median of 179s. After PR 1, the seven runs that did not hit the slow apt mirror had a median of 397s.

Per job (median of 10, min-max):

| Job        |            Time |
| :--------- | --------------: |
| `unit` 1/4 |  104s (77-112s) |
| `unit` 2/4 |  104s (85-112s) |
| `unit` 3/4 |  106s (75-112s) |
| `unit` 4/4 |  102s (72-106s) |
| `test`     |    25s (19-28s) |
| `e2e`      | 184s (146-221s) |
| `lint`     |    68s (58-84s) |
| `docker`   | 125s (107-174s) |

`test` is the merge of the four shard reports and the coverage check; it fell from 331s to 25s. After PR 2, `e2e` is the critical path.

In these runs `docker` is warm on reruns, because the layer cache holds the install and build layers. A run that changes source rebuilds those layers: the first attempt, on a source change, took 174s, and two runs on head 88ae52d took 171-180s. From [The docker split](#the-docker-split) on, CI's image has no layer cache.

Two settings shape `e2e`:

- **Four `fixtures` workers.** Against the dev server, four workers on a 4-vCPU (virtual CPU) runner stalled pages on "Loading" past the 5s assertion budget. Head bb7350d failed `e2e` in 4 of 5 attempts, so the job ran three workers. The bundled harness (below) lifted that limit: three runs in a row passed at four workers, with the `pnpm test:e2e` step at 78-81s, against 62-85s at three. The gain is inside the noise. The setting is four because the rule was to keep four once three runs in a row passed.
- **Traces without screenshots.** CI runs no retries, so `retain-on-failure` is the only way a failure leaves a trace. The default also records a screenshot per action for every test, which slowed `e2e`. `screenshots: false` keeps only the DOM (Document Object Model) snapshots and the network log.

With the bundled harness, `e2e` runs in about 103s, below `docker`, which sets the pace (210s in the last run before the docker split). Splitting the `nginx` tests into their own job pays off at that point, because `docker` is the longer job; [The docker split](#the-docker-split) does it.

## Local after PR 2

`pnpm gate` takes 66.3s (`time`: user 395.9s, sys 74.4s, 709% CPU). The 1-minute load average was 2.4 at the start and 10.1 at the end. The same gate took 98.9s after PR 1, and the husky pre-push hook before PR 1 took 116.9s.

## Bundled fixtures harness

Before #145, `fixtures` ran against the Vite dev server. The dev server sent each fresh browser context hundreds of unbundled modules, and a global-setup warm-up of 11 routes hid the cold transforms.

From #145, `pnpm test:e2e` builds the harness in development mode and serves it with `vp preview`, with no warm-up. The build uses `e2e/harness.vite.config.ts`, so `import.meta.env.DEV` stays true and the Mock Service Worker (MSW) worker stays in the bundle.

- `live` uses `vp dev`, because it needs the `/api` proxy.
- `contrast` and `capture` stay on the dev server. `contrast` answers every `/api` request itself, so it could move to the bundle.

Local, 70 fixtures tests on 10 cores (five workers, as the config sets outside CI): 44-46s on the dev server, including the warm-up, and 25s on the bundle, including the build.

CI, head 0ae09a5 (three workers) and head 1dcb009 (four workers), three runs each. The `e2e` job against the 184s median above:

| Workers | `e2e` job        | `pnpm test:e2e` step |
| :------ | :--------------- | :------------------- |
| 3       | 94s, 112s, 113s  | 62s, 80s, 85s        |
| 4       | 105s, 110s, 108s | 79s, 81s, 78s        |

Two red runs on the way to green were races the bundle exposed, not harness faults:

- **The sign-in link test** asserted `/dashboard$`, while the router adds `?tenant=`. The dev server's slowness hid it.
- **Three palette tests** typed right after Ctrl+K and lost a key (the trace showed "crate a tenant"). That was an app bug, not a test fault. Between the loading field leaving and the palette's input taking focus, a key landed on the page and vanished. (When the palette is opened from a text field, the key types into that field instead.) #145 makes the host send such keys to the query, and the tests type straight after Ctrl+K. With the fix, 440 repeated runs passed; without it, 3 of 120 failed.

## The docker split

On a source change, `docker` took 185-206s while `e2e` took 92-103s. One run's profile (the 206s one):

| Step                                              | Time |
| :------------------------------------------------ | ---: |
| Pull and extract the cached dependency layer      |  51s |
| `COPY . .`, `vp build`, inject, nginx stage, load |  20s |
| Export the layer cache                            |  12s |
| Playwright setup (setup-vp, install, cache)       |  21s |
| `nginx -t`, the render check, `check-image.sh`    |  13s |
| `nginx` `@no-api` tests (37, four workers)        |  62s |
| Job setup, buildx, post-job cleanup               |  27s |

Three changes in #150 take `docker` off the critical path:

- **No layer cache for CI's image.** The cached dependency layer is about 210 MB. Pulling it from the Actions cache took about 30s, and extracting it about 20s. A from-scratch `pnpm install` inside the build takes 11-13s, and the whole build 33-36s. Dropping the cache also drops the export, which took 12-44s. deploy.yml keeps its own cache.
- **`image`, `image-checks` and two `nginx-e2e` shards instead of one job.** `image` builds the image and uploads it as an artifact named `image` (24 MB, 2s), and does nothing else. `image-checks` and the shards each have `needs: image`, download the artifact and `docker load` it (4-10s). `docker` is an aggregate that fails unless all of them passed, as `test` is over `unit`. The fixed artifact name is what lets "Re-run failed jobs" work: a re-run shard downloads the image the first attempt built.
- **`beforeEach(requireServedApp)` instead of `beforeAll`.** Under `fullyParallel`, Playwright batches a file's tests that share a `beforeAll` into `ceil(n / workers)` chunks. The three slowest analytics tests (32s, 16s and 7s) therefore ran back to back on one worker. With one check per test, shard 1 runs in 34-39s, bounded by its 32s test, and shard 2 in 26-28s.

A polling variant was measured and not kept. In it, the shards polled for the artifact so they could set up Playwright during the build. It finished `docker` about 25s sooner, but it broke partial re-runs and depended on the GitHub REST API, and the wall-clock did not move, because `test` ends last. In four source-change runs of that variant, `docker` finished 100-105s after the run started, against `e2e` at 97-111s. Overall wall-clock was 140-163s, against 188-210s before #150. The `test` job sets the wall-clock: `unit` shard 3 plus `test` ends at about 135-160s.

With `needs: image` (the version #150 ships), three source-change runs, one with a deliberately failing nginx test: `docker` finished 126-137s after the run started, `e2e` 89-106s and `test` 133-144s, so the wall-clock was 137-144s. `docker` ends about 30s after `e2e`, level with `test`.

`ARG GIT_SHA` stays where it is. On a source change, `COPY . .` invalidates every later layer anyway, and moving the release after `vp build` would change how it reaches the bundle.

**What to watch.** The shards split the tests by count, in file order, so shard 1 holds every heavy test in `analytics.test.ts` (34-39s, against 26-29s for shard 2). A long added test there lengthens `docker`. If `unit` plus `test` drops below about 130s, `docker` sets the wall-clock again.
