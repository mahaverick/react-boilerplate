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
| `pnpm check`         |      15.206 ± 1.589 |          - |
| `pnpm exec eslint .` |      10.319 ± 0.311 |     26.961 |
| `pnpm test`          |      60.801 ± 5.845 |     61.098 |
| `pnpm build`         |       6.829 ± 1.283 |      5.058 |

`pnpm check` replaces the old eslint plus prettier pair (26.961 + 5.407 = 32.4s before). `pnpm exec eslint .` is the 17 untyped leftover rules. `pnpm build` is noisier than before because of the load.

`/usr/bin/time -p pnpm gate`: real 98.88s, user 409.04s, sys 79.86s (load 30 at start). The old pre-push hook took 116.90s.
