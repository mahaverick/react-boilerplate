// A re-export, not an implementation. All 20 vendored shadcn components import
// `cn` from the npm package of the same name (shadcn's own drop-in replacement
// for clsx + tailwind-merge), so a second, hand-rolled merger here would mean
// two mergers resolving conflicting Tailwind classes differently in one app.
// This keeps `@/lib/utils` as the import path our own code uses while there is
// exactly one merge implementation behind it.
export { cn } from 'cn'
