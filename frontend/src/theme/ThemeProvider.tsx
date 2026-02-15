import { useEffect, type PropsWithChildren } from 'react'
import { fetchCurrentPublicGame } from '@/api/rest/games'
import { useGameStore } from '@/app/store/game.store'
import { resolveThemeKey, resolveThemeOverlay } from '@/theme/themeRegistry'

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
  const OverlayComponent = resolveThemeOverlay(activeTheme)

  return (
    <>
      {children}
      {OverlayComponent ? <OverlayComponent key={overlayKey ?? 'theme-overlay'} /> : null}
    </>
  )
}

export default ThemeProvider
