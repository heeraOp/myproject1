import { createContext } from 'react'

export type AppTheme = 'default' | 'diwali' | 'holi'

export type ThemeContextValue = {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)
