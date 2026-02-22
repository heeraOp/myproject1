import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import AnnouncementBanner from '@/components/common/AnnouncementBanner'
import GameMetaTopSheet from '@/components/common/GameMetaTopSheet'
import { fetchCurrentPublicGame, fetchPublicSupportSettings } from '@/api/rest/games'
import {
  fetchGameBusinessSummary,
  fetchGameState,
  type PublicGameBusinessSummary,
} from '@/api/rest/gamePublic'
import { fetchGameTickets, requestBulkTicketBooking } from '@/api/rest/tickets'
import { socketManager } from '@/api/websocket/socketManager'
import { useGameSocket } from '@/app/hooks/useGameSocket'
import { useGameStore } from '@/app/store/game.store'
import type { PublicGame } from '@/types/backend/game'
import { normalizeTicketStatus, type PlayerTicket } from '@/types/backend/ticket'
import { initGlobalAudioUnlock, unlockAudioFromUserGesture } from '@/utils/audioEngine'
import { playWinnerSoundFlow } from '@/utils/soundManager'
import { setAdminTheme } from '@/utils/theme'
import { formatDateInIST, formatTimeInIST } from '@/utils/dateTime'
import { playMusic, queueSpeakText, stopMusic } from '@/utils/speakText'
import playerLobbyBanner from '@/assets/player-lobby-banner.svg'
import './Lobby.css'

const formatClock = (dateValue: string): string => formatTimeInIST(dateValue)
const formatDate = (dateValue: string): string => formatDateInIST(dateValue)

type SupportContact = {
  name: string
  whatsapp_number: string
}

type GameRecreatedSocketPayload = {
  old_game_id?: string
  new_game_id?: string
  reason?: string
}

const normalizeWhatsAppNumber = (value: string): string => value.replace(/\D/g, '')
const hasValidCountryCode = (digits: string): boolean => /^[1-9]\d{10,14}$/.test(digits)
const PRE_GAME_ANNOUNCEMENTS: ReadonlyArray<{ thresholdMs: number; message: string; id: string }> = [
  {
    thresholdMs: 120000,
    id: '120',
    message: 'Attention players! The game will begin in about 2 minutes. Please get ready.',
  },
  {
    thresholdMs: 90000,
    id: '090',
    message: 'Players, only about 90 seconds left. Please keep your tickets ready.',
  },
  {
    thresholdMs: 60000,
    id: '060',
    message: 'One minute to go. Get ready for the live number calling.',
  },
  {
    thresholdMs: 30000,
    id: '030',
    message: 'Only 30 seconds left. Final call to get ready.',
  },
  {
    thresholdMs: 10000,
    id: '010',
    message: 'Game starts in a few seconds. Best of luck to all players.',
  },
]

const toLobbyGameStatus = (status: string | undefined): PublicGame['status'] => {
  if (status === 'FINISHED' || status === 'ENDED') return 'ENDED'
  if (status === 'BOOKING_OPEN' || status === 'RUNNING' || status === 'PAUSED' || status === 'CREATED') {
    return status
  }
  return 'CREATED'
}

const findFirstErrorMessage = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const text = value.trim()
    return text.length > 0 ? text : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFirstErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      const nested = findFirstErrorMessage(record[key])
      if (nested) return nested
    }
  }
  return null
}

const readErrorDetail = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const data = (error as { response?: { data?: unknown } }).response?.data
    const message = findFirstErrorMessage(data)
    if (message) return message
  }
  return fallback
}

