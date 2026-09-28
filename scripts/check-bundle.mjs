/**
 * @file Builds the app in memory and checks the chunks it would ship: more than
 * one JS chunk, first-visit JS (the entry chunk and its static imports) under
 * budget, and no devtools module in any chunk. Run with `pnpm check:bundle`.
 */
import path from 'node:path'
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
