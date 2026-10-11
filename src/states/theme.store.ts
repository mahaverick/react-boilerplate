import { create } from 'zustand'

/** The user's colour theme choice; `system` follows the OS. */
export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

/** Whether the OS prefers a dark colour scheme; false where that cannot be read. */
function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** Sets the `dark` class on the document element for a theme. */
function applyTheme(theme: Theme): void {
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', isDark)
}

/** The theme saved in `localStorage`, or `system` when none is saved or storage is blocked. */
function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** The chosen theme and the action that changes it. */
interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

/**
 * The theme choice. A change is saved to `localStorage` and applied to the
 * document at once; the class for the first paint comes from
 * `public/theme-init.js`, which runs before the bundle.
 */
export const useThemeStore = create<ThemeState>()((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage may be blocked (private mode): the theme then applies for this session only.
    }
    applyTheme(theme)
    set({ theme })
  },
}))