const Lobby = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const playerPhone = searchParams.get('playerPhone') ?? undefined

  const [selectedGame, setSelectedGame] = useState<PublicGame | null>(null)
  const [tickets, setTickets] = useState<PlayerTicket[]>([])
  const [businessSummary, setBusinessSummary] = useState<PublicGameBusinessSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [supportNotice, setSupportNotice] = useState('')
  const [bookingNotice, setBookingNotice] = useState('')
  const [gameUpdatedBanner, setGameUpdatedBanner] = useState('')
  const [fallbackSupport, setFallbackSupport] = useState<SupportContact | null>(null)
  const [now, setNow] = useState(Date.now())
  const [showBookingDashboard, setShowBookingDashboard] = useState(false)
  const [selectedTicketNumbers, setSelectedTicketNumbers] = useState<number[]>([])
  const [bookingPlayerName, setBookingPlayerName] = useState('')
  const [bookingPlayerPhone, setBookingPlayerPhone] = useState(playerPhone ?? '')
  const [bookingPaymentMode, setBookingPaymentMode] = useState('Cheque')
  const [bookingInProgress, setBookingInProgress] = useState(false)
  const [requestingTicketNumber, setRequestingTicketNumber] = useState<number | null>(null)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('housie_player_sound_enabled') !== '0'
  })

  const currentGameIdRef = useRef<string>('')
  const ticketFetchRequestRef = useRef(0)
  const businessFetchRequestRef = useRef(0)
  const preGameAnnouncementLogRef = useRef<Set<string>>(new Set())
  const preGameMusicKeyRef = useRef<string>('')
  const preGameLastAttemptAtRef = useRef<number>(0)
  const hasAutoEnteredLiveRef = useRef(false)

  const {
    gameId: storeGameId,
    tickets: liveTickets,
    replaceFromBackendState,
    setTicketsFromBackend,
    setActiveTheme,
  } = useGameStore((state) => state)

  useEffect(() => {
    setBookingPlayerPhone(playerPhone ?? '')
  }, [playerPhone])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('housie_player_sound_enabled', soundEnabled ? '1' : '0')
  }, [soundEnabled])

  useEffect(() => {
    if (!gameUpdatedBanner) return
    const timer = window.setTimeout(() => setGameUpdatedBanner(''), 5000)
    return () => window.clearTimeout(timer)
  }, [gameUpdatedBanner])

  useEffect(() => {
    initGlobalAudioUnlock()
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

  useGameSocket(selectedGame?.id || undefined)

  const queuedWinner = useGameStore((state) => state.winnerQueue[0] ?? null)
  const processedWinnerRef = useRef<string | null>(null)

  useEffect(() => {
    if (!queuedWinner) return
    const key = String(queuedWinner.id)
    if (processedWinnerRef.current === key) return
    processedWinnerRef.current = key
    const name = queuedWinner.winner_name ?? 'Player'
    const prize = queuedWinner.prize_name ?? 'Prize'
    const announcement = `Congratulations ${name}! You won ${prize}.`
    void playWinnerSoundFlow(announcement).catch(() => undefined)
  }, [queuedWinner])

  const hydrateLobbyGame = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const currentGame = await fetchCurrentPublicGame()

      if (!currentGame) {
        setSelectedGame(null)
        setTickets([])
        setBusinessSummary(null)
        setLoading(false)
        return
      }

      if (currentGame.active_theme) {
        setAdminTheme(currentGame.active_theme)
      }
      setActiveTheme(currentGame.active_theme ?? null)

      setSelectedGame({
        ...currentGame,
        status: toLobbyGameStatus(currentGame.status),
      })
    } catch {
      setError('Unable to load lobby data.')
      setLoading(false)
    }
  }, [setActiveTheme])

  useEffect(() => {
    void hydrateLobbyGame()
  }, [hydrateLobbyGame])

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

  const fetchBusinessSummaryForGame = useCallback(async (targetGameId: string) => {
    const requestId = businessFetchRequestRef.current + 1
    businessFetchRequestRef.current = requestId
    try {
      const summary = await fetchGameBusinessSummary(targetGameId)
      if (businessFetchRequestRef.current !== requestId) return
      if (currentGameIdRef.current !== targetGameId) return
      setBusinessSummary(summary)
    } catch {
      if (businessFetchRequestRef.current !== requestId) return
      if (currentGameIdRef.current !== targetGameId) return
      setBusinessSummary(null)
    }
  }, [])

  const loadStateForGame = useCallback(
    async (targetGameId: string) => {
      try {
        const state = await fetchGameState(targetGameId)
        if (currentGameIdRef.current !== targetGameId) return
        replaceFromBackendState(state)
      } catch {
        return
      }
    },
    [replaceFromBackendState],
  )

  const navigateToLiveGame = useCallback(
    (isUserGesture: boolean) => {
      if (isUserGesture) {
        void unlockAudioFromUserGesture()
      }

      const params = new URLSearchParams()
      const normalizedPhone = String(playerPhone ?? '').trim()
      if (normalizedPhone) {
        params.set('playerPhone', normalizedPhone)
      }
      navigate(`/live${params.toString() ? `?${params.toString()}` : ''}`)
    },
    [navigate, playerPhone],
  )

  useEffect(() => {
    const nextGameId = selectedGame?.id ?? ''
    currentGameIdRef.current = nextGameId
    ticketFetchRequestRef.current += 1
    businessFetchRequestRef.current += 1
    setSelectedTicketNumbers([])

    if (!nextGameId) {
      setTickets([])
      setBusinessSummary(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setTickets([])
    setBusinessSummary(null)
    setTicketsFromBackend(nextGameId, [])

    void (async () => {
      await Promise.all([
        fetchTicketsForGame(nextGameId),
        fetchBusinessSummaryForGame(nextGameId),
        loadStateForGame(nextGameId),
      ])
      if (currentGameIdRef.current !== nextGameId) return
      setLoading(false)
    })()
  }, [
    fetchBusinessSummaryForGame,
    fetchTicketsForGame,
    loadStateForGame,
    selectedGame?.id,
    setTicketsFromBackend,
  ])

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
        status: toLobbyGameStatus(typeof payload?.status === 'string' ? payload.status : 'CREATED'),
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
      setSelectedGame(nextGame)
      setTickets([])
      setBusinessSummary(null)
      setTicketsFromBackend(nextGameId, [])
    })

    const unsubGameRecreated = socketManager.subscribe('game_recreated', (event: unknown) => {
      const payload = (event as { data?: GameRecreatedSocketPayload }).data
      const nextGameId = typeof payload?.new_game_id === 'string' ? payload.new_game_id : ''
      if (!nextGameId) return

      setGameUpdatedBanner('Game has been updated.')
      setShowBookingDashboard(false)
      setSelectedTicketNumbers([])
      hasAutoEnteredLiveRef.current = false
      void hydrateLobbyGame()
    })

    const unsubGameStarted = socketManager.subscribe('game.started', () => {
      setSelectedGame((previous) => {
        if (!previous) return previous
        if (currentGameIdRef.current && previous.id !== currentGameIdRef.current) return previous
        return {
          ...previous,
          status: 'RUNNING',
        }
      })
    })

    const unsubTicketsGenerated = socketManager.subscribe('tickets_generated', async (event: unknown) => {
      const payload = (event as { data?: { game_id?: string } }).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !currentGameIdRef.current || eventGameId !== currentGameIdRef.current) return
      await Promise.all([
        fetchTicketsForGame(eventGameId),
        fetchBusinessSummaryForGame(eventGameId),
      ])
    })

    const handleGameUpdate = (event: unknown) => {
      const payload = (
        event as {
          data?: {
            game_id?: string
            changed_fields?: Partial<PublicGame> & { status?: string }
          }
        }
      ).data

      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !currentGameIdRef.current || eventGameId !== currentGameIdRef.current) return

      const changedFields = payload?.changed_fields
      if (!changedFields || typeof changedFields !== 'object') return

      setSelectedGame((previous) => {
        if (!previous || previous.id !== eventGameId) return previous
        const nextStatus =
          typeof changedFields.status === 'string'
            ? toLobbyGameStatus(changedFields.status)
            : previous.status
        return {
          ...previous,
          ...changedFields,
          status: nextStatus,
        }
      })

      if (typeof changedFields.active_theme === 'string' && changedFields.active_theme) {
        setAdminTheme(changedFields.active_theme)
        setActiveTheme(changedFields.active_theme)
      }
    }
    const unsubGameUpdate = socketManager.subscribe('game_update', handleGameUpdate)
    const unsubGameUpdateUpper = socketManager.subscribe('GAME_UPDATE', handleGameUpdate)

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
        setTickets((previous) =>
          previous.map((ticket) =>
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

      await Promise.all([
        fetchTicketsForGame(eventGameId),
        fetchBusinessSummaryForGame(eventGameId),
      ])
    })

    const unsubGameFinished = socketManager.subscribe('game.finished', (event: unknown) => {
      const payload = event as { status?: string }
      const nextStatus = toLobbyGameStatus(
        typeof payload?.status === 'string' ? payload.status : 'ENDED',
      )
      if (nextStatus !== 'ENDED') return

      setSelectedGame((previous) => {
        if (!previous) return previous
        if (currentGameIdRef.current && previous.id !== currentGameIdRef.current) return previous
        return { ...previous, status: 'ENDED' }
      })
    })

    return () => {
      unsubNewGame()
      unsubGameRecreated()
      unsubGameStarted()
      unsubTicketsGenerated()
      unsubGameUpdate()
      unsubGameUpdateUpper()
      unsubTicketBooked()
      unsubGameFinished()
    }
  }, [
    fetchBusinessSummaryForGame,
    fetchTicketsForGame,
    hydrateLobbyGame,
    setActiveTheme,
    setTicketsFromBackend,
  ])

  useEffect(() => {
    if (!selectedGame?.id || storeGameId !== selectedGame.id) return
    setTickets(liveTickets as PlayerTicket[])
  }, [liveTickets, selectedGame?.id, storeGameId])

  const countdown = useMemo(() => {
    if (!selectedGame) return { hours: 0, minutes: 0, seconds: 0 }
    const startAt = new Date(selectedGame.date).getTime()
    const diff = Math.max(0, startAt - now)
    const totalSeconds = Math.floor(diff / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return { hours, minutes, seconds }
  }, [now, selectedGame])

  const digitalCountdown = `${String(countdown.hours).padStart(2, '0')}:${String(
    countdown.minutes,
  ).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`

  const orderedTickets = useMemo(
    () => [...tickets].sort((first, second) => first.ticket_number - second.ticket_number),
    [tickets],
  )

  useEffect(() => {
    const availableNumbers = new Set(
      tickets
        .filter((ticket) => normalizeTicketStatus(ticket.status) === 'AVAILABLE')
        .map((ticket) => ticket.ticket_number),
    )
    setSelectedTicketNumbers((previous) => {
      const next = previous.filter((ticketNumber) => availableNumbers.has(ticketNumber))
      return next.length === previous.length ? previous : next
    })
  }, [tickets])

  const selectedTickets = useMemo(() => {
    const ticketMap = new Map(orderedTickets.map((ticket) => [ticket.ticket_number, ticket]))
    return selectedTicketNumbers
      .map((ticketNumber) => ticketMap.get(ticketNumber))
      .filter((ticket): ticket is PlayerTicket => Boolean(ticket))
  }, [orderedTickets, selectedTicketNumbers])

  const selectedBookingMode: 'HALF_SHEET' | 'FULL_SHEET' | null =
    selectedTicketNumbers.length === 6 ? 'FULL_SHEET' : selectedTicketNumbers.length === 3 ? 'HALF_SHEET' : null

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
  const isBookingClosed = selectedGame?.status === 'ENDED' || selectedGame?.booking_status === 'CLOSED'
  const gameDisplayName = selectedGame?.name?.trim() || 'Tambola Game'

  useEffect(() => {
    if (!soundEnabled) return
    if (!selectedGame?.id || !selectedGame.date) return
    if (selectedGame.status === 'RUNNING' || selectedGame.status === 'PAUSED' || selectedGame.status === 'ENDED') {
      return
    }

    const startAt = new Date(selectedGame.date).getTime()
    if (!Number.isFinite(startAt)) return

    const timeToStartMs = startAt - now
    const withinPreGameWindow = timeToStartMs > 0 && timeToStartMs <= 2 * 60 * 1000
    if (!withinPreGameWindow) return

    const gameKey = `${selectedGame.id}:${selectedGame.date}`

    if (preGameMusicKeyRef.current !== gameKey) {
      preGameMusicKeyRef.current = gameKey
      void playMusic('/sounds/intro_music.mp3', {
        loop: true,
        volume: 0.25,
        fadeInMs: 600,
      })
    }

    const nextAnnouncement = PRE_GAME_ANNOUNCEMENTS.find(
      (item) =>
        timeToStartMs <= item.thresholdMs &&
        !preGameAnnouncementLogRef.current.has(`${gameKey}:${item.id}`),
    )
    if (!nextAnnouncement) return

    if (now - preGameLastAttemptAtRef.current < 12000) return
    preGameLastAttemptAtRef.current = now

    void (async () => {
      const played = await queueSpeakText(nextAnnouncement.message, 'dramatic')
      if (!played) return
      preGameAnnouncementLogRef.current.add(`${gameKey}:${nextAnnouncement.id}`)
    })()
  }, [now, selectedGame?.date, selectedGame?.id, selectedGame?.status, soundEnabled])

  useEffect(() => {
    const status = selectedGame?.status
    if (status !== 'RUNNING') return
    void stopMusic({ fadeOutMs: 1200 })
  }, [selectedGame?.status])

  useEffect(() => {
    if (!selectedGame?.id) {
      hasAutoEnteredLiveRef.current = false
      return
    }

    if (selectedGame.status !== 'RUNNING') {
      hasAutoEnteredLiveRef.current = false
      return
    }

    if (hasAutoEnteredLiveRef.current) return
    hasAutoEnteredLiveRef.current = true
    navigateToLiveGame(false)
  }, [navigateToLiveGame, selectedGame?.id, selectedGame?.status])

  useEffect(() => {
    if (soundEnabled) return
    preGameMusicKeyRef.current = ''
    preGameLastAttemptAtRef.current = 0
    void stopMusic({ fadeOutMs: 400 })
  }, [soundEnabled])

  useEffect(() => {
    return () => {
      void stopMusic({ fadeOutMs: 400 })
    }
  }, [])

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
    window.open(`https://wa.me/${supportDigits}?text=${message}`, '_blank', 'noopener,noreferrer')
    setSupportNotice('')
  }

  const openBookingDashboard = () => {
    setShowBookingDashboard(true)
    setBookingNotice('')
    if (selectedGame?.id) {
      void Promise.all([
        fetchTicketsForGame(selectedGame.id),
        fetchBusinessSummaryForGame(selectedGame.id),
      ])
    }
  }

  const closeBookingDashboard = () => {
    setShowBookingDashboard(false)
    setSelectedTicketNumbers([])
  }

  const toggleTicketSelection = (ticket: PlayerTicket) => {
    if (isBookingClosed) {
      setBookingNotice('Booking is closed for this game.')
      return
    }
    if (normalizeTicketStatus(ticket.status) !== 'AVAILABLE') return

    setSelectedTicketNumbers((previous) => {
      if (previous.includes(ticket.ticket_number)) {
        return previous.filter((ticketNumber) => ticketNumber !== ticket.ticket_number)
      }
      return [...previous, ticket.ticket_number].sort((first, second) => first - second)
    })
    setBookingNotice('')
  }

  const handleBookNow = async () => {
    if (!selectedGame?.id) return
    if (isBookingClosed) {
      setBookingNotice('Booking is closed for this game.')
      return
    }

    const sortedTicketNumbers = [...selectedTicketNumbers].sort((first, second) => first - second)
    if (sortedTicketNumbers.length === 0) {
      setBookingNotice('Select tickets to continue.')
      return
    }
    if (selectedTickets.some((ticket) => normalizeTicketStatus(ticket.status) !== 'AVAILABLE')) {
      setBookingNotice('One or more selected tickets are no longer available.')
      return
    }

    let playerNameValue = bookingPlayerName.trim()
    if (!playerNameValue) {
      const nameInput = window.prompt('Enter your name')
      if (nameInput === null) return
      playerNameValue = nameInput.trim()
    }

    let playerPhoneValue = bookingPlayerPhone.trim() || String(playerPhone ?? '').trim()
    if (!playerPhoneValue) {
      const phoneInput = window.prompt('Enter your WhatsApp number', playerPhone ?? '')
      if (phoneInput === null) return
      playerPhoneValue = phoneInput.trim()
    }

    if (!playerNameValue || !playerPhoneValue) {
      setBookingNotice('Enter player name and WhatsApp to continue.')
      return
    }

    let paymentModeValue = bookingPaymentMode.trim()
    if (!paymentModeValue) {
      const paymentInput = window.prompt('Enter payment mode (e.g., Cheque)', 'Cheque')
      if (paymentInput === null) return
      paymentModeValue = paymentInput.trim()
    }

    if (!paymentModeValue) {
      setBookingNotice('Enter payment mode to continue.')
      return
    }

    setBookingPlayerName(playerNameValue)
    setBookingPlayerPhone(playerPhoneValue)
    setBookingPaymentMode(paymentModeValue)
    setBookingInProgress(true)
    setBookingNotice('')

    try {
      const bookingType =
        sortedTicketNumbers.length === 6
          ? 'fullsheet'
          : sortedTicketNumbers.length === 3
            ? 'halfsheet'
            : 'random'
      const bookingResult = await requestBulkTicketBooking({
        game_id: selectedGame.id,
        ticket_numbers: sortedTicketNumbers,
        booking_type: bookingType,
        player_name: playerNameValue,
        whatsapp: playerPhoneValue,
        payment_mode: paymentModeValue,
      })

      const redirectUrl = String(bookingResult.whatsapp_redirect_url ?? '').trim()
      if (redirectUrl) {
        window.location.href = redirectUrl
        return
      }

      await Promise.all([
        fetchTicketsForGame(selectedGame.id),
        fetchBusinessSummaryForGame(selectedGame.id),
      ])
      setSelectedTicketNumbers([])

      const requestedCount = bookingResult.requested_ticket_count ?? sortedTicketNumbers.length
      const privilegeLabel = bookingResult.eligible_privileges.full_sheet_bonus
        ? 'Full Sheet bonus eligible.'
        : bookingResult.eligible_privileges.half_sheet_bonus
          ? 'Half Sheet bonus eligible.'
          : 'Sheet bonus not enabled yet.'
      setBookingNotice(`Booking request sent for ${requestedCount} tickets. ${privilegeLabel}`)
    } catch (errorValue) {
      setBookingNotice(readErrorDetail(errorValue, 'Unable to request booking right now.'))
    } finally {
      setBookingInProgress(false)
    }
  }

  const ticketsBookedCount = businessSummary?.tickets_booked ?? 0
  const halfsheetBookedCount = businessSummary?.halfsheet_booked ?? 0
  const fullsheetBookedCount = businessSummary?.fullsheet_booked ?? 0

  const handleEnterLiveGame = () => {
    navigateToLiveGame(true)
  }

  const handleRequestBooking = async (ticket: PlayerTicket) => {
    if (!selectedGame?.id) return
    if (isBookingClosed) {
      setBookingNotice('Booking is closed for this game.')
      return
    }
    if (normalizeTicketStatus(ticket.status) !== 'AVAILABLE') return

    let playerNameValue = bookingPlayerName.trim()
    if (!playerNameValue) {
      const nameInput = window.prompt('Enter your name')
      if (nameInput === null) return
      playerNameValue = nameInput.trim()
    }

    let playerPhoneValue = bookingPlayerPhone.trim() || String(playerPhone ?? '').trim()
    if (!playerPhoneValue) {
      const phoneInput = window.prompt('Enter your WhatsApp number', playerPhone ?? '')
      if (phoneInput === null) return
      playerPhoneValue = phoneInput.trim()
    }

    if (!playerNameValue || !playerPhoneValue) {
      setBookingNotice('Enter player name and WhatsApp to continue.')
      return
    }

    let paymentModeValue = bookingPaymentMode.trim()
    if (!paymentModeValue) {
      const paymentInput = window.prompt('Enter payment mode (e.g., Cheque)', 'Cheque')
      if (paymentInput === null) return
      paymentModeValue = paymentInput.trim()
    }

    if (!paymentModeValue) {
      setBookingNotice('Enter payment mode to continue.')
      return
    }

    setBookingPlayerName(playerNameValue)
    setBookingPlayerPhone(playerPhoneValue)
    setBookingPaymentMode(paymentModeValue)
    setRequestingTicketNumber(ticket.ticket_number)
    setBookingNotice('')
    try {
      const bookingResult = await requestBulkTicketBooking({
        game_id: selectedGame.id,
        ticket_number: ticket.ticket_number,
        booking_type: 'random',
        player_name: playerNameValue,
        whatsapp: playerPhoneValue,
        payment_mode: paymentModeValue,
      })

      const redirectUrl = String(bookingResult.whatsapp_redirect_url ?? '').trim()
      if (redirectUrl) {
        window.location.href = redirectUrl
        return
      }

      await Promise.all([
        fetchTicketsForGame(selectedGame.id),
        fetchBusinessSummaryForGame(selectedGame.id),
      ])
      const privilegeLabel = bookingResult.eligible_privileges.full_sheet_bonus
        ? 'Full Sheet bonus eligible.'
        : bookingResult.eligible_privileges.half_sheet_bonus
          ? 'Half Sheet bonus eligible.'
          : 'Sheet bonus not enabled yet.'
      setBookingNotice(`Booking request sent for ticket ${ticket.ticket_number}. ${privilegeLabel}`)
    } catch (errorValue) {
      setBookingNotice(readErrorDetail(errorValue, 'Unable to request booking right now.'))
    } finally {
      setRequestingTicketNumber(null)
    }
  }

  return (
    <main
      className="lobby-shell"
      style={{
        minHeight: '100vh',
        background: '#e8c7c7',
        padding: '10px 10px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      {!showBookingDashboard && (
        <GameMetaTopSheet
          refreshKey={selectedGame?.id ?? null}
          gameNameOverride={selectedGame?.name ?? null}
          ticketPriceOverride={selectedGame?.ticket_price ?? null}
          gameStatusOverride={selectedGame?.status ?? null}
        />
      )}
      <AnnouncementBanner gameId={selectedGame?.id || undefined} enableSound={soundEnabled} />
      {gameUpdatedBanner && (
        <div
          style={{
            position: 'fixed',
            top: '14px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 90,
            width: 'min(640px, calc(100% - 24px))',
            borderRadius: '10px',
            border: '1px solid #29b34a',
            background: 'rgba(11, 66, 24, 0.96)',
            color: '#eaffef',
            fontWeight: 700,
            textAlign: 'center',
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
          }}
        >
          {gameUpdatedBanner}
        </div>
      )}
      <section
        className="lobby-panel"
        style={{
          width: '100%',
          maxWidth: '1100px',
          margin: 0,
          background: 'transparent',
          border: 'none',
          backdropFilter: 'none',
          padding: 0,
          borderRadius: 0,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            minHeight: 'clamp(130px, 18vw, 260px)',
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundImage: `url(${playerLobbyBanner})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            marginBottom: '8px',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 clamp(14px, 4vw, 42px) 0 clamp(120px, 18vw, 300px)',
            }}
          >
            <div
              style={{
                width: '100%',
                textAlign: 'center',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 'clamp(18px, 3.1vw, 48px)',
                letterSpacing: '0.5px',
                lineHeight: 1.1,
                textShadow: '0 3px 12px rgba(0, 0, 0, 0.75)',
                textTransform: 'uppercase',
              }}
            >
              {gameDisplayName}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={handleContactSupport}
            disabled={!canContactSupport}
            style={{
              background: '#008b10',
              border: '3px solid #6b6b6b',
              borderRadius: '10px',
              color: '#fff',
              fontSize: 'clamp(18px, 2.2vw, 30px)',
              fontWeight: 700,
              padding: '12px 10px',
              cursor: canContactSupport ? 'pointer' : 'not-allowed',
            }}
          >
            Whatsapp
          </button>
          <button
            type="button"
            onClick={() =>
              setSoundEnabled((previous) => {
                const next = !previous
                if (next) {
                  void unlockAudioFromUserGesture()
                }
                return next
              })
            }
            style={{
              background: '#111',
              border: '3px solid #6b6b6b',
              borderRadius: '10px',
              color: '#fff',
              fontSize: 'clamp(18px, 2.2vw, 30px)',
              fontWeight: 700,
              padding: '12px 10px',
              cursor: 'pointer',
            }}
          >
            Sound: {soundEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            style={{
              background: '#f20f0f',
              border: '3px solid #6b6b6b',
              borderRadius: '10px',
              color: '#fff',
              fontSize: 'clamp(18px, 2.2vw, 30px)',
              fontWeight: 700,
              padding: '12px 10px',
              cursor: 'pointer',
            }}
          >
            Agent list
          </button>
        </div>

        <button
          className="check-title"
          type="button"
          onClick={openBookingDashboard}
          disabled={!selectedGame}
          style={{
            margin: '28px auto 0',
            width: 'min(900px, 100%)',
            minHeight: '220px',
            borderRadius: 0,
            border: 'none',
            background: '#000',
            color: '#ff0f0f',
            fontSize: 'clamp(44px, 6vw, 84px)',
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: '1px',
            textShadow: '0 0 18px rgba(255, 0, 0, 0.95)',
            cursor: selectedGame ? 'pointer' : 'not-allowed',
            padding: '20px',
          }}
        >
          CHECK AVAILABLE TICKET
        </button>

        <div
          style={{
            margin: '30px auto 0',
            width: 'min(900px, 100%)',
            background: '#efefef',
            borderRadius: '0 0 24px 24px',
            textAlign: 'center',
            padding: '24px 12px 34px',
          }}
        >
          <div
            style={{
              color: '#000',
              fontSize: 'clamp(80px, 12vw, 170px)',
              lineHeight: 1,
              fontWeight: 500,
            }}
          >
            {digitalCountdown}
          </div>
          <div
            style={{
              marginTop: '18px',
              color: '#111',
              fontSize: 'clamp(30px, 4.2vw, 54px)',
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            {selectedGame ? `${formatDate(selectedGame.date)} ${formatClock(selectedGame.date)}` : '--/--/---- --:--:--'}
          </div>
        </div>

        <div
          style={{
            margin: '12px auto 0',
            width: 'min(900px, 100%)',
            borderRadius: '12px',
            border: '2px solid #6b6b6b',
            background: '#ffffff',
            color: '#111',
            textAlign: 'center',
            padding: '10px 12px',
            fontWeight: 700,
            fontSize: 'clamp(16px, 2vw, 28px)',
          }}
        >
          Game Status: {selectedGame?.status ?? 'NO GAME'}
        </div>

        <button
          type="button"
          onClick={handleEnterLiveGame}
          disabled={!selectedGame}
          style={{
            margin: '10px auto 0',
            width: 'min(900px, 100%)',
            border: 'none',
            borderRadius: '12px',
            background: '#111',
            color: '#fff',
            textAlign: 'center',
            padding: '12px 14px',
            fontWeight: 800,
            fontSize: 'clamp(18px, 2.1vw, 30px)',
            cursor: selectedGame ? 'pointer' : 'not-allowed',
            opacity: selectedGame ? 1 : 0.6,
          }}
        >
          ENTER LIVE GAME
        </button>

        {error && (
          <div
            style={{
              marginTop: '14px',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #ff8f8f',
              background: '#fff2f2',
              color: '#9f0000',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        {supportNotice && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #ffbebe',
              background: '#fff5f5',
              color: '#9f0000',
              fontWeight: 600,
            }}
          >
            {supportNotice}
          </div>
        )}

        {bookingNotice && !showBookingDashboard && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #d7d7d7',
              background: '#fff',
              color: '#111',
              fontWeight: 600,
            }}
          >
            {bookingNotice}
          </div>
        )}

        <section
          style={{
            marginTop: '20px',
            width: '100%',
          }}
        >
          {loading && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid #d7d7d7',
                background: '#fff',
                color: '#111',
                fontWeight: 600,
              }}
            >
              Loading tickets...
            </div>
          )}

          {!loading && !error && orderedTickets.length === 0 && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid #d7d7d7',
                background: '#fff',
                color: '#111',
                fontWeight: 600,
              }}
            >
              No tickets available for this game.
            </div>
          )}

          {!loading && !error && orderedTickets.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: '14px',
                alignItems: 'start',
              }}
            >
              {orderedTickets.map((ticket) => (
                <TambolaTicketCard
                  key={ticket.ticket_number}
                  ticket={ticket}
                  variant="player"
                  onRequestBooking={handleRequestBooking}
                  requestingTicketNumber={requestingTicketNumber}
                  bookingClosed={isBookingClosed}
                />
              ))}
            </div>
          )}
        </section>

        {showBookingDashboard && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 50,
              background: 'rgba(0, 0, 0, 0.45)',
              padding: '10px',
              overflowY: 'auto',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
            }}
          >
            <section
              style={{
                width: 'min(980px, 100%)',
                border: '6px solid #ffd400',
                borderRadius: '12px',
                background: '#1a0649',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
              }}
            >
              <header
                style={{
                  background: '#000',
                  padding: '16px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '2px solid #230066',
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    color: '#ff1d1d',
                    fontSize: 'clamp(28px, 3.2vw, 54px)',
                    fontWeight: 800,
                    textShadow: '0 0 14px rgba(255, 0, 0, 0.9)',
                    textTransform: 'capitalize',
                  }}
                >
                  Booking dashboard
                </h2>
                <button
                  type="button"
                  onClick={closeBookingDashboard}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#f0f0f0',
                    fontSize: 'clamp(36px, 4vw, 64px)',
                    lineHeight: 1,
                    cursor: 'pointer',
                    fontWeight: 300,
                    padding: 0,
                  }}
                  aria-label="Close booking dashboard"
                >
                  X
                </button>
              </header>

              <div style={{ padding: '12px 14px 16px' }}>
                <input
                  value={bookingPlayerName}
                  onChange={(event) => setBookingPlayerName(event.target.value)}
                  placeholder="Enter your name"
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid #c8c8c8',
                    fontSize: 'clamp(18px, 2.1vw, 28px)',
                    padding: '10px 12px',
                    marginBottom: '10px',
                    outline: 'none',
                  }}
                />
                <input
                  value={bookingPlayerPhone}
                  onChange={(event) => setBookingPlayerPhone(event.target.value)}
                  placeholder="Enter your WhatsApp number"
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid #c8c8c8',
                    fontSize: 'clamp(18px, 2.1vw, 28px)',
                    padding: '10px 12px',
                    marginBottom: '10px',
                    outline: 'none',
                  }}
                />
                <input
                  value={bookingPaymentMode}
                  onChange={(event) => setBookingPaymentMode(event.target.value)}
                  placeholder="Payment mode (e.g., Cheque)"
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid #c8c8c8',
                    fontSize: 'clamp(18px, 2.1vw, 28px)',
                    padding: '10px 12px',
                    marginBottom: '10px',
                    outline: 'none',
                  }}
                />

                {bookingNotice && (
                  <div
                    style={{
                      marginBottom: '10px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid #4f2ab9',
                      background: '#240b66',
                      color: '#f2edff',
                      fontWeight: 600,
                      fontSize: '14px',
                    }}
                  >
                    {bookingNotice}
                  </div>
                )}

                {loading ? (
                  <div
                    style={{
                      minHeight: '180px',
                      borderRadius: '8px',
                      border: '2px solid #2400ff',
                      background: '#18004d',
                      display: 'grid',
                      placeItems: 'center',
                      color: '#fff',
                      fontSize: '24px',
                      fontWeight: 700,
                    }}
                  >
                    Loading tickets...
                  </div>
                ) : (
                  <div
                    style={{
                      borderRadius: '8px',
                      border: '2px solid #2200ff',
                      background: '#0f00ff',
                      padding: '10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                        gap: '10px',
                      }}
                    >
                      {orderedTickets.map((ticket) => {
                        const backendStatus = normalizeTicketStatus(ticket.status)
                        const isAvailable = backendStatus === 'AVAILABLE'
                        const isPending = backendStatus === 'PENDING'
                        const isSelected = selectedTicketNumbers.includes(ticket.ticket_number)
                        const isDisabled = !isAvailable || bookingInProgress || isBookingClosed
                        const isDisplayAvailable = isAvailable && !isBookingClosed
                        const backgroundColor = isSelected
                          ? '#43d55e'
                          : isDisplayAvailable
                            ? '#f7f309'
                            : isPending
                              ? '#ffd8a8'
                              : '#e0e0e0'
                        const borderColor = isSelected
                          ? '#0d8f35'
                          : isDisplayAvailable
                            ? '#ff1616'
                            : isPending
                              ? '#d07b00'
                              : '#bfbfbf'
                        const statusText = isSelected
                          ? 'SELECTED'
                          : isDisplayAvailable
                            ? 'AVAILABLE'
                            : isAvailable
                              ? 'ENDED'
                              : isPending
                                ? 'PENDING'
                                : 'BOOKED'

                        return (
                          <button
                            key={ticket.ticket_number}
                            type="button"
                            onClick={() => toggleTicketSelection(ticket)}
                            disabled={isDisabled}
                            style={{
                              borderRadius: '8px',
                              border: `2px solid ${borderColor}`,
                              background: backgroundColor,
                              color: '#111',
                              padding: '7px 6px',
                              minHeight: '58px',
                              fontWeight: 800,
                              cursor: isDisabled ? 'not-allowed' : 'pointer',
                              opacity: isDisabled && !isSelected ? 0.88 : 1,
                              display: 'grid',
                              alignContent: 'center',
                              justifyItems: 'center',
                              gap: '2px',
                            }}
                          >
                            <span style={{ fontSize: '24px', lineHeight: 1 }}>{ticket.ticket_number}</span>
                            <span style={{ fontSize: '11px', fontWeight: 700 }}>{statusText}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    marginTop: '12px',
                    color: '#f4ecff',
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: '15px',
                  }}
                >
                  {selectedTicketNumbers.length === 0
                    ? 'Select ticket(s). 3 tickets = Halfsheet, 6 tickets = Fullsheet.'
                    : selectedBookingMode
                      ? `${selectedBookingMode === 'HALF_SHEET' ? 'Halfsheet' : 'Fullsheet'} selected (${selectedTicketNumbers.length} tickets)`
                      : `${selectedTicketNumbers.length} ticket(s) selected`}
                </div>

                <button
                  type="button"
                  onClick={() => void handleBookNow()}
                  disabled={selectedTicketNumbers.length === 0 || bookingInProgress || loading || isBookingClosed}
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    border: 'none',
                    borderRadius: '14px',
                    background: '#f21717',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 'clamp(18px, 2.4vw, 32px)',
                    padding: '12px 10px',
                    cursor:
                      selectedTicketNumbers.length === 0 || bookingInProgress || loading || isBookingClosed
                        ? 'not-allowed'
                        : 'pointer',
                    opacity: selectedTicketNumbers.length === 0 || bookingInProgress || loading || isBookingClosed ? 0.65 : 1,
                  }}
                >
                  {bookingInProgress ? 'BOOKING...' : 'BOOK NOW'}
                </button>

                <div
                  style={{
                    marginTop: '10px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      border: '2px solid #ff1f1f',
                      borderRadius: '999px',
                      background: '#1d0b59',
                      color: '#ff1616',
                      textAlign: 'center',
                      fontWeight: 800,
                      padding: '6px',
                      lineHeight: 1.2,
                    }}
                  >
                    <div style={{ fontSize: 'clamp(14px, 1.6vw, 22px)' }}>Ticket booked</div>
                    <div style={{ fontSize: 'clamp(20px, 2.3vw, 34px)' }}>{ticketsBookedCount}</div>
                  </div>
                  <div
                    style={{
                      border: '2px solid #ff1f1f',
                      borderRadius: '999px',
                      background: '#1d0b59',
                      color: '#ff1616',
                      textAlign: 'center',
                      fontWeight: 800,
                      padding: '6px',
                      lineHeight: 1.2,
                    }}
                  >
                    <div style={{ fontSize: 'clamp(14px, 1.6vw, 22px)' }}>Halfsheet booked</div>
                    <div style={{ fontSize: 'clamp(20px, 2.3vw, 34px)' }}>{halfsheetBookedCount}</div>
                  </div>
                  <div
                    style={{
                      border: '2px solid #ff1f1f',
                      borderRadius: '999px',
                      background: '#1d0b59',
                      color: '#ff1616',
                      textAlign: 'center',
                      fontWeight: 800,
                      padding: '6px',
                      lineHeight: 1.2,
                    }}
                  >
                    <div style={{ fontSize: 'clamp(14px, 1.6vw, 22px)' }}>Fullsheet booked</div>
                    <div style={{ fontSize: 'clamp(20px, 2.3vw, 34px)' }}>{fullsheetBookedCount}</div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  )
}

export default Lobby
