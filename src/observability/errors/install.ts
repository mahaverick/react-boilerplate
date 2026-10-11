/**
 * @file Installs the error listeners as an import side effect. `main.tsx`
 * imports it straight after `zod-jitless`, so the listeners are in place
 * before the rest of the entry chunk evaluates.
 */
import { installErrorListeners } from './listen'

installErrorListeners()
