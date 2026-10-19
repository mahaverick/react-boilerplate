/**
 * @file Builds the app in memory and checks the chunks it would ship: more than
 * one JS chunk, first-visit JS (the entry chunk and its static imports) under
 * budget and free of posthog-js and `@posthog/core` (each of which must exist
 * in some other chunk, or the check proves nothing), the error listener in the
 * entry chunk under its own budget, Zod's config reached before any app code
 * that reaches Zod, and no devtools module in any chunk. Run with
 * `pnpm check:bundle`.
 */
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

/**
 * The ceiling for first-visit JS in bytes. Raise it only with a measured reason.
 * The list contract's route schemas (`defineList` in `list.schemas`, `searchText`)
 * and the list query options reach the entry through every list route's
 * `validateSearch` and the tenant queries; they add no zod classes the entry did
 * not already carry (the number, literal and boolean schemas are `z.custom`).
 * The request builder sits in `list-request.schemas`, which only the list table
 * loads, and `MEMBERSHIP_ROLES` has its own module. What the entry gained is the
 * list contract's own code and the paged membership read. Measured with the
 * Tenants list moved: 586,000 B. The members page's two route schemas, its
 * owner-count rule and the page query options reach it through `tenant.queries`
 * and the members route's `validateSearch`, again with no new zod class: 586,272 B.
 * The owners read's own query function and the member writes' invitation
 * refresh add 152 B: 586,424 B. The activity route's list schema (three
 * filters), its page query options and the audit action names (a module of
 * their own, so the sentences stay out of the entry) add 729 B: 587,153 B,
 * again with no new zod class. The inbox's writes then left the entry and
 * `_app`'s guard became lazy, which took it to 586,530 B; the members read's
 * `total` opt-out added 67 B: 586,597 B. The budget is that measurement rounded
 * up to the next 100 B, so any new entry code raises it with its own reason.
 * The command palette loads on its first open and adds no module to the
 * entry; its chunk shares the open store with `_app`'s, so `_app`'s lazy
 * route import reads that chunk's exports through its namespace (17 B). The
 * auth store also clears the stored palette recents on sign-out, through the
 * zod-free `recent-keys` module and without importing the palette or its
 * schema, so a sign-out on a page that never loaded it still removes them:
 * 586,795 B. Every module that imports Zod as a value then imported
 * `@/lib/zod-jitless` first, which moved the config out of the entry chunk
 * into a shared one each such chunk imports (16 B): 586,811 B. The
 * passwordless pages then left it at 586,796 B. The invitation confirm page,
 * a new lazy token-page route, adds its route options, its route-tree entry
 * and its chunk's preload list to the entry (648 B over the 586,796 B
 * measured before it); its component chunk stays lazy: 587,444 B.
 */
const ENTRY_BUDGET_BYTES = 587_500

/**
 * A module inside one of the devtools packages, by its node_modules path. Module
 * ids, not code: outside development the packages export a component that
 * returns null, so a leaked chunk's code carries none of the package's name.
 */
const DEVTOOLS_MODULE =
  /[\\/]@tanstack[\\/](react-query-devtools|query-devtools|react-router-devtools|router-devtools-core)[\\/]/

/**
 * A posthog-js module, by its node_modules path. The analytics facade imports
 * it with a dynamic `import()`, so it must stay out of every first-visit chunk.
 */
const POSTHOG_MODULE = /[\\/]posthog-js[\\/]/

/**
 * An `@posthog/core` module, by its node_modules path. Only the lazy error
 * reporter imports it, so it must stay out of the first-visit chunks.
 */
const POSTHOG_CORE_MODULE = /[\\/]@posthog[\\/]core[\\/]/

/** The palette's lazy code: the app's commands, the shell and the vendored command list. */
const PALETTE_LAZY_MODULE =
  /[\\/]src[\\/]components[\\/](features[\\/]command-palette\.tsx|shared[\\/]command-palette[\\/]command-palette-shell\.tsx|ui[\\/]command\.tsx)$/

