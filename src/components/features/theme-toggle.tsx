import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThemeStore, type Theme } from '@/states/theme.store'

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  // `theme: 'system'` has to mean "follow the OS", not "whatever the OS was
  // when this tab loaded". The store samples `prefers-color-scheme` once, at
  // import, and it is not a React component so it cannot own an effect — this
  // is, and it is mounted for the whole authenticated session.
  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    // Re-applied through setTheme('system') rather than by toggling the class
    // directly, so the store stays the single owner of that decision.
    const onChange = () => setTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme, setTheme])

  return (
    <DropdownMenu>
      {/* An icon-only control, and Base UI's Tooltip emits neither
          role="tooltip" nor aria-describedby — a tooltip is not an accessible
          name here the way it is under Radix. The aria-label is what Task 9's
          axe `button-name` check reads. It sits on the rendered element rather
          than on the Trigger because useRender lets the rendered element's own
          props win. */}
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Theme: ${theme}. Change theme`} />}
      >
        <Sun className="size-4 dark:hidden" />
        <Moon className="hidden size-4 dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="mr-2 size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
