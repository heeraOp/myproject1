import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import AnnouncementBanner from '@/components/common/AnnouncementBanner'
import { fetchCurrentPublicGame, fetchPublicSupportSettings } from '@/api/rest/games'
import { fetchGameState } from '@/api/rest/gamePublic'
import { fetchGameTickets, requestTicketBooking } from '@/api/rest/tickets'
import { socketManager } from '@/api/websocket/socketManager'
import { useGameSocket } from '@/app/hooks/useGameSocket'
import { useGameStore } from '@/app/store/game.store'
import type { PublicGame } from '@/types/backend/game'
import { normalizeTicketStatus, type PlayerTicket } from '@/types/backend/ticket'
import {
  formatThemeLabel,
  getActiveTheme,
  isAdminThemeActive,
  setAdminTheme,
  subscribeThemeChange,
  toggleTheme,
} from '@/utils/theme'
import { formatDateInIST, formatTimeInIST } from '@/utils/dateTime'
import './Lobby.css'

const formatClock = (dateValue: string): string => {
  return formatTimeInIST(dateValue)
}

const formatDate = (dateValue: string): string => {
  return formatDateInIST(dateValue)
}

type SupportContact = {
  name: string
  whatsapp_number: string
}

const normalizeWhatsAppNumber = (value: string): string => value.replace(/\D/g, '')

