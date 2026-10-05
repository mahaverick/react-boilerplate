/**
 * @file Builds the app in memory and checks the chunks it would ship: more than
 * one JS chunk, first-visit JS (the entry chunk and its static imports) under
 * budget and free of posthog-js and `@posthog/core`, the error listener in the
 * entry chunk under its own budget, and no devtools module in any chunk. Run
 * with `pnpm check:bundle`.
 */
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

/** The measured first-visit JS plus 10%. Raise it only with a measured reason. */
const ENTRY_BUDGET_BYTES = 628_790

/**
 * A module inside one of the devtools packages, by its node_modules path. Module
 * ids, not code: in production both packages export a stub that returns null,
 * so a leaked chunk's code carries none of the package's name.
 */
const DEVTOOLS_MODULE =
  /[\\/]@tanstack[\\/](react-query-devtools|query-devtools|react-router-devtools|router-devtools-core)[\\/]/

/**
 * A posthog-js module, by its node_modules path. The analytics facade imports
 * it with a dynamic `import()`, so it must sit in a lazy chunk of its own.
 */
const POSTHOG_MODULE = /[\\/]posthog-js[\\/]/

/**
 * An `@posthog/core` module, by its node_modules path. Only the lazy error
 * reporter imports it, so it must stay out of the first-visit chunks.
 */
const POSTHOG_CORE_MODULE = /[\\/]@posthog[\\/]core[\\/]/

/** The entry-chunk error listener, which every page pays for. */
const ERROR_LISTENER_MODULE = /[\\/]src[\\/]observability[\\/]errors[\\/]listen\.ts$/

/** The error listener's rendered code in the entry chunk, gzipped; measured at 960 bytes. */
const ERROR_LISTENER_BUDGET_GZIP_BYTES = 1024

const output = await build({
  root: path.resolve(import.meta.dirname, '..'),
  logLevel: 'warn',
  build: { write: false },
})
const results = Array.isArray(output) ? output : [output]
const chunks = results.flatMap((result) =>
  'output' in result ? result.output.filter((file) => file.type === 'chunk') : []
)
const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
const failures = []

if (chunks.length < 2) {
  failures.push(`expected more than one JS chunk, found ${chunks.length}`)
}

const entries = chunks.filter((chunk) => chunk.isEntry)
if (entries.length !== 1) {
  failures.push(`expected one entry chunk, found ${entries.length}`)
} else {
  const initial = new Set()
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

for (const chunk of chunks) {
  const leaked = chunk.moduleIds.filter((id) => DEVTOOLS_MODULE.test(id))
  if (leaked.length > 0) {
    failures.push(`${chunk.fileName} contains devtools modules: ${leaked.join(', ')}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check-bundle: ${failure}`)
  process.exit(1)
}
console.log(`check-bundle: ok, ${chunks.length} JS chunks`)
