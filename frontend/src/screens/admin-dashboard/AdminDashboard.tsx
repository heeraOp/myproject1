import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { logoutCurrentUser } from '@/api/rest/auth'
import {
  type AgentOption,
  type AdminGameListItem,
  announceGame,
  bookTicketAsAdmin,
  confirmTicketRequest,
  createAgent,
  createGamePrizes,
  fetchAgents,
  getCurrentAdminGame,
  deleteGamePrize,
  getGameBusinessSummary,
  getPrizeTypes,
  getPrizes,
  loadGameState,
  getTickets,
  getWinners,
  listAdminGames,
  pauseGame,
  resetAgent,
  resetCall,
  resetTicket,
  rejectTicketRequest,
  releaseAdminTicket,
  resumeGame,
  saveGameSettings,
  startGame,
  updateAdminTicket,
  updateActiveTheme,
  updateAgent,
  updateGamePrize,
  type GameBusinessSummaryResponse,
  type PrizeTypeResponse,
  type GameSummaryResponse,
  type PrizeResponse,
  type TicketResponse,
  type WinnerResponse,
} from '@/api/rest/admin'
import { useGameSocket } from '@/app/hooks/useGameSocket'
import { useBingoCaller } from '@/app/hooks/useBingoCaller'
import { useGameStore } from '@/app/store/game.store'
import { useVoiceModeStore, type VoiceMode, VOICE_MODE_OPTIONS } from '@/app/store/voiceMode.store'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import { socketManager } from '@/api/websocket/socketManager'
import { jsPDF } from 'jspdf'
import { normalizeTicketStatus } from '@/types/backend/ticket'
import {
  formatThemeLabel,
  getActiveTheme,
  setAdminTheme,
  subscribeThemeChange,
  toggleAdminTheme,
} from '@/utils/theme'
import { formatDateTimeInIST, toDateTimeLocalInputInIST } from '@/utils/dateTime'
import { wallpaperRegistry, resolveWallpaperTheme } from '@/theme/wallpaperRegistry'
import './AdminDashboard.css'

type SettingsForm = {
  gameName: string
  gameDateTime: string
  totalTicketLimit: string
  ticketPrice: string
  callingInterval: string
  agentCommission: string
  agentId: string
  bookingStatus: 'OPEN' | 'CLOSED'
  websiteStatus: 'OPEN' | 'CLOSED'
}

type PrizeSetupRow = {
  prize_type: string
  label: string
  amount: number
  enabled: boolean
  claimed: boolean
  configured: boolean
}

type TicketBookedSocketPayload = {
  game_id?: string
  ticket_id?: string
  status?: string
  player_name?: string
}

type GameUpdateSocketPayload = {
  game_id?: string
  changed_fields?: Partial<AdminGameListItem> & {
    status?: string
    calling_interval?: number
  }
}

type AgentEditorForm = {
  id: string
  name: string
  whatsapp_number: string
}

type PosterBackgroundKey = keyof typeof wallpaperRegistry

const CLAIM_MONITOR_ORDER = [
  { prizeType: 'FIRST_HOUSE', label: 'First Full House' },
  { prizeType: 'SECOND_HOUSE', label: 'Second Full House' },
  { prizeType: 'FULL_SHEET', label: 'Full Sheet Bonus' },
  { prizeType: 'HALF_SHEET', label: 'Half Sheet Bonus' },
  { prizeType: 'TOP_LINE', label: 'Top Line' },
  { prizeType: 'MIDDLE_LINE', label: 'Middle Line' },
  { prizeType: 'BOTTOM_LINE', label: 'Bottom Line' },
  { prizeType: 'STAR', label: 'Star' },
  { prizeType: 'QUICK_7', label: 'Quick 7' },
]

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

const FALLBACK_PRIZE_TYPES: PrizeTypeResponse[] = Object.entries(PRIZE_LABEL_MAP).map(
  ([prize_type, label]) => ({
    prize_type,
    label,
  }),
)

const POSTER_BACKGROUND_LABELS: Record<PosterBackgroundKey, string> = {
  christmas: 'Christmas',
  default: 'Default',
  diwali: 'Diwali',
  holi: 'Holi',
}

const buildPrizeSetupRows = (
  prizeTypes: PrizeTypeResponse[],
  configuredPrizes: PrizeResponse[],
): PrizeSetupRow[] => {
  const types = prizeTypes.length > 0 ? prizeTypes : FALLBACK_PRIZE_TYPES
  const existingByType = new Map(configuredPrizes.map((prize) => [prize.prize_type, prize]))
  const typeSet = new Set(types.map((type) => type.prize_type))
  const rows = types.map((type) => {
    const existing = existingByType.get(type.prize_type)
    return {
      prize_type: type.prize_type,
      label: type.label || PRIZE_LABEL_MAP[type.prize_type] || type.prize_type,
      amount: existing?.amount ?? 0,
      enabled: existing?.enabled ?? false,
      claimed: existing?.claimed ?? false,
      configured: Boolean(existing),
    }
  })

  configuredPrizes.forEach((prize) => {
    if (typeSet.has(prize.prize_type)) return
    rows.push({
      prize_type: prize.prize_type,
      label: PRIZE_LABEL_MAP[prize.prize_type] || prize.prize_type,
      amount: prize.amount,
      enabled: prize.enabled,
      claimed: prize.claimed,
      configured: true,
    })
  })

  return rows
}

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: string; response?: { data?: { detail?: string } } }
    return maybeError.response?.data?.detail || maybeError.message || 'Request failed.'
  }
  return 'Request failed.'
}

const toDateTimeLocalValue = (value: string | null | undefined): string => {
  return toDateTimeLocalInputInIST(value)
}

const formatDateTime = (value?: string): string => {
  return formatDateTimeInIST(value)
}

const NumberBoard = ({ calledNumbers }: { calledNumbers: number[] }) => {
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers])
  return (
    <div className="number-board">
      {Array.from({ length: 90 }, (_, index) => {
        const value = index + 1
        return (
          <div
            key={value}
            className={`number-board__cell ${calledSet.has(value) ? 'called' : ''}`}
          >
            {value}
          </div>
        )
      })}
    </div>
  )
}

