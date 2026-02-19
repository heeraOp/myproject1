import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AnnouncementBanner from '@/components/common/AnnouncementBanner'
import { fetchCurrentPublicGame } from '@/api/rest/games'
import {
  fetchGameBusinessSummary,
  fetchGameSummary,
  fetchWinners,
  type PublicGameBusinessSummary,
  type PublicGameSummary,
  type PublicWinner,
} from '@/api/rest/gamePublic'
import type { PublicGame } from '@/types/backend/game'
import {
  formatThemeLabel,
  getActiveTheme,
  isAdminThemeActive,
  setAdminTheme,
  subscribeThemeChange,
  toggleTheme,
} from '@/utils/theme'
import { formatDateTimeInIST } from '@/utils/dateTime'
import { useGameSocket } from '@/app/hooks/useGameSocket'
import { useGameStore } from '@/app/store/game.store'
import './GameFinished.css'

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

const GameFinished = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [games, setGames] = useState<PublicGame[]>([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [summary, setSummary] = useState<PublicGameSummary | null>(null)
  const [business, setBusiness] = useState<PublicGameBusinessSummary | null>(null)
  const [winners, setWinners] = useState<PublicWinner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    return subscribeThemeChange(({ theme: updatedTheme, isLocked }) => {
      setTheme(updatedTheme)
      setIsThemeLocked(isLocked)
    })
  }, [])
  const [theme, setTheme] = useState(getActiveTheme())
  const [isThemeLocked, setIsThemeLocked] = useState(isAdminThemeActive())
  const setActiveTheme = useGameStore((state) => state.setActiveTheme)

  const handleThemeToggle = () => {
    if (isThemeLocked) return
    setTheme(toggleTheme())
  }

  useEffect(() => {
    let mounted = true
    const hydrateGames = async () => {
      try {
        const currentGame = await fetchCurrentPublicGame()
        if (!mounted) return
        if (!currentGame) {
          setGames([])
          setSelectedGameId('')
          return
        }
        if (currentGame.active_theme) {
          setAdminTheme(currentGame.active_theme)
        }
        setActiveTheme(currentGame.active_theme ?? null)
        // Public side should only ever see the backend-active game.
        setGames([currentGame])
        setSelectedGameId(currentGame.id)
      } catch {
        if (!mounted) return
        setError('Unable to load games.')
      }
    }

    void hydrateGames()
    return () => {
      mounted = false
    }
  }, [setActiveTheme])

  useEffect(() => {
    let mounted = true
    const loadFinishedData = async () => {
      if (!selectedGameId) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        const [summaryData, businessData, winnersData] = await Promise.all([
          fetchGameSummary(selectedGameId),
          fetchGameBusinessSummary(selectedGameId),
          fetchWinners(selectedGameId),
        ])
        if (!mounted) return
        setSummary(summaryData)
        setBusiness(businessData)
        setWinners(winnersData)
      } catch {
        if (!mounted) return
        setError('Unable to load finished game summary.')
      } finally {
        if (!mounted) return
        setLoading(false)
      }
    }

    void loadFinishedData()
    return () => {
      mounted = false
    }
  }, [selectedGameId])

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId],
  )
  const isAdminView = location.pathname.startsWith('/admin')

  useGameSocket(selectedGameId || undefined)

  return (
    <main className="finished-shell">
      <AnnouncementBanner gameId={selectedGameId || undefined} />
      <section className="finished-header">
        <div>
          <h1>
            {selectedGame?.name || summary?.game.name
              ? `${selectedGame?.name || summary?.game.name} - Finished Summary`
              : 'Game Finished Summary'}
          </h1>
          <p>{selectedGame ? formatDateTimeInIST(selectedGame.date) : '--'}</p>
        </div>
        <div className="finished-header-actions">
          <button type="button" className="ghost-btn" onClick={() => navigate('/')}>
            Lobby
          </button>
          <button type="button" className="ghost-btn" onClick={handleThemeToggle} disabled={isThemeLocked}>
            Theme: {formatThemeLabel(theme)}
          </button>
          <button type="button" className="primary-btn" onClick={() => navigate('/live')}>
            Live View
          </button>
        </div>
      </section>

      <section className="finished-select-card">
        <label htmlFor="finished-game">Game</label>
        <select
          id="finished-game"
          value={selectedGameId}
          onChange={(event) => setSelectedGameId(event.target.value)}
          disabled={!games.length}
        >
          {!games.length && <option value="">No game</option>}
          {games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name} - {formatDateTimeInIST(game.date)} ({game.status})
            </option>
          ))}
        </select>
      </section>

      {loading && <section className="finished-message">Loading summary...</section>}
      {error && <section className="finished-message error">{error}</section>}

      {!loading && !error && (
        <>
          <section className="finished-card">
            <h2>Result Status</h2>
            <div className="result-kv">
              <div>Game status</div>
              <div>{summary?.game.status ?? '--'}</div>
              <div>Total called numbers</div>
              <div>{summary?.called_numbers?.length ?? 0}</div>
              <div>Total winners</div>
              <div>{winners.length}</div>
            </div>
          </section>

          {isAdminView && (
            <section className="finished-card">
              <h2>Business Summary</h2>
              <div className="result-kv">
                <div>Total tickets</div>
                <div>{business?.total_tickets ?? '--'}</div>
                <div>Tickets booked</div>
                <div>{business?.tickets_booked ?? '--'}</div>
                <div>Tickets left</div>
                <div>{business?.tickets_left ?? '--'}</div>
                <div>Ticket price</div>
                <div>{summary?.game.ticket_price ?? '--'}</div>
                <div>Agent commission</div>
                <div>{summary?.game.agent_commission ?? '--'}</div>
                <div>Total revenue</div>
                <div>{business?.total_revenue ?? '--'}</div>
                <div>Total prize money</div>
                <div>{business?.total_prize_money ?? '--'}</div>
                <div>Total profit</div>
                <div>{business?.total_profit ?? '--'}</div>
              </div>
            </section>
          )}

          <section className="finished-card">
            <h2>Winner History</h2>
            <div className="finished-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Prize</th>
                    <th>Player</th>
                    <th>Ticket</th>
                    <th>Won At</th>
                  </tr>
                </thead>
                <tbody>
                  {winners.length === 0 && (
                    <tr>
                      <td colSpan={4}>No winners recorded.</td>
                    </tr>
                  )}
                  {winners.map((winner) => (
                    <tr key={winner.id}>
                      <td>{PRIZE_LABEL_MAP[winner.prize_type] ?? winner.prize_type}</td>
                      <td>{winner.player_name ?? 'Player'}</td>
                      <td>{winner.ticket_number}</td>
                      <td>{formatDateTimeInIST(winner.won_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

export default GameFinished
