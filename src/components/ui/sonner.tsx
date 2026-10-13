/**
 * @file Hand-written, not vendored, despite living under src/components/ui/:
 * it reads the Zustand theme store rather than `next-themes`, which this app
 * does not install. Do not `shadcn add sonner` over it.
 */
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { cn } from '@/lib/utils'
import { PII_CLASS_NAME } from '@/observability/telemetry'
import { useThemeStore } from '@/states/theme.store'

/**
 * The app's toast host, themed from the theme store. Every toast is masked for
 * analytics: toasts name the member, invitee or address an action touched.
 * A caller's `className` is merged in, never in place of the mask.
 */
export function Toaster({ className, ...props }: ToasterProps) {
  const theme = useThemeStore((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      className={cn('toaster group', className, PII_CLASS_NAME)}
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