/** The signed-in shell's side of the palette, which loads the lazy code on demand. */
const PALETTE_HOST_MODULE =
  /[\\/]src[\\/]components[\\/]shared[\\/]command-palette[\\/]command-palette-host\.tsx$/

/** The entry-chunk error listener, which every page pays for. */
const ERROR_LISTENER_MODULE = /[\\/]src[\\/]observability[\\/]errors[\\/]listen\.ts$/

/** The most the error listener's rendered code may weigh in the entry chunk, gzipped. */
const ERROR_LISTENER_BUDGET_GZIP_BYTES = 1024

/** Zod's config, which turns off the JIT probe that `script-src 'self'` reports. */
const JITLESS_MODULE = /[\\/]src[\\/]lib[\\/]zod-jitless\.ts$/

/** A Zod module, by its node_modules path. */
const ZOD_MODULE = /[\\/]node_modules[\\/]zod[\\/]/

const root = path.resolve(import.meta.dirname, '..')

/** The prefix of an app module's id: this repo's `src/`, not a package's. */
const APP_PREFIX = `${path.join(root, 'src')}/`

const output = await build({
  root,
  logLevel: 'warn',
  build: { write: false },
})
const results = Array.isArray(output) ? output : [output]
const chunks = results.flatMap((result) =>
  'output' in result ? result.output.filter((file) => file.type === 'chunk') : []
)
const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
const failures = []

/**
 * Lists `fileName` and every chunk it statically imports, recursively.
 * @param fileName - A chunk's file name.
 * @returns The chunk and its static imports.
 */
const closureOf = (fileName) => {
  const closure = new Set([fileName])
  for (const name of closure) {
    for (const imported of byFile.get(name)?.imports ?? []) closure.add(imported)
  }
  return closure
}

if (chunks.length < 2) {
  failures.push(`expected more than one JS chunk, found ${chunks.length}`)
}

const entries = chunks.filter((chunk) => chunk.isEntry)
if (entries.length !== 1) {
  failures.push(`expected one entry chunk, found ${entries.length}`)
} else {
  const initial = new Set()
  /**
   * Adds `fileName` and, recursively, every chunk it statically imports to `initial`.
   * @param fileName - A chunk's file name.
   */
  const visit = (fileName) => {
    if (initial.has(fileName)) return
    initial.add(fileName)
    for (const imported of byFile.get(fileName)?.imports ?? []) visit(imported)
  }
  visit(entries[0].fileName)
  const bytes = [...initial].reduce(
    (sum, fileName) => sum + Buffer.byteLength(byFile.get(fileName)?.code ?? ''),
    0
  )
  console.log(
    `first-visit JS: ${bytes} bytes in ${initial.size} chunks (budget ${ENTRY_BUDGET_BYTES})`
  )
  if (bytes > ENTRY_BUDGET_BYTES) {
    failures.push(`first-visit JS is ${bytes} bytes, over the ${ENTRY_BUDGET_BYTES}-byte budget`)
  }
  for (const fileName of initial) {
    const moduleIds = byFile.get(fileName)?.moduleIds ?? []
    if (moduleIds.some((id) => POSTHOG_MODULE.test(id))) {
      failures.push(`first-visit chunk ${fileName} contains posthog-js, which must load on demand`)
    }
    if (moduleIds.some((id) => POSTHOG_CORE_MODULE.test(id))) {
      failures.push(
        `first-visit chunk ${fileName} contains @posthog/core, which must load on demand`
      )
    }
  }
  const entry = entries[0]
  const listenerId = entry.moduleIds.find((id) => ERROR_LISTENER_MODULE.test(id))
  if (listenerId === undefined) {
    failures.push('the entry chunk has no error listener (src/observability/errors/listen.ts)')
  } else {
    const gzipped = gzipSync(entry.modules[listenerId]?.code ?? '', { level: 9 }).length
    console.log(
      `error listener: ${gzipped} bytes gzipped (budget ${ERROR_LISTENER_BUDGET_GZIP_BYTES})`
    )
    if (gzipped > ERROR_LISTENER_BUDGET_GZIP_BYTES) {
      failures.push(
        `the error listener is ${gzipped} bytes gzipped, over its ${ERROR_LISTENER_BUDGET_GZIP_BYTES}-byte budget`
      )
    }
  }
}

