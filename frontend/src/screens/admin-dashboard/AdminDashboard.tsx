import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { fetchPublicGames } from '@/api/rest/games'
import {
  bookTicket,
  getGameBusinessSummary,
  getGameState,
  getGameSummary,
  getPrizes,
  getTickets,
  getWinners,
  pauseGame,
  resetAgent,
  resetCall,
  resetTicket,
  resumeGame,
  saveGameSettings,
  startGame,
  updateActiveTheme,
  updatePrizes,
  type GameBusinessSummaryResponse,
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
import type { PublicGame } from '@/types/backend/game'
import { jsPDF } from 'jspdf'
import {
  formatThemeLabel,
  getActiveTheme,
  setAdminTheme,
  subscribeThemeChange,
  toggleAdminTheme,
} from '@/utils/theme'
import './AdminDashboard.css'

type SettingsForm = {
  gameDateTime: string
  totalTicketLimit: string
  ticketPrice: string
  agentCommission: string
  bookingStatus: 'OPEN' | 'CLOSED'
  websiteStatus: 'OPEN' | 'CLOSED'
}

type BookingForm = {
  ticketNumber: string
  bookingMode: 'RANDOM' | 'HALF_SHEET' | 'FULL_SHEET'
  playerName: string
  playerPhone: string
}

// Frontend-only default dividends (no backend dependency).
const DEFAULT_DIVIDENDS: PrizeResponse[] = [
  { prize_type: 'FIRST_HOUSE', amount: 0, enabled: true, claimed: false },
  { prize_type: 'SECOND_HOUSE', amount: 0, enabled: true, claimed: false },
  { prize_type: 'THIRD_HOUSE', amount: 0, enabled: true, claimed: false },
  { prize_type: 'FULL_SHEET', amount: 0, enabled: true, claimed: false },
  { prize_type: 'HALF_SHEET', amount: 0, enabled: true, claimed: false },
  { prize_type: 'TOP_LINE', amount: 0, enabled: true, claimed: false },
  { prize_type: 'MIDDLE_LINE', amount: 0, enabled: true, claimed: false },
  { prize_type: 'BOTTOM_LINE', amount: 0, enabled: true, claimed: false },
  { prize_type: 'BOX', amount: 0, enabled: true, claimed: false },
  { prize_type: 'CORNER', amount: 0, enabled: true, claimed: false },
  { prize_type: 'STAR', amount: 0, enabled: true, claimed: false },
  { prize_type: 'EARLY_5', amount: 0, enabled: true, claimed: false },
  { prize_type: 'QUICK_6', amount: 0, enabled: true, claimed: false },
  { prize_type: 'QUICK_7', amount: 0, enabled: true, claimed: false },
]

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

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: string; response?: { data?: { detail?: string } } }
    return maybeError.response?.data?.detail || maybeError.message || 'Request failed.'
  }
  return 'Request failed.'
}

const toDateTimeLocalValue = (value: string | null | undefined): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