const hasValidCountryCode = (digits: string): boolean => /^[1-9]\d{10,14}$/.test(digits)

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
  const [supportNotice, setSupportNotice] = useState<string>('')
  const [bookingNotice, setBookingNotice] = useState<string>('')
  const [requestingTicketNumber, setRequestingTicketNumber] = useState<number | null>(null)
  const [fallbackSupport, setFallbackSupport] = useState<SupportContact | null>(null)
  const [now, setNow] = useState(Date.now())
  const [theme, setTheme] = useState(getActiveTheme())
  const [isThemeLocked, setIsThemeLocked] = useState(isAdminThemeActive())
  const currentGameIdRef = useRef<string>('')
  const ticketFetchRequestRef = useRef(0)
  const {
    gameId: storeGameId,
    tickets: liveTickets,
    replaceFromBackendState,
    setTicketsFromBackend,
    setActiveTheme,
  } = useGameStore((state) => state)

  const handleThemeToggle = () => {
    if (isThemeLocked) return
    setTheme(toggleTheme())
  }

  useEffect(() => {
    return subscribeThemeChange(({ theme: updatedTheme, isLocked }) => {
      setTheme(updatedTheme)
      setIsThemeLocked(isLocked)
    })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let mounted = true
    const loadSupportSettings = async () => {
      try {
        const response = await fetchPublicSupportSettings()
        if (!mounted) return
        const number = String(response?.support?.whatsapp_number ?? '').trim()
        const name = String(response?.support?.name ?? '').trim() || 'Support'
        if (!number) {
          setFallbackSupport(null)
          return
        }
        setFallbackSupport({
          name,
          whatsapp_number: number,
        })
      } catch {
        if (!mounted) return
        setFallbackSupport(null)
      }
    }
    void loadSupportSettings()
    return () => {
      mounted = false
    }
  }, [])

  // Keep called numbers synced via the existing game websocket feed.
  useGameSocket(selectedGame?.id || undefined)

  useEffect(() => {
    let mounted = true

    const hydrateLobby = async () => {
      try {
        setLoading(true)
        setError(null)

        const currentGame = await fetchCurrentPublicGame()
        if (!mounted) return

        if (!currentGame) {
          setGames([])
          setSelectedGame(null)
          setTickets([])
          return
        }

        if (currentGame.active_theme) {
          setAdminTheme(currentGame.active_theme)
        }
        setActiveTheme(currentGame.active_theme ?? null)

        // Public side should only ever see the backend-active game.
        const game = currentGame
        setGames([currentGame])
        setSelectedGame(game)

        const gameTickets = await fetchGameTickets(game.id, playerPhone)
        if (!mounted) return
        setTicketsFromBackend(game.id, gameTickets)
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
  }, [playerPhone, searchParams, setActiveTheme, setTicketsFromBackend])

  const fetchTicketsForGame = useCallback(
    async (targetGameId: string) => {
      const requestId = ticketFetchRequestRef.current + 1
      ticketFetchRequestRef.current = requestId
      try {
        const latestTickets = await fetchGameTickets(targetGameId, playerPhone)
        if (ticketFetchRequestRef.current !== requestId) return
        if (currentGameIdRef.current !== targetGameId) return
        setTicketsFromBackend(targetGameId, latestTickets)
        setTickets(latestTickets)
      } catch {
        if (ticketFetchRequestRef.current !== requestId) return
        if (currentGameIdRef.current !== targetGameId) return
        setTicketsFromBackend(targetGameId, [])
        setTickets([])
      }
    },
    [playerPhone, setTicketsFromBackend],
  )

  useEffect(() => {
    const nextGameId = selectedGame?.id ?? ''
    currentGameIdRef.current = nextGameId
    ticketFetchRequestRef.current += 1

    if (!nextGameId) {
      setTickets([])
      return
    }

    setTickets([])
    setTicketsFromBackend(nextGameId, [])
    void fetchTicketsForGame(nextGameId)
  }, [fetchTicketsForGame, selectedGame?.id, setTicketsFromBackend])

  useEffect(() => {
    const unsubNewGame = socketManager.subscribe('new_game_created', async (event: unknown) => {
      const incoming = event as {
        data?: Partial<PublicGame> & { id?: string; name?: string }
        game_id?: string
        name?: string
        active_theme?: PublicGame['active_theme']
      }
      const payload = incoming.data
      const nextGameId =
        typeof payload?.id === 'string' ? payload.id : typeof incoming.game_id === 'string' ? incoming.game_id : ''
      if (!nextGameId) return

      const nextGame: PublicGame = {
        id: nextGameId,
        name: String(payload?.name ?? incoming.name ?? 'Tambola Game'),
        date: String(payload?.date ?? new Date().toISOString()),
        status: (payload?.status ?? 'CREATED') as PublicGame['status'],
        ticket_price: Number(payload?.ticket_price ?? 0),
        booking_status: (payload?.booking_status ?? 'OPEN') as PublicGame['booking_status'],
        website_status: (payload?.website_status ?? 'OPEN') as PublicGame['website_status'],
        agent: payload?.agent ?? null,
        active_theme: payload?.active_theme ?? incoming.active_theme,
        is_active: true,
      }

      if (nextGame.active_theme) {
        setAdminTheme(nextGame.active_theme)
      }
      setActiveTheme(nextGame.active_theme ?? null)
      setGames([nextGame])
      setSelectedGame(nextGame)
      setTickets([])
      setTicketsFromBackend(nextGameId, [])

      try {
        const state = await fetchGameState(nextGameId)
        if (currentGameIdRef.current !== nextGameId) return
        replaceFromBackendState(state)
      } catch {
        return
      }
    })

    const unsubTicketsGenerated = socketManager.subscribe('tickets_generated', async (event: unknown) => {
      const payload = (event as { data?: { game_id?: string } }).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !currentGameIdRef.current || eventGameId !== currentGameIdRef.current) return
      await fetchTicketsForGame(eventGameId)
    })

    const unsubTicketBooked = socketManager.subscribe('ticket_booked', async (event: unknown) => {
      const payload = (
        event as {
          data?: {
            game_id?: string
            ticket_id?: string
            status?: string
            player_name?: string
          }
        }
      ).data

      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !currentGameIdRef.current || eventGameId !== currentGameIdRef.current) return

      const ticketId = typeof payload?.ticket_id === 'string' ? payload.ticket_id : ''
      if (ticketId) {
        setTickets((prev) =>
          prev.map((ticket) =>
            ticket.id === ticketId
              ? {
                  ...ticket,
                  status:
                    typeof payload?.status === 'string'
                      ? (payload.status as PlayerTicket['status'])
                      : ticket.status,
                }
              : ticket,
          ),
        )
      }

      await fetchTicketsForGame(eventGameId)
    })

    return () => {
      unsubNewGame()
      unsubTicketsGenerated()
      unsubTicketBooked()
    }
  }, [fetchTicketsForGame, replaceFromBackendState, setActiveTheme, setTicketsFromBackend])

  useEffect(() => {
    let mounted = true
    const loadState = async () => {
      if (!selectedGame?.id) return
      try {
        const state = await fetchGameState(selectedGame.id)
        if (!mounted) return
        // Seed backend game state for number-board consistency on refresh.
        replaceFromBackendState(state)
      } catch {
        return
      }
    }
    void loadState()
    return () => {
      mounted = false
    }
  }, [replaceFromBackendState, selectedGame?.id])

  useEffect(() => {
    if (!selectedGame?.id || storeGameId !== selectedGame.id) return
    setTickets(liveTickets as PlayerTicket[])
  }, [liveTickets, selectedGame?.id, storeGameId])

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
    () => tickets.filter((ticket) => normalizeTicketStatus(ticket.status) === 'CONFIRMED').length,
    [tickets],
  )
  const currentGame = selectedGame

  const ticketsLeft = useMemo(() => {
    if (!selectedGame) return 0
    return Math.max(0, tickets.length - ticketsBooked)
  }, [selectedGame, tickets.length, ticketsBooked])

  const supportContact = useMemo<SupportContact | null>(() => {
    const agent = selectedGame?.agent
    if (agent?.whatsapp_number) {
      return {
        name: agent.name || 'Support',
        whatsapp_number: agent.whatsapp_number,
      }
    }
    return fallbackSupport
  }, [fallbackSupport, selectedGame?.agent])

  const supportDigits = useMemo(
    () => normalizeWhatsAppNumber(supportContact?.whatsapp_number ?? ''),
    [supportContact?.whatsapp_number],
  )

  const canContactSupport = hasValidCountryCode(supportDigits)

  useEffect(() => {
    setSupportNotice('')
  }, [selectedGame?.id, supportDigits])

  const handleContactSupport = () => {
    if (!canContactSupport || !supportContact) {
      setSupportNotice('Support not available')
      return
    }

    const supportName = supportContact.name || 'Admin'
    const message = encodeURIComponent(
      `Hello ${supportName}, I have a question about Game ${selectedGame?.id ?? 'current'}`,
    )
    const url = `https://wa.me/${supportDigits}?text=${message}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setSupportNotice('')
  }

  const handleRequestBooking = async (ticket: PlayerTicket) => {
    if (!selectedGame?.id) return
    if (normalizeTicketStatus(ticket.status) !== 'AVAILABLE') return

    const playerNameInput = window.prompt('Enter your name')
    if (playerNameInput === null) return
    const playerName = playerNameInput.trim()
    const whatsappInput = window.prompt('Enter your WhatsApp number', playerPhone ?? '')
    if (whatsappInput === null) return
    const whatsapp = whatsappInput.trim()
    if (!playerName || !whatsapp) {
      setBookingNotice('Enter player name and WhatsApp to request booking.')
      return
    }

    if (!ticket.id) {
      setBookingNotice('Unable to request this ticket right now. Please refresh and try again.')
      return
    }

    setRequestingTicketNumber(ticket.ticket_number)
    setBookingNotice('')
    try {
      await requestTicketBooking(ticket.id, {
        player_name: playerName,
        whatsapp,
      })

      const latestTickets = await fetchGameTickets(selectedGame.id, playerPhone)
      setTicketsFromBackend(selectedGame.id, latestTickets)
      setTickets(latestTickets)
      setBookingNotice(`Booking request sent for ticket ${ticket.ticket_number}.`)
    } catch (error: unknown) {
      const detail =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail ===
          'string'
          ? String((error as { response?: { data?: { detail?: string } } }).response?.data?.detail)
          : 'Unable to request booking right now.'
      setBookingNotice(detail)
    } finally {
      setRequestingTicketNumber(null)
    }
  }

  const enterLiveGame = () => {
    if (!selectedGame?.id) return
    navigate(`/live?gameId=${selectedGame.id}`)
  }

  return (
    <main className="lobby-shell">
      <h1 className="player-game-title">{currentGame?.name}</h1>
      <AnnouncementBanner gameId={selectedGame?.id} />
      <section className="lobby-panel">
        <div className="lobby-actions">
          <button
            className="action-link"
            type="button"
            onClick={handleContactSupport}
            disabled={!canContactSupport}
          >
            Contact Support (WhatsApp)
          </button>
          <button className="action-link" type="button">
            Agent list
          </button>
          <a className="action-link" href={import.meta.env.VITE_CALL_URL ?? '#'} target="_blank" rel="noreferrer">
            Call
          </a>
          <button className="action-link" type="button">
            Login
          </button>
          <button className="action-link" type="button" onClick={handleThemeToggle} disabled={isThemeLocked}>
            Theme: {formatThemeLabel(theme)}
          </button>
        </div>
        {supportContact?.name && <div className="support-meta">Support: {supportContact.name}</div>}
        {supportNotice && <div className="support-meta support-meta--warn">{supportNotice}</div>}
        {bookingNotice && <div className="booking-notice">{bookingNotice}</div>}

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
                {game.name} - {formatDate(game.date)} {formatClock(game.date)} ({game.status})
              </option>
            ))}
          </select>
        </div>
        <div className="support-meta">Game: {selectedGame?.name ?? '--'}</div>

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
          tickets.map((ticket) => (
            <TambolaTicketCard
              key={ticket.ticket_number}
              ticket={ticket}
              variant="player"
              onRequestBooking={handleRequestBooking}
              requestingTicketNumber={requestingTicketNumber}
            />
          ))}
      </section>
    </main>
  )
}

export default Lobby
