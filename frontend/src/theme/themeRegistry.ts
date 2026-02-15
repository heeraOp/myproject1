import type { ComponentType } from 'react'
import DiwaliOverlay from '@/theme/overlays/DiwaliOverlay'
import HoliOverlay from '@/theme/overlays/HoliOverlay'

export type ThemeOverlayComponent = ComponentType

export const themeRegistry: Record<string, ThemeOverlayComponent | null> = {
  dark: null,
  light: null,
  festival_gold: null,
  'festival-gold': null,
  diwali: DiwaliOverlay,
  'festival-diwali': DiwaliOverlay,
  holi: HoliOverlay,
}

const getThemeCandidates = (theme: string): string[] => {
  const normalized = theme.trim().toLowerCase()
  const hyphenTheme = normalized.replace(/_/g, '-')
  const underscoreTheme = normalized.replace(/-/g, '_')
  return Array.from(new Set([normalized, hyphenTheme, underscoreTheme]))
}

export const resolveThemeKey = (theme: string | null | undefined): string | null => {
  if (!theme) return null

  const candidates = getThemeCandidates(theme)
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(themeRegistry, candidate)) {
      return candidate
    }
  }

  return null
}

export const resolveThemeOverlay = (
  theme: string | null | undefined,
): ThemeOverlayComponent | null => {
  const key = resolveThemeKey(theme)
  if (!key) return null
  return themeRegistry[key] ?? null
}
