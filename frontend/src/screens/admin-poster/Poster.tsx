import { useEffect, useState } from 'react'
import './Poster.css'
import { useGameStore } from '@/app/store/game.store'
import { getWallpaperSet } from '@/theme/wallpaperRegistry'
import { fetchCurrentPublicGame } from '@/api/rest/games'

const Poster = () => {
  const activeTheme = useGameStore((state) => state.activeTheme)
  const selectedWallpaper = getWallpaperSet(activeTheme)
  const [gameName, setGameName] = useState<string>('')

  useEffect(() => {
    let mounted = true
    const loadCurrentGame = async () => {
      try {
        const currentGame = await fetchCurrentPublicGame()
        if (!mounted) return
        setGameName(currentGame?.name ?? '')
      } catch {
        if (!mounted) return
        setGameName('')
      }
    }
    void loadCurrentGame()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="poster-shell">
      <div
        className="poster-card"
        style={{
          backgroundImage: `url(${selectedWallpaper.poster})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="poster-title">{gameName || 'EMOINUTAMBOLAONLINE'}</div>
        <div className="poster-subtitle">BIG WIN</div>
        <div className="poster-highlight">Ticket price is Rs.50/-</div>
        <div className="poster-highlight">Total ticket for this game is 100</div>
        <div className="poster-highlight">Draw on 23-01-2026, 07:00:00 PM</div>

        <div className="poster-prizes">
          <div>First Housefull</div>
          <div>1,000rs/-</div>
          <div>Second Housefull</div>
          <div>500rs/-</div>
          <div>Full Sheet Bonus</div>
          <div>300rs/-</div>
          <div>Bottom Line</div>
          <div>150rs/-</div>
          <div>Middle Line</div>
          <div>150rs/-</div>
          <div>Top Line</div>
          <div>150rs/-</div>
          <div>Corner</div>
          <div>150rs/-</div>
          <div>Early 5</div>
          <div>150rs/-</div>
        </div>

        <div className="poster-footer">
          The game will be help automatically by the system in given date time.
          Once the result is declared, we will distribute the prize money.
        </div>
        <div className="poster-contact">
          For booking ticket visit emoinutambolaonlinehousie.com
          <br />
          Call on +917005496973
        </div>
      </div>

      <button className="print-button">PRINT POSTER</button>
    </div>
  )
}

export default Poster
