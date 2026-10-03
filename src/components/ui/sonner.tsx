/**
 * @file NOT vendored, despite living under src/components/ui/: the registry's
 * sonner.tsx imports `next-themes` and an icon module that exists only inside
 * shadcn's monorepo, so this one reads the Zustand theme store instead. Do not
 * `shadcn add sonner`.
 */
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { cn } from '@/lib/utils'
import { PII_CLASS_NAME } from '@/observability/analytics'
import { useThemeStore } from '@/states/theme.store'

/**
 * The app's toast host, themed from the theme store. Every toast is masked for
 * analytics: toasts name the member, invitee or address an action touched.
 */
export function Toaster({ ...props }: ToasterProps) {
  const theme = useThemeStore((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      className={cn('toaster group', PII_CLASS_NAME)}
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