const formatDateTime = (value?: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
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
  const [games, setGames] = useState<PublicGame[]>([])
  const [gameId, setGameId] = useState<string>('')
  const [summary, setSummary] = useState<GameSummaryResponse | null>(null)
  const [business, setBusiness] = useState<GameBusinessSummaryResponse | null>(null)
  const [prizes, setPrizes] = useState<PrizeResponse[]>(DEFAULT_DIVIDENDS)
  const [editablePrizes, setEditablePrizes] = useState<PrizeResponse[]>(DEFAULT_DIVIDENDS)
  const [tickets, setTickets] = useState<TicketResponse[]>([])
  const [winners, setWinners] = useState<WinnerResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [publicGamesError, setPublicGamesError] = useState<string>('')
  const [actionMessage, setActionMessage] = useState<string>('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [callingInterval, setCallingInterval] = useState<number>(10)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingPrizes, setSavingPrizes] = useState(false)
  const [bookingTicket, setBookingTicket] = useState(false)
  const [showTicketCards, setShowTicketCards] = useState(false)
  const [theme, setTheme] = useState(getActiveTheme())

  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    gameDateTime: '',
    totalTicketLimit: '',
    ticketPrice: '',
    agentCommission: '',
    bookingStatus: 'OPEN',
    websiteStatus: 'OPEN',
  })
  const [bookingForm, setBookingForm] = useState<BookingForm>({
    ticketNumber: '',
    bookingMode: 'RANDOM',
    playerName: '',
    playerPhone: '',
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
    status: liveStatus,
    calledNumbers: liveCalledNumbers,
    winners: liveWinners,
    lockedPrizeTypes,
    replaceFromBackendState,
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
  const activeView: 'main' | 'run' | 'book' | 'list' | 'poster' = normalizedPath.endsWith('/run')
    ? 'run'
    : normalizedPath.endsWith('/book')
      ? 'book'
      : normalizedPath.endsWith('/list')
        ? 'list'
        : normalizedPath.endsWith('/poster')
          ? 'poster'
          : 'main'
  const viewTitleMap: Record<typeof activeView, string> = {
    main: 'Main Dashboard',
    run: 'Run Control',
    book: 'Ticket Booking',
    list: 'History & Reports',
    poster: 'Poster & Dividend',
  }
  const routeTabs = [
    { key: 'main' as const, label: 'Dashboard', path: '/admin' },
    { key: 'run' as const, label: 'Run', path: '/admin/run' },
    { key: 'book' as const, label: 'Book', path: '/admin/book' },
    { key: 'list' as const, label: 'List', path: '/admin/list' },
    { key: 'poster' as const, label: 'Poster', path: '/admin/poster' },
  ]

  // Real-time stream for called numbers and winner announcements.
  useGameSocket(gameId || undefined)

  const refreshSummaryAndState = useCallback(async (selectedGameId: string) => {
    const [summaryData, stateData] = await Promise.all([
      getGameSummary(selectedGameId),
      getGameState(selectedGameId),
    ])
    setSummary(summaryData)
    replaceFromBackendState(stateData)
    setCallingInterval(summaryData.game.calling_interval || 10)
    return summaryData
  }, [replaceFromBackendState])

  const loadAll = useCallback(
    async (selectedGameId: string) => {
      setLoading(true)
      setError('')
      try {
        const [summaryData, businessData, prizesData, ticketsData, winnersData] = await Promise.all([
          refreshSummaryAndState(selectedGameId),
          getGameBusinessSummary(selectedGameId),
          getPrizes(selectedGameId),
          getTickets(selectedGameId),
          getWinners(selectedGameId),
        ])

        setBusiness(businessData)
        // Only apply backend prize data when it exists; otherwise keep defaults.
        if (Array.isArray(prizesData) && prizesData.length > 0) {
          setPrizes(prizesData)
          setEditablePrizes(prizesData)
        }
        setTickets(ticketsData)
        setWinners(winnersData)

        const selectedGame = games.find((item) => item.id === selectedGameId)
        setSettingsForm({
          gameDateTime: toDateTimeLocalValue(selectedGame?.date),
          totalTicketLimit: String(summaryData.game.total_tickets ?? businessData.total_tickets),
          ticketPrice: String(summaryData.game.ticket_price ?? selectedGame?.ticket_price ?? ''),
          agentCommission: String(summaryData.game.agent_commission ?? businessData.agent_commission ?? 0),
          bookingStatus: summaryData.game.booking_status === 'CLOSED' ? 'CLOSED' : 'OPEN',
          websiteStatus: summaryData.game.website_status === 'CLOSED' ? 'CLOSED' : 'OPEN',
        })
      } catch (loadError) {
        setError(getErrorMessage(loadError))
      } finally {
        setLoading(false)
      }
    },
    [games, refreshSummaryAndState],
  )

  // Primary bootstrap: choose current game from query param or first public game.
  useEffect(() => {
    let mounted = true
    const loadGames = async () => {
      try {
        setPublicGamesError('')
        const publicGames = await fetchPublicGames()
        if (!mounted) return
        setGames(publicGames)
        if (isSetupMode) {
          setGameId('')
          return
        }
        if (!publicGames.length) return
        const queryGameId = searchParams.get('gameId')
        const chosenGame = queryGameId
          ? publicGames.find((item) => item.id === queryGameId) || publicGames[0]
          : publicGames[0]
        setGameId(chosenGame.id)
      } catch (loadGamesError) {
        if (!mounted) return
        setPublicGamesError(`Unable to load public games: ${getErrorMessage(loadGamesError)}`)
      }
    }
    void loadGames()
    return () => {
      mounted = false
    }
  }, [isSetupMode, searchParams])

  useEffect(() => {
    if (!gameId) return
    void loadAll(gameId)
  }, [gameId, loadAll])

  useEffect(() => {
    if (!gameId) return
    // Sync ticket list when bookings happen from another session/device.
    const unsubscribe = socketManager.subscribe('ticket.booked', async () => {
      try {
        const freshTickets = await getTickets(gameId)
        setTickets(freshTickets)
      } catch {
        // Ignore refresh failures; next manual action will refresh.
      }
    })
    return () => {
      unsubscribe()
    }
  }, [gameId])

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
  const resetActionsAllowedAtEnd = new Set(['reset-call', 'reset-ticket', 'reset-agent', 'backup-ticket'])
  const showOverview = activeView === 'main'
  const showRunView = activeView === 'main' || activeView === 'run'
  const showBookView = activeView === 'main' || activeView === 'book'
  const showListView = activeView === 'main' || activeView === 'list'
  const showPosterView = activeView === 'main' || activeView === 'poster'

  const filteredTickets = useMemo(() => {
    const query = searchKeyword.trim().toLowerCase()
    if (!query) return tickets
    return tickets.filter((ticket) => {
      const value = `${ticket.ticket_number} ${ticket.player_name ?? ''} ${ticket.status}`.toLowerCase()
      return value.includes(query)
    })
  }, [tickets, searchKeyword])

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

  const mergeBookedTickets = useCallback((bookedTickets: TicketResponse[]) => {
    if (!bookedTickets.length) return
    // Merge updates locally so the UI stays fresh even if a refresh call fails.
    setTickets((prev) => {
      if (!prev.length) return prev
      const bookedMap = new Map(bookedTickets.map((ticket) => [ticket.ticket_number, ticket]))
      let changed = false
      const next = prev.map((ticket) => {
        const booked = bookedMap.get(ticket.ticket_number)
        if (!booked) return ticket
        changed = true
        return { ...ticket, ...booked, status: 'BOOKED' }
      })
      bookedTickets.forEach((ticket) => {
        if (!prev.some((item) => item.ticket_number === ticket.ticket_number)) {
          next.push(ticket)
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [])

  const handleSettingsSave = async () => {
    setSavingSettings(true)
    setActionMessage('')
    try {
      const createdGame = await saveGameSettings({
        date: settingsForm.gameDateTime,
        total_tickets: Number(settingsForm.totalTicketLimit),
        ticket_price: Number(settingsForm.ticketPrice),
        agent_commission: Number(settingsForm.agentCommission || 0),
        booking_status: settingsForm.bookingStatus,
        website_status: settingsForm.websiteStatus,
      })

      // New game creation flow: switch context to the newly created game.
      const latestGames = await fetchPublicGames()
      setGames(latestGames)
      resetLiveState()

      if (createdGame?.id) {
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
      const payload = editablePrizes.map((prize) => ({
        prize_type: prize.prize_type,
        amount: Number(prize.amount),
        enabled: Boolean(prize.enabled),
      }))
      const updated = await updatePrizes(gameId, payload)
      setPrizes(updated)
      setEditablePrizes(updated)
      setActionMessage('Prizes saved.')
    } catch (saveError) {
      setActionMessage(getErrorMessage(saveError))
    } finally {
      setSavingPrizes(false)
    }
  }

  const generatePosterPdf = () => {
    // Poster-only logic: build a PDF from existing dividend state (no API calls).
    const enabledPrizes = editablePrizes.filter((prize) => prize.enabled)
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
    setActionMessage('')
    try {
      if (summary.game.status === 'CREATED') {
        await startGame(gameId, callingInterval)
      } else if (summary.game.status === 'RUNNING') {
        await pauseGame(gameId)
      } else if (summary.game.status === 'PAUSED') {
        await resumeGame(gameId)
      }
      const latestSummary = await refreshSummaryAndState(gameId)
      setSummary(latestSummary)
      setActionMessage('Game control updated.')
    } catch (actionError) {
      setActionMessage(getErrorMessage(actionError))
    }
  }

  const handleBookTicket = async () => {
    if (!gameId) return
    setBookingTicket(true)
    setActionMessage('')
    try {
      if (!bookingForm.playerName.trim()) {
        throw new Error('Player name is required.')
      }
      if (!bookingForm.playerPhone.trim()) {
        throw new Error('Player phone is required.')
      }
      const bookingPayload: {
        game_id: string
        ticket_number?: number
        booking_mode: 'RANDOM' | 'HALF_SHEET' | 'FULL_SHEET'
        player_name: string
        player_phone: string
      } = {
        game_id: gameId,
        booking_mode: bookingForm.bookingMode,
        player_name: bookingForm.playerName,
        player_phone: bookingForm.playerPhone,
      }

      if (bookingForm.bookingMode === 'RANDOM') {
        if (!bookingForm.ticketNumber.trim()) {
          throw new Error('Ticket number is required for RANDOM booking.')
        }
        bookingPayload.ticket_number = Number(bookingForm.ticketNumber)
      }

      const bookingResult = await bookTicket(bookingPayload)
      const bookedTickets = Array.isArray(bookingResult?.booked_tickets)
        ? (bookingResult.booked_tickets as TicketResponse[])
        : []
      mergeBookedTickets(bookedTickets)
      let latestBusiness = null
      try {
        const [freshTickets, freshBusiness] = await Promise.all([
          getTickets(gameId),
          getGameBusinessSummary(gameId),
        ])
        setTickets(freshTickets)
        latestBusiness = freshBusiness
      } catch {
        // Keep merged tickets if the refresh fails to avoid stale UI.
      }
      setSearchKeyword('')
      if (latestBusiness) {
        setBusiness(latestBusiness)
      }
      const bookedCount = Number(bookingResult?.total_booked || 1)
      setActionMessage(`${bookedCount} ticket${bookedCount === 1 ? '' : 's'} booked.`)
      setBookingForm({ ticketNumber: '', bookingMode: bookingForm.bookingMode, playerName: '', playerPhone: '' })
    } catch (bookError) {
      setActionMessage(getErrorMessage(bookError))
    } finally {
      setBookingTicket(false)
    }
  }

  const resetLocalAdminState = () => {
    setGameId('')
    setSummary(null)
    setBusiness(null)
    // Keep default dividends on reset; do not clear to empty.
    setPrizes(DEFAULT_DIVIDENDS)
    setEditablePrizes(DEFAULT_DIVIDENDS)
    setTickets([])
    setWinners([])
    setError('')
    setActionMessage('')
    setSearchKeyword('')
    setCallingInterval(10)
    // Reset ticket view mode when switching games.
    setShowTicketCards(false)
    setBookingForm({
      ticketNumber: '',
      bookingMode: 'RANDOM',
      playerName: '',
      playerPhone: '',
    })
    setSettingsForm({
      gameDateTime: '',
      totalTicketLimit: '',
      ticketPrice: '',
      agentCommission: '',
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
        setBookingForm({ ticketNumber: '', bookingMode: 'RANDOM', playerName: '', playerPhone: '' })
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
        setTickets(await getTickets(gameId))
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
        setTickets(await getTickets(gameId))
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
            {activeView === 'book' && 'Ticket loading, assignment, and booking workflow.'}
            {activeView === 'list' && 'Winner history, ticket history, and business metrics.'}
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

      {/* Always render Dividend / Prize Settings so it never disappears behind view logic. */}
      <section className="admin-card">
        <h2>Dividend / Prize Settings</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Prize type</th>
                <th>Amount</th>
                <th>Enabled</th>
                <th>Claimed</th>
              </tr>
            </thead>
            <tbody>
              {editablePrizes.length === 0 ? (
                <tr>
                  <td colSpan={4}>No dividend set.</td>
                </tr>
              ) : (
                editablePrizes.map((prize) => (
                  <tr key={prize.prize_type}>
                    <td>{PRIZE_LABEL_MAP[prize.prize_type] ?? prize.prize_type}</td>
                    <td>
                      <input
                        type="number"
                        value={prize.amount}
                        disabled={prize.claimed}
                        onChange={(event) =>
                          setEditablePrizes((state) =>
                            state.map((item) =>
                              item.prize_type === prize.prize_type
                                ? { ...item, amount: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={prize.enabled}
                        disabled={prize.claimed}
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
                    <td>{prize.claimed ? 'LOCKED' : 'OPEN'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <button onClick={handleSavePrizes} disabled={savingPrizes || !gameId} className="primary-btn">
          {savingPrizes ? 'Saving...' : 'Save Dividends'}
        </button>
        {/* Keep poster generation visible here without changing styles or layout. */}
        <button className="secondary-btn" onClick={handleMakePoster}>
          Make Poster
        </button>
      </section>

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
            <button onClick={handleRunControl} disabled={!gameId || finished} className="primary-btn">
              {summary?.game.status === 'RUNNING'
                ? 'Pause Game'
                : summary?.game.status === 'PAUSED'
                  ? 'Resume Game'
                  : 'Run Game'}
            </button>
          </div>

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

          <div className="ticket-booker">
            <select
              value={bookingForm.bookingMode}
              onChange={(event) =>
                setBookingForm((state) => ({
                  ...state,
                  bookingMode: event.target.value as BookingForm['bookingMode'],
                  ticketNumber: '',
                }))
              }
            >
              <option value="RANDOM">Random (1 ticket)</option>
              <option value="HALF_SHEET">Half Sheet (3 tickets)</option>
              <option value="FULL_SHEET">Full Sheet (6 tickets)</option>
            </select>
            <input
              placeholder={
                bookingForm.bookingMode === 'RANDOM'
                  ? 'Ticket number'
                  : 'Auto-selected by backend for grouped booking'
              }
              type="number"
              value={bookingForm.ticketNumber}
              disabled={bookingForm.bookingMode !== 'RANDOM'}
              onChange={(event) => setBookingForm((state) => ({ ...state, ticketNumber: event.target.value }))}
            />
            <input
              placeholder="Player name"
              value={bookingForm.playerName}
              onChange={(event) => setBookingForm((state) => ({ ...state, playerName: event.target.value }))}
            />
            <input
              placeholder="Player phone"
              value={bookingForm.playerPhone}
              onChange={(event) => setBookingForm((state) => ({ ...state, playerPhone: event.target.value }))}
            />
            <button onClick={handleBookTicket} disabled={bookingTicket || running}>
              {bookingTicket ? 'Booking...' : 'Book Ticket'}
            </button>
          </div>

          {showTicketCards ? (
            <div>
              {filteredTickets.map((ticket) => (
                <TambolaTicketCard
                  key={ticket.ticket_number}
                  ticket={ticket}
                  calledNumbers={calledNumbers}
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
                      {/* Append player name to BOOKED status without changing table structure. */}
                      {ticket.status === 'BOOKED' && ticket.player_name
                        ? `BOOKED : ${ticket.player_name}`
                        : ticket.status}
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
