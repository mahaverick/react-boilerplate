import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useThemeStore } from '@/states/theme.store'

// NOT vendored, despite living under src/components/ui/. The registry's own
// sonner.tsx imports `next-themes` (a Next.js library with no place in a Vite
// SPA) and, in the radix-nova style, an icon module from a path that does not
// exist outside shadcn's own monorepo. This reads the project's Zustand theme
// store instead. Do not re-add it with `shadcn add sonner`.
export function Toaster({ ...props }: ToasterProps) {
  const theme = useThemeStore((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
