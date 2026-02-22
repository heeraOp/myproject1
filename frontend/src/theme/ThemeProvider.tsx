import { useEffect, type PropsWithChildren } from 'react'
import { fetchCurrentPublicGame } from '@/api/rest/games'
import { useGameStore } from '@/app/store/game.store'
import DiwaliOverlay from '@/theme/overlays/DiwaliOverlay'
import HoliOverlay from '@/theme/overlays/HoliOverlay'
import { resolveThemeKey } from '@/theme/themeRegistry'

const renderThemeOverlay = (overlayKey: string | null) => {
  if (overlayKey === 'diwali' || overlayKey === 'festival-diwali') {
    return <DiwaliOverlay key="theme-overlay-diwali" />
  }
  if (overlayKey === 'holi') {
    return <HoliOverlay key="theme-overlay-holi" />
  }
  return null
}

const ThemeProvider = ({ children }: PropsWithChildren) => {
  const activeTheme = useGameStore((state) => state.activeTheme)
  const setActiveTheme = useGameStore((state) => state.setActiveTheme)

  useEffect(() => {
    let mounted = true

    const hydrateTheme = async () => {
      try {
        const game = await fetchCurrentPublicGame()
        if (!mounted) return
        setActiveTheme(game?.active_theme ?? null)
      } catch {
        if (!mounted) return
        setActiveTheme(null)
      }
    }

    void hydrateTheme()

    return () => {
      mounted = false
    }
  }, [setActiveTheme])

  const overlayKey = resolveThemeKey(activeTheme)

  return (
    <>
      {children}
      {renderThemeOverlay(overlayKey)}
    </>
  )
}

export default ThemeProvider
