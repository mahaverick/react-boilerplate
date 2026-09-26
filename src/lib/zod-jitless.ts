import { z } from 'zod'

/**
 * Zod probes `Function('')` once, memoized, the first time any object schema
 * is built with its JIT fast path enabled, to decide whether that path is
 * usable at all. Under this app's `script-src 'self'` (no `unsafe-eval`) that
 * probe still fires a CSP violation report even though Zod catches the throw
 * and falls back correctly — and the first schema built is whichever loads
 * first, which in this app is a route's `validateSearch`, built while the
 * route tree loads. `jitless` skips the probe outright. This has to run
 * before any schema is built, which is why `main.tsx` imports this file
 * first: nothing else here makes that true.
 */
z.config({ jitless: true })
