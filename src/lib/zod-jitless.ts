/**
 * @file Turns off Zod's JIT, which probes `new Function('')` when the first
 * object schema is built: under `script-src 'self'` the browser reports that as
 * a CSP violation even though Zod catches it. `main.tsx` imports this first.
 */
import { z } from 'zod'

z.config({ jitless: true })
