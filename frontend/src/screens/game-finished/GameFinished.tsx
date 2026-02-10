import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchLatestPublicGame } from '@/api/rest/games'
import {
  fetchGameBusinessSummary,
  fetchGameSummary,
  fetchWinners,
  type PublicGameBusinessSummary,
  type PublicGameSummary,
  type PublicWinner,
} from '@/api/rest/gamePublic'
import type { PublicGame } from '@/types/backend/game'
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
  const [searchParams] = useSearchParams()
  const [games, setGames] = useState<PublicGame[]>([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [summary, setSummary] = useState<PublicGameSummary | null>(null)
  const [business, setBusiness] = useState<PublicGameBusinessSummary | null>(null)
  const [winners, setWinners] = useState<PublicWinner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const hydrateGames = async () => {
      try {
        const latestGame = await fetchLatestPublicGame()
        if (!mounted) return
        if (!latestGame) {
          setGames([])
          setSelectedGameId('')
          return
        }
        // Public side should only ever see the latest game.
        setGames([latestGame])
        setSelectedGameId(latestGame.id)
      } catch {
        if (!mounted) return
        setError('Unable to load games.')
      }
    }

    void hydrateGames()
    return () => {
      mounted = false
    }
  }, [searchParams])

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

  return (
    <main className="finished-shell">
      <section className="finished-header">
        <div>
          <h1>Game Finished Summary</h1>
          <p>{selectedGame ? new Date(selectedGame.date).toLocaleString() : '--'}</p>
        </div>
        <div className="finished-header-actions">
          <button type="button" className="ghost-btn" onClick={() => navigate('/')}>
            Lobby
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
              {new Date(game.date).toLocaleString()} ({game.status})
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
                      <td>{new Date(winner.won_at).toLocaleString()}</td>
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
