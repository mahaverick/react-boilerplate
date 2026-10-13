import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThemeStore, type Theme } from '@/states/theme.store'

const OPTIONS: { value: Theme; label: string; Icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', Icon: IconSun },
  { value: 'dark', label: 'Dark', Icon: IconMoon },
  { value: 'system', label: 'System', Icon: IconDeviceDesktop },
]

/**
 * The theme menu. The listener that makes `theme: 'system'` follow the OS is
 * in AppLayout, because this unmounts while the mobile drawer is closed. It is
 * icon-only, so its `aria-label` is its accessible name.
 */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Theme: ${theme}. Change theme`} />}
      >
        <IconSun aria-hidden="true" className="size-4 dark:hidden" />
        <IconMoon aria-hidden="true" className="hidden size-4 dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon aria-hidden="true" className="mr-2 size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
