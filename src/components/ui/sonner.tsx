import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useThemeStore } from '@/states/theme.store'

// NOT vendored, despite living under src/components/ui/. The registry's own
// sonner.tsx imports `next-themes` (a Next.js library with no place in a Vite
// SPA) and an icon module from a path that exists only inside shadcn's own
// monorepo. Both are true of the base-* and radix-* styles alike. This reads
// the project's Zustand theme store instead. Do not `shadcn add sonner`.
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
