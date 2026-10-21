# CI performance

Timing record for the Vite+ migration. Tasks 8 and 12 append their "after" tables here.

## Method

- **CI:** 20 successful `pull_request` runs of `ci.yml` on origin/main 8fd4f64, median and p90 of wall time.
- **Local:** `hyperfine --warmup 1 --runs 3`; the table shows the mean of 3 runs (hyperfine's markdown export), not the median.
- **Machine:** Apple M1 Pro, 10 cores. Load average (1 min) was 3.15 at the idle check, 3.86 at the start of the benchmark and 29.5 at its end. Vitest and Playwright spawn their own workers, so the later commands ran under their own load plus other processes on the machine. Treat the local numbers as indicative.

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
