import { z } from 'zod'

/**
 * Zod probes `Function('')` once per schema, lazily at schema construction,
 * to decide whether it can use its JIT-compiled fast path. Under this app's
 * `script-src 'self'` (no `unsafe-eval`) that probe still fires a CSP
 * violation report even though Zod catches the throw and falls back
 * correctly — so every route's `validateSearch` would otherwise report one on
 * first navigation, since those schemas are built while the route tree loads.
 * `jitless` skips the probe outright. This has to run before any schema is
 * built, which is why `main.tsx` imports this file first: nothing else here
 * makes that true.
 */
z.config({ jitless: true })
