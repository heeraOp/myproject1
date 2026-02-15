import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import '@/theme/themes.css'

export type AppTheme = 'default' | 'diwali' | 'holi'

type ThemeContextValue = {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => void
}

const THEME_STORAGE_KEY = 'housie_app_theme'
const THEME_CLASSES = ['theme-default', 'theme-diwali', 'theme-holi']
const THEME_ORDER: AppTheme[] = ['default', 'diwali', 'holi']

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const isTheme = (value: string | null): value is AppTheme =>
  value === 'default' || value === 'diwali' || value === 'holi'

const readThemeFromStorage = (): AppTheme => {
  if (typeof window === 'undefined') return 'default'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isTheme(stored) ? stored : 'default'
}

const applyBodyThemeClass = (theme: AppTheme): void => {
  if (typeof document === 'undefined') return
  document.body.classList.remove(...THEME_CLASSES)
  document.body.classList.add(`theme-${theme}`)
}

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const [theme, setTheme] = useState<AppTheme>(() => readThemeFromStorage())

  useEffect(() => {
    applyBodyThemeClass(theme)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
  }, [theme])

  const value = useMemo<ThemeContextValue>(() => {
    const toggleTheme = () => {
      setTheme((currentTheme) => {
        const nextIndex = (THEME_ORDER.indexOf(currentTheme) + 1) % THEME_ORDER.length
        return THEME_ORDER[nextIndex]
      })
    }

    return { theme, setTheme, toggleTheme }
  }, [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider.')
  }
  return context
}
