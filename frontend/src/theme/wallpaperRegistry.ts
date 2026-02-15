import christmasBg from '../assets/wallpapers/christmas/bg.jpg'
import christmasPosterBg from '../assets/wallpapers/christmas/poster-bg.jpg'
import defaultBg from '../assets/wallpapers/default/bg.jpg'
import defaultPosterBg from '../assets/wallpapers/default/poster-bg.jpg'
import diwaliBg from '../assets/wallpapers/diwali/bg.jpg'
import diwaliPosterBg from '../assets/wallpapers/diwali/poster-bg.jpeg'
import holiBg from '../assets/wallpapers/holi/bg.jpg'
import holiPosterBg from '../assets/wallpapers/holi/poster-bg.jpg'

export const wallpaperRegistry = {
  christmas: { background: christmasBg, poster: christmasPosterBg },
  diwali: { background: diwaliBg, poster: diwaliPosterBg },
  holi: { background: holiBg, poster: holiPosterBg },
  default: { background: defaultBg, poster: defaultPosterBg },
} as const

type WallpaperThemeKey = keyof typeof wallpaperRegistry

const themeAliases: Record<string, WallpaperThemeKey> = {
  dark: 'default',
  festival_gold: 'diwali',
}

export const resolveWallpaperTheme = (
  theme: string | null | undefined,
): WallpaperThemeKey => {
  const normalized = String(theme ?? '')
    .trim()
    .toLowerCase()

  if (normalized && normalized in wallpaperRegistry) {
    return normalized as WallpaperThemeKey
  }

  if (normalized && normalized in themeAliases) {
    return themeAliases[normalized]
  }

  return 'default'
}

export const getWallpaperSet = (theme: string | null | undefined) =>
  wallpaperRegistry[resolveWallpaperTheme(theme)]