if (!chunks.some((chunk) => chunk.moduleIds.some((id) => POSTHOG_MODULE.test(id)))) {
  failures.push('no chunk contains posthog-js: the lazy-load check above proved nothing')
}

if (!chunks.some((chunk) => chunk.moduleIds.some((id) => POSTHOG_CORE_MODULE.test(id)))) {
  failures.push('no chunk contains @posthog/core: the lazy-load check above proved nothing')
}

/**
 * Zod's config must evaluate before any app module can build a schema. A chunk
 * that holds app code and reaches Zod must therefore reach the config too, or
 * hold it ahead of its other app modules: an entry chunk's own body runs after
 * every chunk it imports, so a config inlined there ran after a schema built in
 * one of those chunks, and Zod's `new Function('')` probe broke the CSP.
 */
const jitlessChunk = chunks.find((chunk) => chunk.moduleIds.some((id) => JITLESS_MODULE.test(id)))
if (jitlessChunk === undefined) {
  failures.push('no chunk contains src/lib/zod-jitless.ts')
} else {
  for (const chunk of chunks) {
    const closure = closureOf(chunk.fileName)
    const reachesZod = [...closure].some((fileName) =>
      byFile.get(fileName)?.moduleIds.some((id) => ZOD_MODULE.test(id))
    )
    const appIds = chunk.moduleIds.filter((id) => id.startsWith(APP_PREFIX))
    if (!reachesZod || appIds.length === 0) continue
    if (chunk === jitlessChunk) {
      const first = appIds[0]
      if (!JITLESS_MODULE.test(first)) {
        failures.push(`${chunk.fileName} evaluates ${first} before src/lib/zod-jitless.ts`)
      }
    } else if (!closure.has(jitlessChunk.fileName)) {
      failures.push(
        `${chunk.fileName} reaches Zod but not ${jitlessChunk.fileName}, which holds src/lib/zod-jitless.ts`
      )
    }
  }
}

for (const chunk of chunks) {
  const leaked = chunk.moduleIds.filter((id) => DEVTOOLS_MODULE.test(id))
  if (leaked.length > 0) {
    failures.push(`${chunk.fileName} contains devtools modules: ${leaked.join(', ')}`)
  }
}

// The palette's code stays behind the host's import().
const lazyChunks = chunks.filter((chunk) =>
  chunk.moduleIds.some((id) => PALETTE_LAZY_MODULE.test(id))
)
const hostChunks = chunks.filter((chunk) =>
  chunk.moduleIds.some((id) => PALETTE_HOST_MODULE.test(id))
)
if (lazyChunks.length === 0 || hostChunks.length === 0) {
  failures.push('no chunk holds the palette or its host: the lazy-load check below proved nothing')
}
const eager = new Set()
/**
 * Adds `fileName` and every chunk it statically imports to `eager`.
 * @param fileName - A chunk's file name.
 */
const reach = (fileName) => {
  if (eager.has(fileName)) return
  eager.add(fileName)
  for (const imported of byFile.get(fileName)?.imports ?? []) reach(imported)
}
for (const chunk of [...entries, ...hostChunks]) reach(chunk.fileName)
for (const chunk of lazyChunks) {
  if (eager.has(chunk.fileName)) {
    failures.push(
      `${chunk.fileName} holds the palette's code but is statically imported by the entry or the shell; it must load on demand`
    )
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check-bundle: ${failure}`)
  process.exit(1)
}
console.log(`check-bundle: ok, ${chunks.length} JS chunks`)