const AdminDashboard = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [games, setGames] = useState<AdminGameListItem[]>([])
  const [gameId, setGameId] = useState<string>('')
  const [summary, setSummary] = useState<GameSummaryResponse | null>(null)
  const [business, setBusiness] = useState<GameBusinessSummaryResponse | null>(null)
  const [prizeTypes, setPrizeTypes] = useState<PrizeTypeResponse[]>([])
  const [prizeTypesLoading, setPrizeTypesLoading] = useState(false)
  const [prizes, setPrizes] = useState<PrizeResponse[]>([])
  const [editablePrizes, setEditablePrizes] = useState<PrizeSetupRow[]>([])
  const [tickets, setTickets] = useState<TicketResponse[]>([])
  const [winners, setWinners] = useState<WinnerResponse[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [publicGamesError, setPublicGamesError] = useState<string>('')
  const [actionMessage, setActionMessage] = useState<string>('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [callingInterval, setCallingInterval] = useState<number>(10)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingCallingInterval, setSavingCallingInterval] = useState(false)
  const [savingPrizes, setSavingPrizes] = useState(false)
  const [savingAgent, setSavingAgent] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [pendingActionTicketId, setPendingActionTicketId] = useState<string | null>(null)
  const [pendingActionType, setPendingActionType] = useState<'approve' | 'reject' | null>(null)
  const [ticketManageActionTicketId, setTicketManageActionTicketId] = useState<string | null>(null)
  const [ticketManageActionType, setTicketManageActionType] = useState<
    'book' | 'edit' | 'remove' | null
  >(null)
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false)
  const [announcementText, setAnnouncementText] = useState('')
  const [showTicketCards, setShowTicketCards] = useState(false)
  const [theme, setTheme] = useState(getActiveTheme())
  const [posterBackgroundKey, setPosterBackgroundKey] = useState<PosterBackgroundKey>(() =>
    resolveWallpaperTheme(getActiveTheme()),
  )

  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    gameName: '',
    gameDateTime: '',
    totalTicketLimit: '',
    ticketPrice: '',
    callingInterval: '10',
    agentCommission: '',
    agentId: '',
    bookingStatus: 'OPEN',
    websiteStatus: 'OPEN',
  })
  const [agentEditorForm, setAgentEditorForm] = useState<AgentEditorForm>({
    id: '',
    name: '',
    whatsapp_number: '',
  })
  const handleThemeToggle = async () => {
    if (!gameId) {
      setActionMessage('Select a game to update the theme.')
      return
    }
    const previous = getActiveTheme()
    const next = toggleAdminTheme()
    setTheme(next)
    try {
      await updateActiveTheme(gameId, next)
    } catch {
      setActionMessage('Unable to update theme. Please try again.')
      setAdminTheme(previous)
      setTheme(previous)
    }
  }

  useEffect(() => {
    return subscribeThemeChange(({ theme: updatedTheme }) => {
      setTheme(updatedTheme)
    })
  }, [])

  const ticketSectionRef = useRef<HTMLElement | null>(null)
  const winnerSectionRef = useRef<HTMLElement | null>(null)
  const businessSectionRef = useRef<HTMLElement | null>(null)

  const {
    gameId: storeGameId,
    status: liveStatus,
    calledNumbers: liveCalledNumbers,
    tickets: liveTickets,
    winners: liveWinners,
    lockedPrizeTypes,
    replaceFromBackendState,
    setTicketsFromBackend,
    reset: resetLiveState,
  } = useGameStore((state) => state)
  const isSetupMode = searchParams.get('setup') === '1'
  const {
    announcement: bingoAnnouncement,
    isAudioReady,
    isSpeechSupported,
    audioBlockedMessage,
    unlockAudio,
  } = useBingoCaller()
  const voiceMode = useVoiceModeStore((state) => state.mode)
  const setVoiceMode = useVoiceModeStore((state) => state.setMode)
  const normalizedPath = location.pathname.replace(/\/+$/, '')
  const activeView: 'main' | 'run' | 'book' | 'list' | 'poster' | 'prizes' = normalizedPath.endsWith(
    '/run',
  )
    ? 'run'
    : normalizedPath.endsWith('/book')
      ? 'book'
      : normalizedPath.endsWith('/list')
        ? 'list'
        : normalizedPath.endsWith('/poster')
          ? 'poster'
          : normalizedPath.endsWith('/prizes')
            ? 'prizes'
          : 'main'
  const viewTitleMap: Record<typeof activeView, string> = {
    main: 'Main Dashboard',
    run: 'Run Control',
    book: 'Ticket Approval',
    list: 'History & Reports',
    poster: 'Poster & Dividend',
    prizes: 'Configure Prizes',
  }
  const routeTabs = [
    { key: 'main' as const, label: 'Dashboard', path: '/admin' },
    { key: 'run' as const, label: 'Run', path: '/admin/run' },
    { key: 'book' as const, label: 'Book', path: '/admin/book' },
    { key: 'list' as const, label: 'List', path: '/admin/list' },
    { key: 'prizes' as const, label: 'Prizes', path: '/admin/prizes' },
    { key: 'poster' as const, label: 'Poster', path: '/admin/poster' },
  ]

  const handleLogout = useCallback(async () => {
    setActionMessage('')
    setLoggingOut(true)
    try {
      await logoutCurrentUser()
      resetLiveState()
      navigate('/admin/login', { replace: true })
    } catch {
      setActionMessage('Unable to logout right now. Please try again.')
    } finally {
      setLoggingOut(false)
    }
  }, [navigate, resetLiveState])

  // Real-time stream for called numbers and winner announcements.
  useGameSocket(gameId || undefined)

  useEffect(() => {
    let mounted = true
    const loadAgents = async () => {
      try {
        const fetchedAgents = await fetchAgents()
        if (!mounted) return
        setAgents(Array.isArray(fetchedAgents) ? fetchedAgents : [])
      } catch {
        if (!mounted) return
        setAgents([])
      }
    }
    void loadAgents()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadPrizeTypes = async () => {
      setPrizeTypesLoading(true)
      try {
        const types = await getPrizeTypes()
        if (!mounted) return
        setPrizeTypes(Array.isArray(types) ? types : [])
      } catch {
        if (!mounted) return
        // Keep local fallback labels so prize setup remains usable.
        setPrizeTypes([])
      } finally {
        if (mounted) {
          setPrizeTypesLoading(false)
        }
      }
    }
    void loadPrizeTypes()
    return () => {
      mounted = false
    }
  }, [])

  const rehydrateGameState = useCallback(
    async (selectedGameId: string) => {
      const hydrated = await loadGameState(selectedGameId)
      const summaryData = hydrated.summary
      const stateData = hydrated.state
      const businessData = hydrated.business
      const prizesData = hydrated.prizes
      const ticketsData = hydrated.ticketsSnapshot.tickets
      const winnersData = hydrated.winners

      setSummary(summaryData)
      replaceFromBackendState(stateData)
      setCallingInterval(
        typeof summaryData.game.calling_interval === 'number'
          ? summaryData.game.calling_interval
          : typeof stateData.game.calling_interval === 'number'
            ? stateData.game.calling_interval
            : 10,
      )
      setBusiness(businessData)
      setPrizes(Array.isArray(prizesData) ? prizesData : [])
      setTicketsFromBackend(selectedGameId, Array.isArray(ticketsData) ? ticketsData : [])
      setTickets(Array.isArray(ticketsData) ? ticketsData : [])
      setWinners(Array.isArray(winnersData) ? winnersData : [])
      setGames((current) =>
        current.map((game) =>
          game.id === selectedGameId
            ? {
                ...game,
                name: summaryData.game.name,
                status: summaryData.game.status,
                calling_interval: summaryData.game.calling_interval,
                booking_status: summaryData.game.booking_status,
                website_status: summaryData.game.website_status,
                total_tickets: summaryData.game.total_tickets,
                ticket_price: summaryData.game.ticket_price,
                agent_commission: summaryData.game.agent_commission,
                agent: summaryData.game.agent ?? null,
                active_theme: summaryData.game.active_theme,
              }
            : game,
        ),
      )

      const selectedGame = games.find((item) => item.id === selectedGameId)
      setSettingsForm({
        gameName: String(summaryData.game.name ?? selectedGame?.name ?? ''),
        gameDateTime: toDateTimeLocalValue(selectedGame?.date),
        totalTicketLimit: String(summaryData.game.total_tickets ?? businessData.total_tickets),
        ticketPrice: String(summaryData.game.ticket_price ?? selectedGame?.ticket_price ?? ''),
        callingInterval: String(
          typeof summaryData.game.calling_interval === 'number'
            ? summaryData.game.calling_interval
            : typeof stateData.game.calling_interval === 'number'
              ? stateData.game.calling_interval
              : 10,
        ),
        agentCommission: String(summaryData.game.agent_commission ?? businessData.agent_commission ?? 0),
        agentId: String(summaryData.game.agent?.id ?? selectedGame?.agent?.id ?? ''),
        bookingStatus: summaryData.game.booking_status === 'CLOSED' ? 'CLOSED' : 'OPEN',
        websiteStatus: summaryData.game.website_status === 'CLOSED' ? 'CLOSED' : 'OPEN',
      })

      return summaryData
    },
    [games, replaceFromBackendState, setTicketsFromBackend],
  )

  const loadAll = useCallback(
    async (selectedGameId: string) => {
      setLoading(true)
      setError('')
      try {
        await rehydrateGameState(selectedGameId)
      } catch (loadError) {
        setError(getErrorMessage(loadError))
      } finally {
        setLoading(false)
      }
    },
    [rehydrateGameState],
  )

  // Primary bootstrap: fetch authoritative active game from backend.
  useEffect(() => {
    let mounted = true
    const loadGames = async () => {
      try {
        setPublicGamesError('')
        const adminGames = await listAdminGames()
        if (!mounted) return
        setGames(adminGames)

        if (isSetupMode) {
          setGameId('')
          return
        }

        try {
          const currentGame = await getCurrentAdminGame()
          if (!mounted) return
          setGameId(currentGame.id)
        } catch (currentGameError) {
          if (!mounted) return
          setGameId('')
          setPublicGamesError(`Unable to load active game: ${getErrorMessage(currentGameError)}`)
        }
      } catch (loadGamesError) {
        if (!mounted) return
        setPublicGamesError(`Unable to load games: ${getErrorMessage(loadGamesError)}`)
      }
    }
    void loadGames()
    return () => {
      mounted = false
    }
  }, [isSetupMode])

  useEffect(() => {
    if (!gameId) return
    void loadAll(gameId)
  }, [gameId, loadAll])

  useEffect(() => {
    if (!gameId || storeGameId !== gameId) return
    setTickets(liveTickets as TicketResponse[])
  }, [gameId, liveTickets, storeGameId])

  useEffect(() => {
    if (!gameId || storeGameId !== gameId) return
    if (liveStatus !== 'FINISHED' && liveCalledNumbers.length < 90) return

    setSummary((previous) => {
      if (!previous || previous.game.status === 'FINISHED') return previous
      return {
        ...previous,
        game: {
          ...previous.game,
          status: 'FINISHED',
        },
      }
    })

    setGames((previous) => {
      let changed = false
      const next = previous.map((game) => {
        if (game.id !== gameId || game.status === 'FINISHED') return game
        changed = true
        return {
          ...game,
          status: 'FINISHED',
        }
      })
      return changed ? next : previous
    })
  }, [gameId, liveCalledNumbers.length, liveStatus, storeGameId])

  useEffect(() => {
    setEditablePrizes(buildPrizeSetupRows(prizeTypes, prizes))
  }, [prizeTypes, prizes])

  useEffect(() => {
    const unsubNewGame = socketManager.subscribe('new_game_created', async (event: unknown) => {
      const payload = (event as { data?: AdminGameListItem }).data
      if (!payload) return
      const nextGameId = typeof payload?.id === 'string' ? payload.id : ''
      if (!nextGameId) return

      if (typeof payload.calling_interval === 'number') {
        setCallingInterval(payload.calling_interval)
      }

      setSummary(null)
      setBusiness(null)
      setPrizes([])
      setEditablePrizes([])
      setTickets([])
      setWinners([])
      setGameId(nextGameId)

      try {
        const refreshedGames = await listAdminGames()
        setGames(refreshedGames)
      } catch {
        return
      }
    })

    const handleGameUpdate = (event: unknown) => {
      const payload = (
        event as {
          data?: GameUpdateSocketPayload
        }
      ).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId) return

      const changedFields = payload?.changed_fields
      if (!changedFields || typeof changedFields !== 'object') return

      setGames((current) =>
        current.map((game) =>
          game.id === eventGameId
            ? {
                ...game,
                ...changedFields,
                status:
                  typeof changedFields.status === 'string'
                    ? changedFields.status
                    : game.status,
              }
            : game,
        ),
      )

      if (!gameId || eventGameId !== gameId) return

      setSummary((previous) =>
        previous
          ? {
              ...previous,
              game: {
                ...previous.game,
                ...changedFields,
                status:
                  typeof changedFields.status === 'string'
                    ? changedFields.status
                    : previous.game.status,
                calling_interval:
                  typeof changedFields.calling_interval === 'number'
                    ? changedFields.calling_interval
                    : previous.game.calling_interval,
              },
            }
          : previous,
      )

      if (typeof changedFields.calling_interval === 'number' && changedFields.calling_interval > 0) {
        setCallingInterval(changedFields.calling_interval)
        setSettingsForm((state) => ({
          ...state,
          callingInterval: String(changedFields.calling_interval),
        }))
      }
      if (typeof changedFields.booking_status === 'string') {
        setSettingsForm((state) => ({
          ...state,
          bookingStatus: changedFields.booking_status === 'CLOSED' ? 'CLOSED' : 'OPEN',
        }))
      }
      if (typeof changedFields.website_status === 'string') {
        setSettingsForm((state) => ({
          ...state,
          websiteStatus: changedFields.website_status === 'CLOSED' ? 'CLOSED' : 'OPEN',
        }))
      }
      const updatedGameName = changedFields.name
      if (typeof updatedGameName === 'string') {
        setSettingsForm((state) => ({
          ...state,
          gameName: updatedGameName,
        }))
      }
      if (typeof changedFields.active_theme === 'string' && changedFields.active_theme) {
        setAdminTheme(changedFields.active_theme)
      }
    }
    const unsubGameUpdate = socketManager.subscribe('game_update', handleGameUpdate)
    const unsubGameUpdateUpper = socketManager.subscribe('GAME_UPDATE', handleGameUpdate)

    const unsubGameStarted = socketManager.subscribe('game.started', (event: unknown) => {
      if (!gameId) return
      const payload = event as { calling_interval?: unknown }
      const nextCallingInterval =
        typeof payload.calling_interval === 'number' && payload.calling_interval > 0
          ? payload.calling_interval
          : undefined

      setGames((current) =>
        current.map((game) =>
          game.id === gameId
            ? {
                ...game,
                status: 'RUNNING',
                calling_interval: nextCallingInterval ?? game.calling_interval,
              }
            : game,
        ),
      )

      setSummary((previous) =>
        previous
          ? {
              ...previous,
              game: {
                ...previous.game,
                status: 'RUNNING',
                calling_interval: nextCallingInterval ?? previous.game.calling_interval,
              },
            }
          : previous,
      )

      if (nextCallingInterval) {
        setCallingInterval(nextCallingInterval)
        setSettingsForm((state) => ({ ...state, callingInterval: String(nextCallingInterval) }))
      }
    })

    const unsubGameFinished = socketManager.subscribe('game.finished', () => {
      if (!gameId) return
      setGames((current) =>
        current.map((game) => (game.id === gameId ? { ...game, status: 'FINISHED' } : game)),
      )
      setSummary((previous) =>
        previous
          ? {
              ...previous,
              game: {
                ...previous.game,
                status: 'FINISHED',
              },
            }
          : previous,
      )
    })

    const unsubTicketsGenerated = socketManager.subscribe('tickets_generated', async (event: unknown) => {
      const payload = (event as { data?: { game_id?: string } }).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !gameId || eventGameId !== gameId) return

      try {
        const freshTickets = await getTickets(eventGameId)
        setTicketsFromBackend(eventGameId, freshTickets)
        setTickets(freshTickets)
      } catch {
        return
      }
    })

    const unsubTicketBooked = socketManager.subscribe('ticket_booked', async (event: unknown) => {
      const payload = (event as { data?: TicketBookedSocketPayload }).data
      if (!payload) return

      const eventGameId = typeof payload.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !gameId || eventGameId !== gameId) return

      const ticketId = typeof payload.ticket_id === 'string' ? payload.ticket_id : ''
      if (ticketId) {
        const nextStatus =
          typeof payload.status === 'string'
            ? (payload.status as TicketResponse['status'])
            : undefined
        const nextPlayerName =
          typeof payload.player_name === 'string' && payload.player_name.length > 0
            ? payload.player_name
            : undefined

        setTickets((current: TicketResponse[]) =>
          current.map((ticket): TicketResponse =>
            ticket.id === ticketId
              ? {
                  ...ticket,
                  status: nextStatus ?? ticket.status,
                  player_name: nextPlayerName ?? ticket.player_name,
                  requested_by_name: nextPlayerName ?? ticket.requested_by_name,
                }
              : ticket,
          ),
        )
      }

      try {
        const freshTickets = await getTickets(eventGameId)
        setTicketsFromBackend(eventGameId, freshTickets)
        setTickets(freshTickets)
      } catch {
        return
      }
    })

    return () => {
      unsubNewGame()
      unsubGameUpdate()
      unsubGameUpdateUpper()
      unsubGameStarted()
      unsubGameFinished()
      unsubTicketsGenerated()
      unsubTicketBooked()
    }
  }, [gameId, setTicketsFromBackend])

  const mergedWinners = useMemo(() => {
    const seen = new Set<string>()
    const all = [...winners, ...liveWinners]
    return all.filter((winner) => {
      const key = winner.id ? `id:${winner.id}` : `fallback:${winner.prize_type}:${winner.ticket_number}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [winners, liveWinners])

  const calledNumbers = liveCalledNumbers
  const totalTicketsValue =
    business && business.total_tickets > 0
      ? business.total_tickets
      : (summary?.game.total_tickets ?? '-')
  const selectedPosterGame = games.find((item) => item.id === gameId)
  const posterContactNumber =
    summary?.game.agent?.whatsapp_number ?? selectedPosterGame?.agent?.whatsapp_number ?? ''
  const summaryStatus = summary?.game.status ?? 'CREATED'
  const effectiveStatus =
    liveStatus !== 'IDLE'
      ? liveStatus
      : summaryStatus === 'RUNNING'
        ? 'RUNNING'
        : summaryStatus === 'FINISHED'
          ? 'FINISHED'
          : 'IDLE'

  const running = effectiveStatus === 'RUNNING'
  const finished = effectiveStatus === 'FINISHED'
  const allNumbersCalled = calledNumbers.length >= 90 || summary?.game.status === 'FINISHED'
  const configuredPrizeCount = prizes.length
  const enabledPrizeCount = prizes.filter((prize) => prize.enabled).length
  const hasEnabledPrize = enabledPrizeCount > 0
  const runControlLabel =
    summary?.game.status === 'RUNNING'
      ? 'Pause Game'
      : summary?.game.status === 'PAUSED'
        ? 'Resume Game'
        : 'Run Game'
  const runControlNeedsEnabledPrize =
    summary?.game.status === 'CREATED' || summary?.game.status === 'PAUSED'
  const runControlDisabled =
    !gameId || !summary || finished || (runControlNeedsEnabledPrize && !hasEnabledPrize)
  const canEditPrizeConfig = Boolean(gameId) && summary?.game.status !== 'RUNNING'
  const resetActionsAllowedAtEnd = new Set(['reset-call', 'reset-ticket', 'reset-agent', 'backup-ticket'])
  const showOverview = activeView === 'main'
  const showRunView = activeView === 'main' || activeView === 'run'
  const showBookView = activeView === 'main' || activeView === 'book'
  const showListView = activeView === 'main' || activeView === 'list'
  const showPrizeView = activeView === 'main' || activeView === 'prizes'
  const showPosterView = activeView === 'main' || activeView === 'poster'

  const filteredTickets = useMemo(() => {
    const query = searchKeyword.trim().toLowerCase()
    if (!query) return tickets
    return tickets.filter((ticket) => {
      const value = [
        ticket.ticket_number,
        ticket.player_name ?? '',
        ticket.player_phone ?? '',
        ticket.requested_by_name ?? '',
        ticket.requested_by_whatsapp ?? '',
        normalizeTicketStatus(ticket.status),
      ]
        .join(' ')
        .toLowerCase()
      return value.includes(query)
    })
  }, [tickets, searchKeyword])

  const pendingTickets = useMemo(
    () => filteredTickets.filter((ticket) => normalizeTicketStatus(ticket.status) === 'PENDING'),
    [filteredTickets],
  )

  const claimMonitorRows = useMemo(() => {
    return CLAIM_MONITOR_ORDER.map((row) => {
      const winner = mergedWinners.find((item) => item.prize_type === row.prizeType)
      const prizeLocked =
        lockedPrizeTypes.includes(row.prizeType) ||
        prizes.some((prize) => prize.prize_type === row.prizeType && prize.claimed)

      return {
        ...row,
        claimed: Boolean(prizeLocked),
        winner: winner ? `${winner.player_name ?? 'Player'} (#${winner.ticket_number})` : '-',
      }
    })
  }, [lockedPrizeTypes, mergedWinners, prizes])

  const refreshTicketsAndBusiness = useCallback(async (selectedGameId: string) => {
    const [freshTickets, freshBusiness] = await Promise.all([
      getTickets(selectedGameId),
      getGameBusinessSummary(selectedGameId),
    ])
    setTicketsFromBackend(selectedGameId, freshTickets)
    setTickets(freshTickets)
    setBusiness(freshBusiness)
  }, [setTicketsFromBackend])

  const promptTicketAssignment = (
    defaults: { playerName?: string; playerPhone?: string } = {},
  ): { playerName: string; playerPhone: string } | null => {
    const defaultName = defaults.playerName?.trim() ?? ''
    const defaultPhone = defaults.playerPhone?.trim() ?? ''
    const nameInput = window.prompt('Enter player name', defaultName)
    if (nameInput === null) return null
    const playerName = nameInput.trim()
    if (!playerName) {
      setActionMessage('Player name is required.')
      return null
    }

    const phoneInput = window.prompt('Enter player WhatsApp/phone', defaultPhone)
    if (phoneInput === null) return null
    const playerPhone = phoneInput.trim()
    if (!playerPhone) {
      setActionMessage('Player phone is required.')
      return null
    }

    return { playerName, playerPhone }
  }

  const handleBookAvailableTicket = async (ticket: TicketResponse) => {
    if (!gameId) return
    if (normalizeTicketStatus(ticket.status) !== 'AVAILABLE') {
      setActionMessage('Only available tickets can be booked directly.')
      return
    }

    const assignment = promptTicketAssignment({
      playerName: ticket.requested_by_name ?? '',
      playerPhone: ticket.requested_by_whatsapp ?? '',
    })
    if (!assignment) return

    setTicketManageActionTicketId(ticket.id ?? `ticket-${ticket.ticket_number}`)
    setTicketManageActionType('book')
    setActionMessage('')
    try {
      await bookTicketAsAdmin({
        game_id: gameId,
        ticket_number: ticket.ticket_number,
        booking_mode: 'RANDOM',
        player_name: assignment.playerName,
        player_phone: assignment.playerPhone,
      })
      await refreshTicketsAndBusiness(gameId)
      setSearchKeyword('')
      setActionMessage(`Ticket ${ticket.ticket_number} booked for ${assignment.playerName}.`)
    } catch (bookError) {
      setActionMessage(getErrorMessage(bookError))
    } finally {
      setTicketManageActionTicketId(null)
      setTicketManageActionType(null)
    }
  }

  const handleEditTicketAssignment = async (ticket: TicketResponse) => {
    if (!gameId) return
    if (!ticket.id) {
      setActionMessage('Ticket id is missing for this request. Refresh and try again.')
      return
    }
    if (normalizeTicketStatus(ticket.status) === 'AVAILABLE') {
      setActionMessage('Only booked or pending tickets can be modified.')
      return
    }

    const assignment = promptTicketAssignment({
      playerName: ticket.player_name ?? ticket.requested_by_name ?? '',
      playerPhone: ticket.player_phone ?? ticket.requested_by_whatsapp ?? '',
    })
    if (!assignment) return

    setTicketManageActionTicketId(ticket.id)
    setTicketManageActionType('edit')
    setActionMessage('')
    try {
      await updateAdminTicket(ticket.id, {
        player_name: assignment.playerName,
        player_phone: assignment.playerPhone,
      })
      await refreshTicketsAndBusiness(gameId)
      setSearchKeyword('')
      setActionMessage(`Ticket ${ticket.ticket_number} updated.`)
    } catch (editError) {
      setActionMessage(getErrorMessage(editError))
    } finally {
      setTicketManageActionTicketId(null)
      setTicketManageActionType(null)
    }
  }

  const handleReleaseTicket = async (ticket: TicketResponse) => {
    if (!gameId) return
    if (!ticket.id) {
      setActionMessage('Ticket id is missing for this request. Refresh and try again.')
      return
    }
    if (normalizeTicketStatus(ticket.status) === 'AVAILABLE') {
      setActionMessage('Ticket is already available.')
      return
    }
    const proceed = window.confirm(
      `Remove booking and release ticket ${ticket.ticket_number} back to available?`,
    )
    if (!proceed) return

    setTicketManageActionTicketId(ticket.id)
    setTicketManageActionType('remove')
    setActionMessage('')
    try {
      await releaseAdminTicket(ticket.id)
      await refreshTicketsAndBusiness(gameId)
      setSearchKeyword('')
      setActionMessage(`Ticket ${ticket.ticket_number} released.`)
    } catch (releaseError) {
      setActionMessage(getErrorMessage(releaseError))
    } finally {
      setTicketManageActionTicketId(null)
      setTicketManageActionType(null)
    }
  }

  const handleApprovePendingRequest = async (ticket: TicketResponse) => {
    if (!gameId) return
    if (!ticket.id) {
      setActionMessage('Ticket id is missing for this request. Refresh and try again.')
      return
    }

    setPendingActionTicketId(ticket.id)
    setPendingActionType('approve')
    setActionMessage('')
    try {
      await confirmTicketRequest(ticket.id)
      await refreshTicketsAndBusiness(gameId)
      setSearchKeyword('')
      setActionMessage(`Ticket ${ticket.ticket_number} confirmed.`)
    } catch (approveError) {
      setActionMessage(getErrorMessage(approveError))
    } finally {
      setPendingActionTicketId(null)
      setPendingActionType(null)
    }
  }

  const handleRejectPendingRequest = async (ticket: TicketResponse) => {
    if (!gameId) return
    if (!ticket.id) {
      setActionMessage('Ticket id is missing for this request. Refresh and try again.')
      return
    }

    setPendingActionTicketId(ticket.id)
    setPendingActionType('reject')
    setActionMessage('')
    try {
      await rejectTicketRequest(ticket.id)
      await refreshTicketsAndBusiness(gameId)
      setSearchKeyword('')
      setActionMessage(`Ticket ${ticket.ticket_number} request rejected.`)
    } catch (rejectError) {
      setActionMessage(getErrorMessage(rejectError))
    } finally {
      setPendingActionTicketId(null)
      setPendingActionType(null)
    }
  }

  const buildSettingsPayload = useCallback(
    (intervalOverride?: number) => {
      const parsedInterval = Number(
        intervalOverride ?? Number(settingsForm.callingInterval || callingInterval || 10),
      )
      const normalizedCallingInterval =
        Number.isFinite(parsedInterval) && parsedInterval > 0 ? Math.floor(parsedInterval) : 10

      return {
        name: settingsForm.gameName.trim(),
        date: settingsForm.gameDateTime,
        total_tickets: Number(settingsForm.totalTicketLimit),
        ticket_price: Number(settingsForm.ticketPrice),
        calling_interval: normalizedCallingInterval,
        agent_commission: Number(settingsForm.agentCommission || 0),
        agent_id: settingsForm.agentId ? Number(settingsForm.agentId) : null,
        booking_status: settingsForm.bookingStatus,
        website_status: settingsForm.websiteStatus,
      }
    },
    [callingInterval, settingsForm],
  )

  const applyCallingIntervalRealtime = useCallback(
    async (nextInterval: number) => {
      if (!gameId || !summary || summary.game.status !== 'RUNNING') return

      setSavingCallingInterval(true)
      setActionMessage('')
      try {
        const updatedGame = await saveGameSettings({
          ...buildSettingsPayload(nextInterval),
          game_id: gameId,
        })

        setGames((current) =>
          current.map((game) => (game.id === gameId ? { ...game, ...updatedGame } : game)),
        )
        setSummary((previous) =>
          previous
            ? {
                ...previous,
                game: {
                  ...previous.game,
                  calling_interval:
                    typeof (updatedGame as { calling_interval?: unknown })?.calling_interval === 'number'
                      ? Number((updatedGame as { calling_interval: number }).calling_interval)
                      : nextInterval,
                },
              }
            : previous,
        )
        setActionMessage(`Calling interval updated live to ${nextInterval}s.`)
      } catch (errorValue) {
        setActionMessage(getErrorMessage(errorValue))
        const currentInterval = summary?.game.calling_interval
        if (typeof currentInterval === 'number' && currentInterval > 0) {
          setCallingInterval(currentInterval)
          setSettingsForm((state) => ({ ...state, callingInterval: String(currentInterval) }))
        }
      } finally {
        setSavingCallingInterval(false)
      }
    },
    [buildSettingsPayload, gameId, summary],
  )

  const handleCallingIntervalSelect = (nextIntervalValue: number) => {
    if (!Number.isFinite(nextIntervalValue) || nextIntervalValue <= 0) return
    const nextInterval = Math.floor(nextIntervalValue)
    if (nextInterval === callingInterval) return

    setCallingInterval(nextInterval)
    setSettingsForm((state) => ({ ...state, callingInterval: String(nextInterval) }))

    if (summary?.game.status === 'RUNNING') {
      void applyCallingIntervalRealtime(nextInterval)
    }
  }

  const handleSettingsSave = async () => {
    setSavingSettings(true)
    setActionMessage('')
    try {
      const payload = buildSettingsPayload()

      if (!isSetupMode && gameId) {
        const updatedGame = await saveGameSettings({
          ...payload,
          game_id: gameId,
        })

        setGames((current) =>
          current.map((game) => (game.id === gameId ? { ...game, ...updatedGame } : game)),
        )
        await rehydrateGameState(gameId)
        setActionMessage('Game settings updated.')
      } else {
        const createdGame = await saveGameSettings(payload)

        // New game creation flow: switch context to the newly created game.
        const [latestGames, currentGame] = await Promise.all([
          listAdminGames(),
          getCurrentAdminGame(),
        ])
        setGames(latestGames)
        resetLiveState()

        if (currentGame?.id) {
          setGameId(currentGame.id)
          navigate(`/admin?gameId=${currentGame.id}`, { replace: true })
        } else if (createdGame?.id) {
          setGameId(createdGame.id)
          navigate(`/admin?gameId=${createdGame.id}`, { replace: true })
        }

        setActionMessage('New game created from game settings.')
      }
    } catch (saveError) {
      setActionMessage(getErrorMessage(saveError))
    } finally {
      setSavingSettings(false)
    }
  }

  const handleAgentEditorSelect = (nextId: string) => {
    if (!nextId) {
      setAgentEditorForm({
        id: '',
        name: '',
        whatsapp_number: '',
      })
      return
    }
    const selected = agents.find((agent) => String(agent.id) === nextId)
    setAgentEditorForm({
      id: nextId,
      name: selected?.name ?? '',
      whatsapp_number: selected?.whatsapp_number ?? '',
    })
  }

  const handleSaveAgent = async () => {
    const name = agentEditorForm.name.trim()
    const whatsappNumber = agentEditorForm.whatsapp_number.trim()
    if (!name || !whatsappNumber) {
      setActionMessage('Enter agent name and WhatsApp number.')
      return
    }

    setSavingAgent(true)
    setActionMessage('')
    try {
      const savedAgent = agentEditorForm.id
        ? await updateAgent({
            id: Number(agentEditorForm.id),
            name,
            whatsapp_number: whatsappNumber,
          })
        : await createAgent({
            name,
            whatsapp_number: whatsappNumber,
          })

      const fetchedAgents = await fetchAgents()
      const nextAgents = Array.isArray(fetchedAgents) ? fetchedAgents : []
      setAgents(nextAgents)
      setAgentEditorForm({
        id: String(savedAgent.id),
        name: savedAgent.name,
        whatsapp_number: savedAgent.whatsapp_number,
      })
      setActionMessage(agentEditorForm.id ? 'Agent updated.' : 'Agent added.')
    } catch (saveError) {
      setActionMessage(getErrorMessage(saveError))
    } finally {
      setSavingAgent(false)
    }
  }

  const handleSavePrizes = async () => {
    if (!gameId) return
    setSavingPrizes(true)
    setActionMessage('')
    try {
      const existingByType = new Map(prizes.map((prize) => [prize.prize_type, prize]))
      const selectedRows = editablePrizes.filter((row) => row.configured)

      const newPrizePayload = selectedRows
        .filter((row) => !existingByType.has(row.prize_type))
        .map((row) => ({
          prize_type: row.prize_type,
          amount: Math.max(0, Number(row.amount) || 0),
          enabled: Boolean(row.enabled),
        }))

      if (newPrizePayload.length > 0) {
        await createGamePrizes(gameId, newPrizePayload)
      }

      const patchRequests: Array<Promise<unknown>> = []

      selectedRows.forEach((row) => {
        if (!existingByType.has(row.prize_type) || row.claimed) return
        patchRequests.push(
          updateGamePrize(gameId, row.prize_type, {
            amount: Math.max(0, Number(row.amount) || 0),
            enabled: Boolean(row.enabled),
          }),
        )
      })

      editablePrizes.forEach((row) => {
        if (!existingByType.has(row.prize_type) || row.claimed) return
        if (row.configured) return
        patchRequests.push(
          deleteGamePrize(gameId, row.prize_type),
        )
      })

      if (patchRequests.length > 0) {
        await Promise.all(patchRequests)
      }

      const updated = await getPrizes(gameId)
      setPrizes(updated)
      setActionMessage('Prize configuration saved.')
    } catch (saveError) {
      setActionMessage(getErrorMessage(saveError))
    } finally {
      setSavingPrizes(false)
    }
  }

  const handleSendAnnouncement = async () => {
    if (!gameId) {
      setActionMessage('Select a game before sending an announcement.')
      return
    }

    const message = announcementText.trim()
    if (!message) {
      setActionMessage('Announcement message cannot be empty.')
      return
    }

    setSendingAnnouncement(true)
    setActionMessage('')
    try {
      await announceGame(gameId, message)
      setAnnouncementText('')
      setActionMessage('Announcement sent to connected players.')
    } catch (sendError) {
      setActionMessage(getErrorMessage(sendError))
    } finally {
      setSendingAnnouncement(false)
    }
  }

  const loadImageDataUrl = (source: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Canvas context unavailable'))
          return
        }
        context.drawImage(image, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.9))
      }
      image.onerror = () => reject(new Error('Unable to load poster background'))
      image.src = source
    })

  const drawPosterBackground = async (
    doc: jsPDF,
    source: string,
    pageWidth: number,
    pageHeight: number,
  ) => {
    const imageDataUrl = await loadImageDataUrl(source)
    const imageProps = doc.getImageProperties(imageDataUrl)
    const imageRatio = imageProps.width / imageProps.height
    let drawWidth = pageWidth
    let drawHeight = drawWidth / imageRatio

    if (drawHeight < pageHeight) {
      drawHeight = pageHeight
      drawWidth = drawHeight * imageRatio
    }

    const x = (pageWidth - drawWidth) / 2
    const y = (pageHeight - drawHeight) / 2
    doc.addImage(imageDataUrl, 'JPEG', x, y, drawWidth, drawHeight)
  }

  const generatePosterPdf = async () => {
    // Poster-only logic: build a PDF from existing dividend state (no API calls).
    const enabledPrizes = prizes.filter((prize) => prize.enabled)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const selectedPosterBackground =
      wallpaperRegistry[posterBackgroundKey]?.poster ?? wallpaperRegistry.default.poster
    const margin = 48
    const contentWidth = pageWidth - margin * 2
    const centerX = pageWidth / 2
    let y = margin

    try {
      await drawPosterBackground(doc, selectedPosterBackground, pageWidth, pageHeight)
    } catch {
      // If wallpaper fails to load, keep existing text-only PDF output.
    }

    const drawDate = formatDateTime(selectedPosterGame?.date)
    const gameTitle = (settingsForm.gameName || 'Tambola Prize List').toUpperCase()
    const ticketPrice = settingsForm.ticketPrice || '-'
    const ticketLimit = summary?.game.total_tickets ?? (settingsForm.totalTicketLimit || '-')
    const contactNumber = posterContactNumber.trim()
    const topSectionHeight = contactNumber ? 242 : 218

    doc.setFillColor(12, 18, 42)
    doc.roundedRect(margin - 10, y - 18, contentWidth + 20, topSectionHeight, 14, 14, 'F')

    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(40)
    const titleLines = doc.splitTextToSize(gameTitle, contentWidth - 30)
    doc.text(titleLines, centerX, y + 20, { align: 'center' })
    y += 20 + titleLines.length * 40

    doc.setTextColor(255, 215, 70)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(23)
    doc.text('WIN EXCITING CASH PRIZES!', centerX, y, { align: 'center' })
    y += 24

    doc.setFillColor(255, 232, 92)
    doc.roundedRect(margin + 28, y - 16, contentWidth - 56, 38, 8, 8, 'F')
    doc.setTextColor(28, 18, 8)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text(`TICKET PRICE: RS. ${ticketPrice}`, centerX, y + 8, { align: 'center' })
    y += 42

    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.text(`TICKET LIMIT: ${ticketLimit}`, centerX, y, { align: 'center' })
    y += 22

    if (drawDate !== '-') {
      doc.setTextColor(247, 250, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.text(`DRAW DATE & TIME: ${drawDate}`, centerX, y, { align: 'center' })
      y += 18
    }

    if (contactNumber) {
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text(`CONTACT: ${contactNumber}`, centerX, y, { align: 'center' })
      y += 16
    }

    y += 16

    doc.setFillColor(250, 200, 35)
    doc.roundedRect(margin, y - 16, contentWidth, 30, 8, 8, 'F')
    doc.setTextColor(20, 18, 16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(21)
    doc.text('PRIZES', centerX, y + 4, { align: 'center' })
    y += 34

    const drawPrizeHeader = () => {
      doc.setFillColor(20, 28, 48)
      doc.roundedRect(margin, y - 15, contentWidth, 28, 6, 6, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('Prize Name', margin + 12, y + 3)
      doc.text('Amount', pageWidth - margin - 12, y + 3, { align: 'right' })
      y += 24
    }

    drawPrizeHeader()

    enabledPrizes.forEach((prize, index) => {
      if (y > pageHeight - margin - 110) {
        doc.addPage()
        y = margin + 16
        drawPrizeHeader()
      }

      if (index % 2 === 0) {
        doc.setFillColor(18, 27, 49)
      } else {
        doc.setFillColor(28, 39, 68)
      }
      doc.roundedRect(margin, y - 14, contentWidth, 24, 4, 4, 'F')

      const label = PRIZE_LABEL_MAP[prize.prize_type] ?? prize.prize_type
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text(label, margin + 10, y + 2)
      doc.text(`RS. ${prize.amount}`, pageWidth - margin - 10, y + 2, { align: 'right' })
      y += 22
    })

    if (y > pageHeight - margin - 72) {
      doc.addPage()
      y = margin + 24
    }

    doc.setFillColor(231, 73, 55)
    doc.roundedRect(margin, y + 6, contentWidth, 44, 10, 10, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.text('BOOK NOW & DON’T MISS THE FUN!', centerX, y + 34, { align: 'center' })

    doc.setTextColor(40, 44, 52)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('Good Luck & Happy Playing', margin, pageHeight - margin)

    doc.save('tambola-prize-list.pdf')
  }

  const handleMakePoster = async () => {
    // Click handler for poster generation (frontend-only).
    await generatePosterPdf()
  }

  const handleRunControl = async () => {
    if (!gameId || !summary) return
    if (runControlNeedsEnabledPrize && !hasEnabledPrize) {
      setActionMessage('Configure and enable at least one prize before starting or resuming the game.')
      return
    }
    setActionMessage('')
    try {
      if (summary.game.status === 'CREATED') {
        await startGame(gameId, callingInterval)
      } else if (summary.game.status === 'RUNNING') {
        await pauseGame(gameId)
      } else if (summary.game.status === 'PAUSED') {
        await resumeGame(gameId)
      }
      const latestSummary = await rehydrateGameState(gameId)
      setSummary(latestSummary)
      setActionMessage('Game control updated.')
    } catch (actionError) {
      const message = getErrorMessage(actionError)
      if (message.toLowerCase().includes('configure at least one prize')) {
        setActionMessage('Cannot start/resume: configure and enable at least one prize first.')
      } else {
        setActionMessage(message)
      }
    }
  }

  const resetLocalAdminState = () => {
    setGameId('')
    setSummary(null)
    setBusiness(null)
    setPrizes([])
    setEditablePrizes([])
    setTickets([])
    setWinners([])
    setError('')
    setActionMessage('')
    setSearchKeyword('')
    setCallingInterval(10)
    // Reset ticket view mode when switching games.
    setShowTicketCards(false)
    setSettingsForm({
      gameName: '',
      gameDateTime: '',
      totalTicketLimit: '',
      ticketPrice: '',
      callingInterval: '10',
      agentCommission: '',
      agentId: '',
      bookingStatus: 'OPEN',
      websiteStatus: 'OPEN',
    })
    resetLiveState()
  }

  const handleSetNewGame = () => {
    resetLocalAdminState()
    navigate('/admin?setup=1')
  }

  const actionHandlers: Array<{
    key: string
    label: string
    unsafeWhileRunning?: boolean
    handler: () => Promise<void> | void
  }> = [
    {
      key: 'reset-call',
      label: 'Reset call',
      unsafeWhileRunning: true,
      handler: async () => {
        if (!gameId) return
        await resetCall(gameId)
        await loadAll(gameId)
        setActionMessage('Call history reset.')
      },
    },
    {
      key: 'reset-ticket',
      label: 'Reset ticket',
      unsafeWhileRunning: true,
      handler: async () => {
        if (!gameId) return
        await resetTicket(gameId)
        await loadAll(gameId)
        setActionMessage('Ticket assignments reset.')
      },
    },
    {
      key: 'reset-agent',
      label: 'Reset agent',
      unsafeWhileRunning: true,
      handler: async () => {
        if (!gameId) return
        await resetAgent(gameId)
        await loadAll(gameId)
        setActionMessage('Agent assignments reset.')
      },
    },
    {
      key: 'backup-ticket',
      label: 'Load backup ticket',
      unsafeWhileRunning: true,
      handler: async () => {
        if (!gameId) return
        const refreshedTickets = await getTickets(gameId)
        setTicketsFromBackend(gameId, refreshedTickets)
        setTickets(refreshedTickets)
      },
    },
    {
      key: 'current-ticket',
      label: 'Show current ticket',
      handler: () => {
        if (!gameId) return
        navigate(`/admin/tickets?gameId=${gameId}`)
      },
    },
    {
      key: 'current-winner',
      label: 'Show current winner',
      handler: () => winnerSectionRef.current?.scrollIntoView({ behavior: 'smooth' }),
    },
    {
      key: 'ticket-history',
      label: 'Show ticket history',
      handler: async () => {
        if (!gameId) return
        // Keep legacy table view for history list.
        setShowTicketCards(false)
        const refreshedTickets = await getTickets(gameId)
        setTicketsFromBackend(gameId, refreshedTickets)
        setTickets(refreshedTickets)
        ticketSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
      },
    },
    {
      key: 'winner-history',
      label: 'Show winner history',
      handler: async () => {
        if (!gameId) return
        setWinners(await getWinners(gameId))
        winnerSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
      },
    },
    {
      key: 'business-history',
      label: 'Show business history',
      handler: async () => {
        if (!gameId) return
        setBusiness(await getGameBusinessSummary(gameId))
        businessSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
      },
    },
  ]

  return (
    <main className={`admin-page admin-page--${activeView}`}>
      <header className="admin-page__header">
        <h1>{viewTitleMap[activeView]}</h1>
        <div className="admin-page__toolbar">
          {summary?.game.status === 'FINISHED' && !isSetupMode && (
            <button className="secondary-btn" onClick={handleSetNewGame}>
              Set New Game
            </button>
          )}
          <select
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            className="admin-select"
            disabled={!games.length}
          >
            {!games.length && <option value="">{publicGamesError ? 'Games unavailable' : 'No game'}</option>}
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name} - {formatDateTime(game.date)} ({game.status})
              </option>
            ))}
          </select>
          <button type="button" className="secondary-btn" onClick={handleThemeToggle}>
            Theme: {formatThemeLabel(theme)}
          </button>
          <button
            type="button"
            className="secondary-btn admin-logout-btn"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </header>

      <nav className="admin-subnav" aria-label="Admin sections">
        {routeTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`admin-subnav__item ${activeView === tab.key ? 'active' : ''}`}
            onClick={() => {
              const target = gameId ? `${tab.path}?gameId=${gameId}` : tab.path
              navigate(target)
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="admin-view-banner">
        <div>
          <h2>{viewTitleMap[activeView]}</h2>
          <p>
            {activeView === 'main' && 'Complete control panel for setup, run, booking, reporting, and poster.'}
            {activeView === 'run' && 'Live calling operations, call board, and claim monitoring.'}
            {activeView === 'book' && 'Review pending ticket requests and confirm or reject them.'}
            {activeView === 'list' && 'Winner history, ticket history, and business metrics.'}
            {activeView === 'prizes' && 'Configure prize types, amount, and enablement before game start.'}
            {activeView === 'poster' && 'Dividend setup and poster generation preview.'}
          </p>
        </div>
      </section>

      {loading && <div className="admin-message">Loading...</div>}
      {publicGamesError && <div className="admin-message error">{publicGamesError}</div>}
      {error && <div className="admin-message error">{error}</div>}
      {actionMessage && <div className="admin-message">{actionMessage}</div>}

      <section className="admin-card">
        <h2>Admin Dashboard (Read-only)</h2>
        <div className="kv-grid">
          <div>Game name</div>
          <div>{summary?.game.name ?? settingsForm.gameName ?? '-'}</div>
          <div>Game date-time</div>
          <div>{formatDateTime(games.find((item) => item.id === gameId)?.date)}</div>
          <div>Game status</div>
          <div>{summary?.game.status ?? '-'}</div>
          <div>Calling interval</div>
          <div>{summary?.game.calling_interval ?? '-'}</div>
          <div>Booking status</div>
          <div>{summary?.game.booking_status ?? '-'}</div>
          <div>Website status</div>
          <div>{summary?.game.website_status ?? '-'}</div>
        </div>
      </section>

      <section className="admin-card">
        <h2>Player Announcement</h2>
        <p className="announcement-help">
          Send a live written message to all connected players.  For different style give prefix like [warning], [success],[danger] and default is [info].
        </p>
        <div className="announcement-form">
          <textarea
            value={announcementText}
            onChange={(event) => setAnnouncementText(event.target.value)}
            placeholder="Example: Game will resume in 2 minutes."
            rows={3}
            maxLength={1000}
          />
          <button
            type="button"
            className="primary-btn"
            onClick={handleSendAnnouncement}
            disabled={!gameId || sendingAnnouncement || !announcementText.trim()}
          >
            {sendingAnnouncement ? 'Sending...' : 'Send Announcement'}
          </button>
        </div>
      </section>

      {showOverview && (
        <>
          <section className="admin-card">
            <h2>Game Settings</h2>
            <div className="form-grid">
              <label>
                Game name
                <input
                  type="text"
                  value={settingsForm.gameName}
                  onChange={(event) =>
                    setSettingsForm((state) => ({ ...state, gameName: event.target.value }))
                  }
                  maxLength={255}
                />
              </label>
              <label>
                Game date-time
                <input
                  type="datetime-local"
                  value={settingsForm.gameDateTime}
                  onChange={(event) =>
                    setSettingsForm((state) => ({ ...state, gameDateTime: event.target.value }))
                  }
                />
              </label>
              <label>
                Total ticket limit
                <input
                  type="number"
                  value={settingsForm.totalTicketLimit}
                  onChange={(event) =>
                    setSettingsForm((state) => ({ ...state, totalTicketLimit: event.target.value }))
                  }
                />
              </label>
              <label>
                Ticket price
                <input
                  type="number"
                  value={settingsForm.ticketPrice}
                  onChange={(event) =>
                    setSettingsForm((state) => ({ ...state, ticketPrice: event.target.value }))
                  }
                />
              </label>
              <label>
                Calling interval (seconds)
                <input
                  type="number"
                  min={1}
                  value={settingsForm.callingInterval}
                  onChange={(event) => {
                    const value = event.target.value
                    setSettingsForm((state) => ({ ...state, callingInterval: value }))
                    const parsed = Number(value)
                    if (Number.isFinite(parsed) && parsed > 0) {
                      setCallingInterval(Math.floor(parsed))
                    }
                  }}
                />
              </label>
              <label>
                Agent commission
                <input
                  type="number"
                  value={settingsForm.agentCommission}
                  onChange={(event) =>
                    setSettingsForm((state) => ({ ...state, agentCommission: event.target.value }))
                  }
                />
              </label>
              <label>
                Agent
                <select
                  value={settingsForm.agentId}
                  onChange={(event) =>
                    setSettingsForm((state) => ({ ...state, agentId: event.target.value }))
                  }
                >
                  <option value="">Select Agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.whatsapp_number})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Booking status
                <select
                  value={settingsForm.bookingStatus}
                  onChange={(event) =>
                    setSettingsForm((state) => ({
                      ...state,
                      bookingStatus: event.target.value as SettingsForm['bookingStatus'],
                    }))
                  }
                >
                  <option value="OPEN">OPEN</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </label>
              <label>
                Website status
                <select
                  value={settingsForm.websiteStatus}
                  onChange={(event) =>
                    setSettingsForm((state) => ({
                      ...state,
                      websiteStatus: event.target.value as SettingsForm['websiteStatus'],
                    }))
                  }
                >
                  <option value="OPEN">OPEN</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </label>
            </div>
            <button onClick={handleSettingsSave} disabled={savingSettings} className="primary-btn">
              {savingSettings ? 'Saving...' : 'Save Game Settings'}
            </button>
          </section>

          <section className="admin-card">
            <h2>Agent Manager</h2>
            <div className="form-grid">
              <label>
                Existing agent
                <select
                  value={agentEditorForm.id}
                  onChange={(event) => handleAgentEditorSelect(event.target.value)}
                >
                  <option value="">Add New Agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.whatsapp_number})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Agent name
                <input
                  type="text"
                  value={agentEditorForm.name}
                  onChange={(event) =>
                    setAgentEditorForm((state) => ({ ...state, name: event.target.value }))
                  }
                  maxLength={100}
                />
              </label>
              <label>
                WhatsApp number
                <input
                  type="text"
                  value={agentEditorForm.whatsapp_number}
                  onChange={(event) =>
                    setAgentEditorForm((state) => ({ ...state, whatsapp_number: event.target.value }))
                  }
                  placeholder="+919876543210"
                />
              </label>
            </div>
            <div className="agent-manager-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleSaveAgent()}
                disabled={savingAgent || !agentEditorForm.name.trim() || !agentEditorForm.whatsapp_number.trim()}
              >
                {savingAgent ? 'Saving...' : agentEditorForm.id ? 'Update Agent' : 'Add Agent'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() =>
                  setAgentEditorForm({
                    id: '',
                    name: '',
                    whatsapp_number: '',
                  })
                }
                disabled={savingAgent}
              >
                Clear
              </button>
            </div>
          </section>
        </>
      )}

      {showPrizeView && (
        <section className="admin-card">
          <h2>Configure Prizes</h2>
          {!gameId && (
            <div className="prize-setup-state neutral">Select a game first, then configure prizes.</div>
          )}
          {gameId && configuredPrizeCount === 0 && (
            <div className="prize-setup-state warning">
              No prizes configured. Select at least one prize type and save.
            </div>
          )}
          {gameId && configuredPrizeCount > 0 && enabledPrizeCount === 0 && (
            <div className="prize-setup-state warning">
              Prizes are configured but none are enabled. Enable at least one prize to start or resume.
            </div>
          )}
          {gameId && enabledPrizeCount > 0 && (
            <div className="prize-setup-state ready">
              Ready to start game: {enabledPrizeCount} prize{enabledPrizeCount === 1 ? '' : 's'} enabled.
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Configure</th>
                  <th>Prize type</th>
                  <th>Amount</th>
                  <th>Enabled</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {editablePrizes.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{prizeTypesLoading ? 'Loading prize types...' : 'No prize types found.'}</td>
                  </tr>
                ) : (
                  editablePrizes.map((prize) => (
                    <tr key={prize.prize_type}>
                      <td>
                        <input
                          type="checkbox"
                          checked={prize.configured}
                          disabled={!canEditPrizeConfig || prize.claimed}
                          onChange={(event) =>
                            setEditablePrizes((state) =>
                              state.map((item) =>
                                item.prize_type === prize.prize_type
                                  ? {
                                      ...item,
                                      configured: event.target.checked,
                                      enabled: event.target.checked ? item.enabled : false,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>{prize.label}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={prize.amount}
                          disabled={!prize.configured || !canEditPrizeConfig || prize.claimed}
                          onChange={(event) => {
                            const nextAmount = Math.max(0, Number(event.target.value) || 0)
                            setEditablePrizes((state) =>
                              state.map((item) =>
                                item.prize_type === prize.prize_type
                                  ? { ...item, amount: nextAmount }
                                  : item,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={prize.enabled}
                          disabled={!prize.configured || !canEditPrizeConfig || prize.claimed}
                          onChange={(event) =>
                            setEditablePrizes((state) =>
                              state.map((item) =>
                                item.prize_type === prize.prize_type
                                  ? { ...item, enabled: event.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        {prize.claimed
                          ? 'LOCKED'
                          : prize.configured
                            ? 'CONFIGURED'
                            : 'NOT CONFIGURED'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <button
            onClick={handleSavePrizes}
            disabled={savingPrizes || !gameId || !canEditPrizeConfig || prizeTypesLoading}
            className="primary-btn"
          >
            {savingPrizes ? 'Saving...' : 'Save Prize Configuration'}
          </button>
          <button className="secondary-btn" onClick={handleMakePoster} disabled={!gameId}>
            Make Poster
          </button>
        </section>
      )}

      {(showRunView || showBookView) && (
        <section className="admin-card">
          <h2>Action Panel</h2>
          <div className="action-grid">
            {actionHandlers.map((action) => (
            <button
              key={action.key}
              className="action-btn"
              disabled={Boolean(
                action.unsafeWhileRunning &&
                  running &&
                  !(allNumbersCalled && resetActionsAllowedAtEnd.has(action.key)),
              )}
              onClick={() => void action.handler()}
            >
              {action.label}
            </button>
            ))}
          </div>
        </section>
      )}

      {showRunView && (
        <section className="admin-card">
          <h2>Game Calling Control</h2>
          <div className="voice-mode-control">
            <label htmlFor="admin-voice-mode">Voice mode</label>
            <div className="voice-mode-actions">
              <select
                id="admin-voice-mode"
                value={voiceMode}
                onChange={(event) => setVoiceMode(event.target.value as VoiceMode)}
              >
                {VOICE_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {isSpeechSupported && (!isAudioReady || Boolean(audioBlockedMessage)) && (
                <button type="button" className="secondary-btn voice-unlock-btn" onClick={unlockAudio}>
                  Enable Sound
                </button>
              )}
            </div>
          </div>
          {(audioBlockedMessage || bingoAnnouncement) && (
            <div className="bingo-call-banner">{audioBlockedMessage || bingoAnnouncement}</div>
          )}
          <div className="control-grid">
            <div>Calling status</div>
            <div>{running ? 'ON' : 'OFF'}</div>
            <div>Calling interval</div>
            <div>
              <select
                value={callingInterval}
                onChange={(event) => handleCallingIntervalSelect(Number(event.target.value))}
                disabled={savingCallingInterval}
              >
                {[1, 2, 5, 10, 12, 15, 20, 30].map((interval) => (
                  <option key={interval} value={interval}>
                    {interval}s
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="control-buttons">
            <button onClick={handleRunControl} disabled={runControlDisabled} className="primary-btn">
              {runControlLabel}
            </button>
          </div>
          {running && savingCallingInterval && (
            <p className="prize-setup-hint">Updating calling interval...</p>
          )}
          {!running && runControlNeedsEnabledPrize && !hasEnabledPrize && (
            <p className="prize-setup-hint">
              Start/Resume is blocked until at least one configured prize is enabled.
            </p>
          )}

          <NumberBoard calledNumbers={calledNumbers} />
        </section>
      )}

      {showRunView && (
        <section className="admin-card" ref={winnerSectionRef}>
          <h2>Live Prize Claim Monitor</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Prize</th>
                  <th>Status</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {claimMonitorRows.map((row) => (
                  <tr key={row.prizeType}>
                    <td>{row.label}</td>
                    <td>{row.claimed ? 'CLAIMED' : 'OPEN'}</td>
                    <td>{row.winner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showListView && (
        <section className="admin-card" ref={winnerSectionRef}>
          <h2>Winner History</h2>
          <div className="table-wrap">
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
                {mergedWinners.length === 0 && (
                  <tr>
                    <td colSpan={4}>No winners yet.</td>
                  </tr>
                )}
                {mergedWinners.map((winner) => (
                  <tr key={winner.id}>
                    <td>{PRIZE_LABEL_MAP[winner.prize_type] ?? winner.prize_type}</td>
                    <td>{winner.player_name ?? 'Player'}</td>
                    <td>#{winner.ticket_number}</td>
                    <td>{winner.won_at ? formatDateTime(winner.won_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showListView && (
        <section className="admin-card" ref={businessSectionRef}>
          <h2>Business Info</h2>
          <div className="kv-grid">
            <div>Total tickets</div>
            <div>{totalTicketsValue}</div>
            <div>Tickets booked</div>
            <div>{business?.tickets_booked ?? '-'}</div>
            <div>Tickets left</div>
            <div>{business?.tickets_left ?? '-'}</div>
            <div>Ticket price</div>
            <div>{settingsForm.ticketPrice || '-'}</div>
            <div>Agent commission</div>
            <div>{(business?.agent_commission ?? settingsForm.agentCommission) || '-'}</div>
            <div>Total revenue</div>
            <div>{business?.total_revenue ?? '-'}</div>
            <div>Total prize money</div>
            <div>{business?.total_prize_money ?? '-'}</div>
            <div>Profit / Loss</div>
            <div>{business?.total_profit ?? '-'}</div>
          </div>
        </section>
      )}

      {(showBookView || showListView) && (
        <section className="admin-card" ref={ticketSectionRef}>
          <h2>Ticket & Agent List</h2>
          <div className="ticket-toolbar">
            <input
              placeholder="Search ticket / player / status"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
            />
          </div>

          <div className="pending-requests-panel">
            <div className="pending-requests-head">
              <strong>Pending ticket requests</strong>
              <span>{pendingTickets.length}</span>
            </div>
            {pendingTickets.length === 0 ? (
              <div className="pending-requests-empty">No pending booking requests.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Requested By</th>
                      <th>WhatsApp</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTickets.map((ticket) => {
                      const approving =
                        pendingActionType === 'approve' && pendingActionTicketId === ticket.id
                      const rejecting =
                        pendingActionType === 'reject' && pendingActionTicketId === ticket.id
                      return (
                        <tr key={`pending-${ticket.ticket_number}`}>
                          <td>{ticket.ticket_number}</td>
                          <td>{ticket.requested_by_name ?? '-'}</td>
                          <td>{ticket.requested_by_whatsapp ?? '-'}</td>
                          <td>
                            <div className="pending-actions">
                              <button
                                type="button"
                                className="approve-btn"
                                onClick={() => void handleApprovePendingRequest(ticket)}
                                disabled={!ticket.id || approving || rejecting}
                              >
                                {approving ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                className="reject-btn"
                                onClick={() => void handleRejectPendingRequest(ticket)}
                                disabled={!ticket.id || approving || rejecting}
                              >
                                {rejecting ? 'Rejecting...' : 'Reject'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {showTicketCards ? (
            <div>
              {filteredTickets.map((ticket) => (
                <TambolaTicketCard
                  key={ticket.ticket_number}
                  ticket={ticket}
                />
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticket no</th>
                    <th>Player</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((ticket) => {
                    const ticketStatus = normalizeTicketStatus(ticket.status)
                    const ticketActionId = ticket.id ?? `ticket-${ticket.ticket_number}`
                    const rowActionBusy =
                      ticketManageActionTicketId === ticketActionId ||
                      (Boolean(ticket.id) && pendingActionTicketId === ticket.id)
                    const bookingActionBusy = rowActionBusy && ticketManageActionType === 'book'
                    const editActionBusy = rowActionBusy && ticketManageActionType === 'edit'
                    const removeActionBusy = rowActionBusy && ticketManageActionType === 'remove'
                    const approving =
                      Boolean(ticket.id) &&
                      pendingActionType === 'approve' &&
                      pendingActionTicketId === ticket.id
                    const rejecting =
                      Boolean(ticket.id) &&
                      pendingActionType === 'reject' &&
                      pendingActionTicketId === ticket.id

                    return (
                      <tr key={ticket.ticket_number}>
                        <td>{ticket.ticket_number}</td>
                        <td>{ticket.player_name ?? '-'}</td>
                        <td>{ticket.player_phone ?? '-'}</td>
                        <td>
                          {ticketStatus === 'CONFIRMED' && ticket.player_name
                            ? `CONFIRMED : ${ticket.player_name}`
                            : ticketStatus === 'PENDING' && ticket.requested_by_name
                              ? `PENDING : ${ticket.requested_by_name}`
                              : ticketStatus}
                        </td>
                        <td>{ticket.ticket_type}</td>
                        <td>
                          <div className="ticket-manage-actions">
                            {ticketStatus === 'AVAILABLE' ? (
                              <button
                                type="button"
                                className="approve-btn"
                                onClick={() => void handleBookAvailableTicket(ticket)}
                                disabled={rowActionBusy}
                              >
                                {bookingActionBusy ? 'Booking...' : 'Book'}
                              </button>
                            ) : (
                              <>
                                {ticketStatus === 'PENDING' ? (
                                  <button
                                    type="button"
                                    className="approve-btn"
                                    onClick={() => void handleApprovePendingRequest(ticket)}
                                    disabled={!ticket.id || rowActionBusy}
                                  >
                                    {approving ? 'Approving...' : 'Approve'}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="approve-btn"
                                  onClick={() => void handleEditTicketAssignment(ticket)}
                                  disabled={!ticket.id || rowActionBusy}
                                >
                                  {editActionBusy ? 'Saving...' : 'Edit'}
                                </button>
                                <button
                                  type="button"
                                  className="reject-btn"
                                  onClick={() =>
                                    ticketStatus === 'PENDING'
                                      ? void handleRejectPendingRequest(ticket)
                                      : void handleReleaseTicket(ticket)
                                  }
                                  disabled={!ticket.id || rowActionBusy}
                                >
                                  {ticketStatus === 'PENDING'
                                    ? rejecting
                                      ? 'Rejecting...'
                                      : 'Reject'
                                    : removeActionBusy
                                      ? 'Removing...'
                                      : 'Remove'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showPosterView && (
        <section className="admin-card print-area">
          <h2>Poster Preview</h2>
          <div className="poster-controls">
            <label htmlFor="poster-background-select">
              Poster Background
              <select
                id="poster-background-select"
                value={posterBackgroundKey}
                onChange={(event) => setPosterBackgroundKey(event.target.value as PosterBackgroundKey)}
              >
                {(Object.keys(wallpaperRegistry) as PosterBackgroundKey[]).map((key) => (
                  <option key={key} value={key}>
                    {POSTER_BACKGROUND_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="poster-preview"
            style={{
              backgroundImage: `linear-gradient(rgba(23, 14, 44, 0.68), rgba(23, 14, 44, 0.68)), url(${wallpaperRegistry[posterBackgroundKey]?.poster ?? wallpaperRegistry.default.poster})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          >
            <h3>{settingsForm.gameName || 'Tambola Big Win'}</h3>
            <p>Draw: {formatDateTime(selectedPosterGame?.date)}</p>
            <p>Ticket price: {settingsForm.ticketPrice || '-'}</p>
            <p>Total tickets: {totalTicketsValue}</p>
            {posterContactNumber ? <p className="poster-preview-contact">Contact: {posterContactNumber}</p> : null}
            <ul className="poster-preview-prize-list">
              {prizes.map((prize) => (
                <li key={prize.prize_type} className="poster-preview-prize-row">
                  <span className="poster-preview-prize-name">{PRIZE_LABEL_MAP[prize.prize_type] ?? prize.prize_type}</span>
                  <span className="poster-preview-prize-amount">RS. {prize.amount}</span>
                </li>
              ))}
            </ul>
          </div>
          <button className="primary-btn" onClick={handleMakePoster}>
            Print Poster
          </button>
        </section>
      )}
    </main>
  )
}

export default AdminDashboard
