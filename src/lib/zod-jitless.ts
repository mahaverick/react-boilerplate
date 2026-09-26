import { z } from 'zod'

/**
 * Zod's JIT probes `new Function('')` when the first object schema is built.
 * Under `script-src 'self'` the browser reports that as a CSP violation (a
 * `securitypolicyviolation` event and a console error) even though Zod
 * catches it. `main.tsx` imports this first, so it runs before any schema is
 * built.
 */
z.config({ jitless: true })
