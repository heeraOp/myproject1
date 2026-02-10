import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import {
  getGameState,
  getGameSummary,
  getTickets,
  type GameSummaryResponse,
  type TicketResponse,
} from '@/api/rest/admin'
import { useGameSocket } from '@/app/hooks/useGameSocket'
import { useGameStore } from '@/app/store/game.store'
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
  const calledNumbers = useGameStore((state) => state.calledNumbers)
  const replaceFromBackendState = useGameStore((state) => state.replaceFromBackendState)

  // Keep called numbers synced via existing game websocket events.
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

    const loadState = async () => {
      if (!gameId) return
      try {
        const state = await getGameState(gameId)
        if (!mounted) return
        // Seed called numbers so ticket marking is accurate on refresh.
        replaceFromBackendState(state)
      } catch {
        return
      }
    }

    void loadState()

    return () => {
      mounted = false
    }
  }, [gameId, replaceFromBackendState])

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
        const data = await getTickets(gameId, showAll ? undefined : 'BOOKED')
        if (!mounted) return
        setTickets(data)
      } catch {
        if (!mounted) return
        setError('Unable to load tickets for this game.')
        setTickets([])
      } finally {
        if (!mounted) return
        setLoading(false)
      }
    }

    void loadTickets()

    return () => {
      mounted = false
    }
  }, [gameId, showAll])

  const bookedCount = useMemo(
    () => tickets.filter((ticket) => ticket.status === 'BOOKED').length,
    [tickets],
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
            Tickets ({showAll ? tickets.length : bookedCount}){showAll ? '' : ' booked'}
          </h2>
          {tickets.length === 0 ? (
            <div className="admin-message">No tickets found for this view.</div>
          ) : (
            <div>
              {tickets.map((ticket) => (
                <TambolaTicketCard
                  key={ticket.ticket_number}
                  ticket={ticket}
                  calledNumbers={calledNumbers}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}

export default AdminTicketView
