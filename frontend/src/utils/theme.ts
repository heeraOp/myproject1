type Theme = 'dark' | 'light' | 'festival-gold' | 'festival-diwali'

const THEME_STORAGE_KEY = 'app-theme'
const THEME_ORDER: Theme[] = ['dark', 'light', 'festival-gold', 'festival-diwali']
const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  'festival-gold': 'Festival Gold',
  'festival-diwali': 'Festival Diwali',
}
const THEME_EVENT = 'app-theme-change'

let adminTheme: Theme | null = null

const isTheme = (value: string | null): value is Theme =>
  value === 'dark' || value === 'light' || value === 'festival-gold' || value === 'festival-diwali'

export const getStoredTheme = (): Theme | null => {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isTheme(stored) ? stored : null
}

export const isAdminThemeActive = () => adminTheme !== null

export const getAdminTheme = () => adminTheme

export const getActiveTheme = (): Theme => {
  if (adminTheme) return adminTheme
  if (typeof document !== 'undefined') {
    const current = document.documentElement.dataset.theme ?? null
    if (isTheme(current)) return current
  }
  return getStoredTheme() ?? 'dark'
}

const emitThemeChange = () => {
  if (typeof window === 'undefined') return
  const detail = { theme: getActiveTheme(), isLocked: isAdminThemeActive() }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail }))
}

export const applyTheme = (theme: Theme, options: { persist?: boolean } = {}) => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }
  if (options.persist !== false && typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }
  emitThemeChange()
}

export const initTheme = () => {
  const stored = getStoredTheme()
  const theme: Theme = stored ?? 'dark'
  applyTheme(theme, { persist: stored !== null })
}

export const setAdminTheme = (theme: Theme | null) => {
  adminTheme = theme
  if (theme) {
    applyTheme(theme, { persist: false })
  } else {
    emitThemeChange()
  }
}

export const getNextTheme = (theme: Theme): Theme => {
  const index = THEME_ORDER.indexOf(theme)
  return THEME_ORDER[(index + 1) % THEME_ORDER.length]
}

export const toggleTheme = (): Theme => {
  if (adminTheme) return adminTheme
  const next = getNextTheme(getActiveTheme())
  applyTheme(next, { persist: true })
  return next
}

export const toggleAdminTheme = (): Theme => {
  const current = adminTheme ?? getActiveTheme()
  const next = getNextTheme(current)
  adminTheme = next
  applyTheme(next, { persist: false })
  return next
}

export const formatThemeLabel = (theme: Theme) => THEME_LABELS[theme]

export const subscribeThemeChange = (
  handler: (detail: { theme: Theme; isLocked: boolean }) => void,
) => {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ theme: Theme; isLocked: boolean }>).detail
    if (detail) handler(detail)
  }
  window.addEventListener(THEME_EVENT, listener)
  return () => window.removeEventListener(THEME_EVENT, listener)
}
