import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import TambolaTicketGrid from '@/components/common/TambolaTicketGrid'
import {
  getGameSummary,
  getTickets,
  type GameSummaryResponse,
  type TicketResponse,
} from '@/api/rest/admin'
import { socketManager } from '@/api/websocket/socketManager'
import { useGameSocket } from '@/app/hooks/useGameSocket'
import { useGameStore } from '@/app/store/game.store'
import { normalizeTicketStatus } from '@/types/backend/ticket'
import '@/screens/admin-dashboard/AdminDashboard.css'

const AdminTicketView = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const gameId = searchParams.get('gameId') ?? ''
  const [tickets, setTickets] = useState<TicketResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(true)
  const [summary, setSummary] = useState<GameSummaryResponse | null>(null)
  const {
    gameId: storeGameId,
    tickets: liveTickets,
    setTicketsFromBackend,
  } = useGameStore((state) => state)

  useGameSocket(gameId || undefined)

  useEffect(() => {
    let mounted = true

    const loadSummary = async () => {
      if (!gameId) return
      try {
        const data = await getGameSummary(gameId)
        if (!mounted) return
        setSummary(data)
      } catch {
        if (!mounted) return
        setSummary(null)
      }
    }

    void loadSummary()

    return () => {
      mounted = false
    }
  }, [gameId])

  useEffect(() => {
    let mounted = true

    const loadTickets = async () => {
      if (!gameId) {
        setTickets([])
        setError('Select a game to view tickets.')
        return
      }

      setLoading(true)
      setError('')

      try {
        const data = await getTickets(gameId)
        if (!mounted) return
        setTicketsFromBackend(gameId, data)
        setTickets(data)
      } catch {
        if (!mounted) return
        setError('Unable to load tickets for this game.')
        setTickets([])
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void loadTickets()

    return () => {
      mounted = false
    }
  }, [gameId, setTicketsFromBackend])

  useEffect(() => {
    if (!gameId || storeGameId !== gameId) return
    setTickets(liveTickets as TicketResponse[])
  }, [gameId, liveTickets, storeGameId])

  useEffect(() => {
    const unsubNewGame = socketManager.subscribe('new_game_created', (event: unknown) => {
      const payload = (event as { data?: { id?: string } }).data
      const nextGameId = typeof payload?.id === 'string' ? payload.id : ''
      if (!nextGameId) return
      navigate(`/admin/tickets?gameId=${nextGameId}`, { replace: true })
    })

    const unsubTicketsGenerated = socketManager.subscribe('tickets_generated', async (event: unknown) => {
      if (!gameId) return
      const payload = (event as { data?: { game_id?: string } }).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || eventGameId !== gameId) return
      try {
        const latestTickets = await getTickets(gameId)
        setTicketsFromBackend(gameId, latestTickets)
        setTickets(latestTickets)
      } catch {
        return
      }
    })

    const unsubTicketBooked = socketManager.subscribe('ticket_booked', async (event: unknown) => {
      if (!gameId) return
      const payload = (event as { data?: { game_id?: string } }).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || eventGameId !== gameId) return
      try {
        const latestTickets = await getTickets(gameId)
        setTicketsFromBackend(gameId, latestTickets)
        setTickets(latestTickets)
      } catch {
        return
      }
    })

    return () => {
      unsubNewGame()
      unsubTicketsGenerated()
      unsubTicketBooked()
    }
  }, [gameId, navigate, setTicketsFromBackend])

  const visibleTickets = useMemo(
    () =>
      showAll
        ? tickets
        : tickets.filter((ticket) => normalizeTicketStatus(ticket.status) === 'CONFIRMED'),
    [showAll, tickets],
  )

  return (
    <main className="admin-page">
      <header className="admin-page__header">
        <h1>Current Tickets</h1>
        <div className="admin-page__toolbar">
          <button className="secondary-btn" type="button" onClick={() => navigate('/admin')}>
            Back to Dashboard
          </button>
          <button className="secondary-btn" type="button" onClick={() => setShowAll((prev) => !prev)}>
            {showAll ? 'Show Booked Only' : 'Show All'}
          </button>
        </div>
      </header>

      <section className="admin-view-banner">
        <div>
          <h2>Game Reference</h2>
          <p>Game Name: {summary?.game.name ?? '-'}</p>
          <p>Game ID: {gameId || 'Not selected'}</p>
          <p>Game Status: {summary?.game.status ?? '-'}</p>
          <p>Booking Status: {summary?.game.booking_status ?? '-'}</p>
        </div>
      </section>

      {loading && <div className="admin-message">Loading tickets...</div>}
      {error && <div className="admin-message error">{error}</div>}

      {!loading && !error && (
        <section className="admin-card">
          <h2>
            Tickets ({showAll ? tickets.length : visibleTickets.length}){showAll ? '' : ' booked'}
          </h2>
          {visibleTickets.length === 0 ? (
            <div className="admin-message">No tickets found for this view.</div>
          ) : (
            <TambolaTicketGrid className="admin-ticket-grid">
              {visibleTickets.map((ticket) => (
                <TambolaTicketCard
                  key={ticket.ticket_number}
                  ticket={ticket}
                />
              ))}
            </TambolaTicketGrid>
          )}
        </section>
      )}
    </main>
  )
}

export default AdminTicketView
