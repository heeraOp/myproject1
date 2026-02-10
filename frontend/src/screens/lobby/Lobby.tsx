import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import { fetchPublicGames } from '@/api/rest/games'
import { fetchGameTickets } from '@/api/rest/tickets'
import type { PublicGame } from '@/types/backend/game'
import type { PlayerTicket } from '@/types/backend/ticket'
import './Lobby.css'

const formatClock = (dateValue: string): string => {
  const date = new Date(dateValue)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const formatDate = (dateValue: string): string => {
  const date = new Date(dateValue)
  return date.toLocaleDateString()
}

const Lobby = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Optional: mark owned tickets without exposing other players (phone passed via URL).
  const playerPhone = searchParams.get('playerPhone') ?? undefined
  const [games, setGames] = useState<PublicGame[]>([])
  const [selectedGame, setSelectedGame] = useState<PublicGame | null>(null)
  const [tickets, setTickets] = useState<PlayerTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let mounted = true

    const hydrateLobby = async () => {
      try {
        setLoading(true)
        setError(null)

        const publicGames = await fetchPublicGames()
        if (!mounted) return

        setGames(publicGames)
        if (publicGames.length === 0) {
          setSelectedGame(null)
          setTickets([])
          return
        }

        const gameIdFromQuery = searchParams.get('gameId')
        const foundGame = gameIdFromQuery
          ? publicGames.find((game) => game.id === gameIdFromQuery)
          : null
        const runningGame = publicGames.find((game) => game.status === 'RUNNING')
        const game = foundGame ?? runningGame ?? publicGames[0]
        setSelectedGame(game)

        const gameTickets = await fetchGameTickets(game.id, playerPhone)
        if (!mounted) return
        setTickets(gameTickets)
      } catch {
        if (!mounted) return
        setError('Unable to load lobby data.')
      } finally {
        if (!mounted) return
        setLoading(false)
      }
    }

    void hydrateLobby()

    return () => {
      mounted = false
    }
  }, [searchParams])

  useEffect(() => {
    let mounted = true
    const loadTickets = async () => {
      if (!selectedGame?.id) return
      try {
        const gameTickets = await fetchGameTickets(selectedGame.id, playerPhone)
        if (!mounted) return
        setTickets(gameTickets)
      } catch {
        if (!mounted) return
        setTickets([])
      }
    }
    void loadTickets()
    return () => {
      mounted = false
    }
  }, [selectedGame?.id])

  const countdown = useMemo(() => {
    if (!selectedGame) {
      return { hours: 0, minutes: 0, seconds: 0 }
    }

    const startAt = new Date(selectedGame.date).getTime()
    const diff = Math.max(0, startAt - now)
    const totalSeconds = Math.floor(diff / 1000)

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return { hours, minutes, seconds }
  }, [now, selectedGame])

  const ticketsBooked = useMemo(
    () => tickets.filter((ticket) => ticket.status === 'BOOKED').length,
    [tickets],
  )

  const ticketsLeft = useMemo(() => {
    if (!selectedGame) return 0
    return Math.max(0, tickets.length - ticketsBooked)
  }, [selectedGame, tickets.length, ticketsBooked])

  const enterLiveGame = () => {
    if (!selectedGame?.id) return
    navigate(`/live?gameId=${selectedGame.id}`)
  }

  return (
    <main className="lobby-shell">
      <section className="lobby-panel">
        <div className="lobby-actions">
          <a className="action-link" href={import.meta.env.VITE_WHATSAPP_URL ?? '#'} target="_blank" rel="noreferrer">
            Whatsapp
          </a>
          <button className="action-link" type="button">
            Agent list
          </button>
          <a className="action-link" href={import.meta.env.VITE_CALL_URL ?? '#'} target="_blank" rel="noreferrer">
            Call
          </a>
          <button className="action-link" type="button">
            Login
          </button>
        </div>

        <div className="lobby-game-picker">
          <label htmlFor="lobby-game">Active game</label>
          <select
            id="lobby-game"
            value={selectedGame?.id ?? ''}
            onChange={(event) => {
              const game = games.find((item) => item.id === event.target.value) ?? null
              setSelectedGame(game)
            }}
            disabled={!games.length}
          >
            {!games.length && <option value="">No game</option>}
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {formatDate(game.date)} {formatClock(game.date)} ({game.status})
              </option>
            ))}
          </select>
        </div>

        <div className="check-title">CHECK AVAILABLE TICKET</div>

        <div className="lobby-status-row">
          <span className={`status-chip ${selectedGame?.status === 'RUNNING' ? 'running' : ''}`}>
            {selectedGame?.status ?? 'NO GAME'}
          </span>
          <span className={`status-chip ${selectedGame?.booking_status === 'OPEN' ? 'open' : 'closed'}`}>
            BOOKING {selectedGame?.booking_status ?? 'CLOSED'}
          </span>
          <button className="enter-live-btn" type="button" onClick={enterLiveGame} disabled={!selectedGame}>
            Enter Live Game
          </button>
        </div>

        <div className="count-labels">
          <span>Hours</span>
          <span>Minutes</span>
          <span>Seconds</span>
        </div>
        <div className="count-values">
          <span>{countdown.hours}</span>
          <span>{countdown.minutes}</span>
          <span>{countdown.seconds}</span>
        </div>

        <div className="date-time">
          <span>{selectedGame ? formatDate(selectedGame.date) : '--/--/----'}</span>
          <span>{selectedGame ? formatClock(selectedGame.date) : '--:--:--'}</span>
        </div>

        <div className="ticket-stats">
          <div>
            <strong>Total</strong>
            <span>{tickets.length}</span>
          </div>
          <div>
            <strong>Booked</strong>
            <span>{ticketsBooked}</span>
          </div>
          <div>
            <strong>Available</strong>
            <span>{ticketsLeft}</span>
          </div>
        </div>

        {loading && <div className="state-box">Loading tickets...</div>}
        {!loading && error && <div className="state-box state-error">{error}</div>}
        {!loading && !error && games.length === 0 && <div className="state-box">No active game available.</div>}

        {!loading &&
          !error &&
          tickets.map((ticket) => <TambolaTicketCard key={ticket.ticket_number} ticket={ticket} />)}
      </section>
    </main>
  )
}

export default Lobby
