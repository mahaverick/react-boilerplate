import { describe, expect, it } from 'vite-plus/test'

/**
 * Every source file that imports Zod as a value imports `@/lib/zod-jitless`
 * first. An import is an evaluation-order edge every bundler keeps, so the
 * config runs before that file can build a schema, however the build chunks
 * the app. The entry's first import alone is not enough: a chunk the entry
 * imports evaluates before the entry's own body, so a module-scope schema in
 * it ran Zod's `new Function('')` probe, which `script-src 'self'` reports.
 */
const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const JITLESS_PATH = '/src/lib/zod-jitless.ts'

/** The first import statement, as `import '<specifier>'` or the specifier alone. */
const FIRST_IMPORT = /^import\b[^']*'([^']+)'/m

/**
 * A Zod import that may reach run time: anything but `import type`. Specifiers
 * hold no quote, so `[^']*` stops each match at its own `from`.
 */
const ZOD_VALUE_IMPORT = /^import(?!\s+type\b)[^']*?\bfrom\s+'zod(?:\/[^']*)?'/m

/**
 * Lists the files that import Zod as a value without importing the config first.
 * @param sources - File contents by root-relative path.
 * @returns The offending paths.
 */
function missingJitless(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([path, code]) => path !== JITLESS_PATH && ZOD_VALUE_IMPORT.test(code))
    .filter(([, code]) => code.match(FIRST_IMPORT)?.[0] !== "import '@/lib/zod-jitless'")
    .map(([path]) => path)
}

describe('zod-jitless import order', () => {
  it('flags a value import of Zod without the config first, and passes one with it', () => {
    expect(
      missingJitless({
        '/src/a.ts': "import { z } from 'zod'\n",
        '/src/b.ts':
          "import { x } from '@/x'\nimport '@/lib/zod-jitless'\nimport { z } from 'zod'\n",
        '/src/c.ts': "import '@/lib/zod-jitless'\nimport { z } from 'zod'\n",
        '/src/d.ts': "import type { z } from 'zod'\n",
      })
    ).toEqual(['/src/a.ts', '/src/b.ts'])
  })

  it('every source file that imports Zod as a value imports @/lib/zod-jitless first', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0)
    expect(missingJitless(SOURCES)).toEqual([])
  })
})
