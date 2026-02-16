import { useEffect, useState } from 'react'
import './Poster.css'
import { useGameStore } from '@/app/store/game.store'
import { getWallpaperSet } from '@/theme/wallpaperRegistry'
import { fetchCurrentPublicGame } from '@/api/rest/games'
import { fetchGameSummary, fetchPrizes } from '@/api/rest/gamePublic'
import { formatDateTimeInIST } from '@/utils/dateTime'
import type { PublicGame } from '@/types/backend/game'
import type { PublicGameSummary, PublicPrize } from '@/api/rest/gamePublic'

const PRIZE_LABEL_MAP: Record<string, string> = {
  FIRST_HOUSE: 'First Full House',
  SECOND_HOUSE: 'Second Full House',
  THIRD_HOUSE: 'Third Full House',
  FULL_SHEET: 'Full Sheet Bonus',
  HALF_SHEET: 'Half Sheet Bonus',
  TOP_LINE: 'Top Line',
  MIDDLE_LINE: 'Middle Line',
  BOTTOM_LINE: 'Bottom Line',
  BOX: 'Box Bonus',
  CORNER: 'Corner',
  STAR: 'Star',
  EARLY_5: 'Early 5',
  QUICK_6: 'Quick 6',
  QUICK_7: 'Quick 7',
}

const Poster = () => {
  const activeTheme = useGameStore((state) => state.activeTheme)
  const selectedWallpaper = getWallpaperSet(activeTheme)

  const [game, setGame] = useState<PublicGame | null>(null)
  const [summary, setSummary] = useState<PublicGameSummary | null>(null)
  const [prizes, setPrizes] = useState<PublicPrize[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const loadPosterData = async () => {
      try {
        const currentGame = await fetchCurrentPublicGame()
        if (!mounted || !currentGame) return

        setGame(currentGame)

        const [summaryData, prizesData] = await Promise.all([
          fetchGameSummary(currentGame.id),
          fetchPrizes(currentGame.id),
        ])

        if (!mounted) return

        setSummary(summaryData)
        setPrizes(prizesData)
      } catch {
        return
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void loadPosterData()

    return () => {
      mounted = false
    }
  }, [])

  if (loading || !game) {
    return <div className="poster-shell">Loading poster...</div>
  }

  const contactNumber = game.agent?.whatsapp_number?.trim()

  return (
    <div className="poster-shell">
      <div
        className="poster-card"
        style={{
          backgroundImage: `url(${selectedWallpaper.poster})`,
        }}
      >
        <div className="poster-overlay">

          <div className="poster-brand">TAMBOLA NIGHT</div>

          <div className="poster-title">{game.name}</div>

          <div className="poster-agent">
            Hosted By {game.agent?.name ?? '---'}
          </div>

          <div className="poster-big-highlight">
            WIN EXCITING CASH PRIZES!
          </div>

          <div className="poster-ticket-box">
            🎟 Ticket Price: ₹{game.ticket_price}
          </div>

          <div className="poster-ticket-limit">
            Limited Tickets: {summary?.game.total_tickets ?? '--'}
          </div>

          <div className="poster-date">
            📅 {formatDateTimeInIST(game.date)}
          </div>

          {contactNumber ? (
            <div className="poster-contact">
              Contact: {contactNumber}
            </div>
          ) : null}

          <div className="poster-section-title">PRIZES</div>

          <div className="poster-prizes">
            {prizes.map((prize) => (
              <>
                <div key={`${prize.prize_type}-label`}>
                  {PRIZE_LABEL_MAP[prize.prize_type] ?? prize.prize_type}
                </div>
                <div key={`${prize.prize_type}-amount`} className="amount">
                  ₹{prize.amount}
                </div>
              </>
            ))}
          </div>

          <div className="poster-cta">
            BOOK NOW & DON’T MISS THE FUN!
          </div>

        </div>
      </div>

      <button className="print-button" onClick={() => window.print()}>
        PRINT POSTER
      </button>
    </div>
  ) 

}

export default Poster
