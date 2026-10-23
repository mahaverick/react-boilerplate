# CI performance

Timing record for the Vite+ migration. Tasks 8 and 12 append their "after" tables here.

## Method

- **CI:** 20 successful `pull_request` runs of `ci.yml` on origin/main 8fd4f64, median and p90 of wall time.
- **Local:** `hyperfine --warmup 1 --runs 3`; the table shows the mean of 3 runs (hyperfine's markdown export), not the median.
- **Machine:** Apple silicon laptop, 10 cores. Load average (1 min) was 3.15 at the idle check, 3.86 at the start of the benchmark and 29.5 at its end. Vitest and Playwright spawn their own workers, so the later commands ran under their own load plus other processes on the machine. Treat the local numbers as indicative.
- **Exit codes:** hyperfine ran with `--ignore-failure`, so each of the five commands was re-run on its own afterwards. All five exited 0, and `pnpm build` produced `dist/` (9.6 MB).
- **Build time:** `pnpm build` is `tsc -b && vp build`. `tsc -b` reuses its incremental cache after the first run, so the 5s mean is warm. A cold build takes longer (about 14s in the spike).
- **Comparison:** take later "after" tables at a comparable load, or the ratios mean little.

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

10 successful `ci.yml` runs on head ebe646a (one first run plus 9 reruns of run 39843374084). None failed.

| Metric           |     Value |
| :--------------- | --------: |
| Median wall time |      410s |
| p90              |     1031s |
| Range            | 365-1062s |

Three of the ten attempts (2, 9, 10) took 997-1062s. In each, `playwright install-deps chromium` in the `e2e` job took 594-662s, against about 20s in the others. That is a slow apt mirror, not the code. Without those three, the seven runs span 365-417s with a median of 397s.

Per job (median of 10, min-max):

| Job      |             Time |
| :------- | ---------------: |
| `test`   |  331s (243-388s) |
| `e2e`    | 406s (329-1056s) |
| `lint`   |     62s (46-66s) |
| `docker` |     67s (54-86s) |

`lint` fell from 138-142s to a 62s median. `test` is unchanged in kind (coverage still dominates); PR 2 targets it.

An earlier set of attempts on head 5e8fda7 is discarded: from attempt 5 on, the `test` job failed at "Audit production dependencies" on new dompurify advisories (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr), not on this PR. Commit ebe646a adds the override.

## Local after PR 1

Load average (1 min): 4.71 at the start, 30.9 at the end of the hyperfine run. `pnpm test` spawns its own workers, so the later commands ran under load; treat these as indicative. `--warmup 1 --runs 3`, mean of 3.

| Command              | Mean wall time [s] | Before [s] |
| :------------------- | -----------------: | ---------: |
| `pnpm check`         |     15.206 ± 1.589 |          - |
| `pnpm exec eslint .` |     10.319 ± 0.311 |     26.961 |
| `pnpm test`          |     60.801 ± 5.845 |     61.098 |
| `pnpm build`         |      6.829 ± 1.283 |      5.058 |

`pnpm check` replaces the old eslint plus prettier pair (26.961 + 5.407 = 32.4s before). `pnpm exec eslint .` is the 17 untyped leftover rules. `pnpm build` is noisier than before because of the load.

`/usr/bin/time -p pnpm gate`: real 98.88s, user 409.04s, sys 79.86s (load 30 at start). The old pre-push hook took 116.90s.

## CI after PR 2

10 successful `ci.yml` runs on head 15982b3: one first run plus 9 reruns of run 39933843052, sequential. Wall-clock is `run_started_at` to `updated_at`. All 10 passed.

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

`test` is the merge of the four shard reports and the coverage check; it fell from 331s to 25s. `e2e` is now the critical path. `docker` is warm on reruns, because the layer cache holds the install and build layers. A run that changes source rebuilds those layers: the first attempt, on a source change, took 174s, and two runs on head 88ae52d took 171-180s.

Two settings shape `e2e`:

- **Four `fixtures` workers.** Against the dev server, four workers on a 4 vCPU runner stalled pages on "Loading" past the 5s assertion budget, and head bb7350d failed `e2e` in 4 of 5 attempts, so the job ran three. The bundled harness (below) lifted that limit: three runs in a row passed at four workers, with the `pnpm test:e2e` step at 78-81s, against 62-85s at three. The gain is inside the noise, and the setting stays at four because the rule was to keep it when three runs passed.
- **Traces without screenshots.** CI runs no retries, so `retain-on-failure` is the only way a failure leaves a trace. The default also records a screenshot per action for every test, which slowed `e2e`, so `screenshots: false` keeps the DOM snapshots and the network log only.

Docker no longer sets the pace. The earlier ruling to split the `nginx` tests into their own job stays a next-round item, and it now pays only if `e2e` falls below `docker`'s 125s.

## Local after PR 2

`pnpm gate` takes 66.3s (`time`: user 395.9s, sys 74.4s, 709% CPU). Load average (1 min) was 2.4 at the start and 10.1 at the end. It was 98.9s after PR 1 and 116.9s for the old pre-push hook.

## Bundled fixtures harness

`fixtures` used to run against the Vite dev server, which sent each fresh browser context hundreds of unbundled modules, and a global-setup warm-up of 11 routes hid the cold transforms. `pnpm test:e2e` now builds the harness in development mode (`e2e/harness.vite.config.ts`, so `import.meta.env.DEV` stays true and MSW's worker stays in the bundle) and serves it with `vp preview`. The warm-up is gone. `live`, `contrast` and `capture` still use `vp dev`, because they need its `/api` proxy.

Local, 70 fixtures tests on 10 cores (five workers, as the config sets outside CI): 44-46s on the dev server, including the warm-up, and 25s on the bundle, including the build.

CI, head 0ae09a5 (three workers) and head 1dcb009 (four workers), three runs each. The `e2e` job against the 184s median above:

| Workers | `e2e` job        | `pnpm test:e2e` step |
| :------ | :--------------- | :------------------- |
| 3       | 94s, 112s, 113s  | 62s, 80s, 85s        |
| 4       | 105s, 110s, 108s | 79s, 81s, 78s        |

Two red runs on the way to green were test races the bundle exposed, not harness faults. The sign-in link test asserted `/dashboard$` while the router adds `?tenant=`; the dev server's slowness hid it. Three palette tests typed right after Ctrl+K and lost a key (the trace showed "crate a tenant"). That was an app bug, not a test fault: between the loading field leaving and the palette's input taking focus, a key landed on the page and vanished. The host now sends such keys to the query, and the tests type straight after Ctrl+K again; 440 repeated runs passed, against 3 failures in 120 before.
