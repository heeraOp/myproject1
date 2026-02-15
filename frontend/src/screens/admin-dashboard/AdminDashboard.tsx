import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  type AgentOption,
  type AdminGameListItem,
  announceGame,
  confirmTicketRequest,
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
  resumeGame,
  saveGameSettings,
  startGame,
  updateActiveTheme,
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
import { useVoiceModeStore, type VoiceMode } from '@/app/store/voiceMode.store'
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
import './AdminDashboard.css'

type SettingsForm = {
  gameDateTime: string
  totalTicketLimit: string
  ticketPrice: string
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
  const [savingPrizes, setSavingPrizes] = useState(false)
  const [pendingActionTicketId, setPendingActionTicketId] = useState<string | null>(null)
  const [pendingActionType, setPendingActionType] = useState<'approve' | 'reject' | null>(null)
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false)
  const [announcementText, setAnnouncementText] = useState('')
  const [showTicketCards, setShowTicketCards] = useState(false)
  const [theme, setTheme] = useState(getActiveTheme())

  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    gameDateTime: '',
    totalTicketLimit: '',
    ticketPrice: '',
    agentCommission: '',
    agentId: '',
    bookingStatus: 'OPEN',
    websiteStatus: 'OPEN',
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

      const selectedGame = games.find((item) => item.id === selectedGameId)
      setSettingsForm({
        gameDateTime: toDateTimeLocalValue(selectedGame?.date),
        totalTicketLimit: String(summaryData.game.total_tickets ?? businessData.total_tickets),
        ticketPrice: String(summaryData.game.ticket_price ?? selectedGame?.ticket_price ?? ''),
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

  const handleSettingsSave = async () => {
    setSavingSettings(true)
    setActionMessage('')
    try {
      const createdGame = await saveGameSettings({
        date: settingsForm.gameDateTime,
        total_tickets: Number(settingsForm.totalTicketLimit),
        ticket_price: Number(settingsForm.ticketPrice),
        agent_commission: Number(settingsForm.agentCommission || 0),
        agent_id: settingsForm.agentId ? Number(settingsForm.agentId) : null,
        booking_status: settingsForm.bookingStatus,
        website_status: settingsForm.websiteStatus,
      })

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
    } catch (saveError) {
      setActionMessage(getErrorMessage(saveError))
    } finally {
      setSavingSettings(false)
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

  const generatePosterPdf = () => {
    // Poster-only logic: build a PDF from existing dividend state (no API calls).
    const enabledPrizes = prizes.filter((prize) => prize.enabled)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 48
    let y = margin

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text('Tambola Prize List', margin, y)
    y += 22

    const drawDate = formatDateTime(games.find((item) => item.id === gameId)?.date)
    if (drawDate !== '-') {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(12)
      doc.text(`Draw: ${drawDate}`, margin, y)
      y += 16
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    y += 8
    doc.text('Prize Type', margin, y)
    doc.text('Amount', pageWidth - margin, y, { align: 'right' })
    y += 8
    doc.setLineWidth(0.6)
    doc.line(margin, y, pageWidth - margin, y)
    y += 14

    doc.setFont('helvetica', 'normal')
    enabledPrizes.forEach((prize) => {
      if (y > pageHeight - margin - 24) {
        doc.addPage()
        y = margin
      }
      const label = PRIZE_LABEL_MAP[prize.prize_type] ?? prize.prize_type
      doc.text(label, margin, y)
      doc.text(String(prize.amount), pageWidth - margin, y, { align: 'right' })
      y += 18
    })

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(11)
    doc.text('Good Luck & Happy Playing', margin, pageHeight - margin)

    doc.save('tambola-prize-list.pdf')
  }

  const handleMakePoster = () => {
    // Click handler for poster generation (frontend-only).
    generatePosterPdf()
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
      gameDateTime: '',
      totalTicketLimit: '',
      ticketPrice: '',
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
                {formatDateTime(game.date)} ({game.status})
              </option>
            ))}
          </select>
          <button type="button" className="secondary-btn" onClick={handleThemeToggle}>
            Theme: {formatThemeLabel(theme)}
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
        <section className="admin-card">
          <h2>Game Settings</h2>
          <div className="form-grid">
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
                <option value="CLASSIC">Classic</option>
                <option value="FUNNY">Funny</option>
                <option value="CRAZY">Crazy</option>
              </select>
              {isSpeechSupported && !isAudioReady && (
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
                onChange={(event) => setCallingInterval(Number(event.target.value))}
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
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.ticket_number}>
                      <td>{ticket.ticket_number}</td>
                      <td>{ticket.player_name ?? '-'}</td>
                      <td>{ticket.player_phone ?? '-'}</td>
                    <td>
                      {normalizeTicketStatus(ticket.status) === 'CONFIRMED' && ticket.player_name
                        ? `CONFIRMED : ${ticket.player_name}`
                        : normalizeTicketStatus(ticket.status) === 'PENDING' && ticket.requested_by_name
                          ? `PENDING : ${ticket.requested_by_name}`
                          : normalizeTicketStatus(ticket.status)}
                    </td>
                      <td>{ticket.ticket_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showPosterView && (
        <section className="admin-card print-area">
          <h2>Poster Preview</h2>
          <div className="poster-preview">
            <h3>Tambola Big Win</h3>
            <p>Draw: {formatDateTime(games.find((item) => item.id === gameId)?.date)}</p>
            <p>Ticket price: {settingsForm.ticketPrice || '-'}</p>
            <p>Total tickets: {totalTicketsValue}</p>
            <ul>
              {prizes.map((prize) => (
                <li key={prize.prize_type}>
                  <span>{PRIZE_LABEL_MAP[prize.prize_type] ?? prize.prize_type}</span>
                  <span>{prize.amount}</span>
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
