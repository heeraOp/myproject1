import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { logoutCurrentUser } from '@/api/rest/auth'
import {
  type AdminLobbyAnnouncementResponse,
  type AgentOption,
  type AdminGameListItem,
  announceGame,
  bookTicketAsAdmin,
  confirmTicketRequest,
  createAgent,
  createGamePrizes,
  getAdminLobbyAnnouncement,
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
  recreateGame,
  resetAgent,
  resetCall,
  resetTicket,
  rejectTicketRequest,
  releaseAdminTicket,
  resumeGame,
  saveGameSettings,
  saveAdminLobbyAnnouncement,
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
import {
  useVoiceModeStore,
  type VoiceMode,
  VOICE_MODE_OPTIONS,
  VOICE_SPEED_OPTIONS,
} from '@/app/store/voiceMode.store'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import TambolaTicketGrid from '@/components/common/TambolaTicketGrid'
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
import { encodeVoiceAnnouncement } from '@/utils/announcementVoice'
import { wallpaperRegistry, resolveWallpaperTheme } from '@/theme/wallpaperRegistry'
import './AdminDashboard.css'
import FloatingBookButton from '@/components/admin/FloatingBookButton'

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

type GameRecreatedSocketPayload = {
  old_game_id?: string
  new_game_id?: string
  reason?: string
  new_game?: AdminGameListItem
}

type BrowserSpeechTranscript = {
  transcript?: string
}

type BrowserSpeechResult = {
  isFinal?: boolean
  0?: BrowserSpeechTranscript
  [index: number]: BrowserSpeechTranscript | undefined
}

type BrowserSpeechResultList = {
  length: number
  [index: number]: BrowserSpeechResult | undefined
}

type BrowserSpeechRecognitionEvent = {
  results: BrowserSpeechResultList
}

type BrowserSpeechRecognitionErrorEvent = {
  error?: string
}

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition

type BrowserSpeechWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionCtor
  webkitSpeechRecognition?: BrowserSpeechRecognitionCtor
}

const getSpeechRecognitionCtor = (): BrowserSpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null
  const speechWindow = window as BrowserSpeechWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
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

const getCurrentDateTimeLocalValue = (): string => {
  return toDateTimeLocalInputInIST(new Date().toISOString())
}

const formatDateTime = (value?: string): string => {
  return formatDateTimeInIST(value)
}

const supportsVoiceRecording = (): boolean =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia)

const resolveVoiceRecorderMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

const getVoiceRecordingExtension = (mimeType: string): string => {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('aac')) return 'aac'
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a'
  return 'webm'
}

const NumberBoard = ({ calledNumbers }: { calledNumbers: number[] }) => {
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers])
  return (
    <div className="number-board-wrap">
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
      <div className="number-board-last-called">
        <div className="number-board-last-called__head">
          <span>Last Called Numbers</span>
          <strong>{calledNumbers.length}</strong>
        </div>
        {calledNumbers.length > 0 ? (
          <div className="number-board-last-called__grid">
            {calledNumbers.map((value, index) => {
              const isLatest = index === calledNumbers.length - 1
              return (
                <div
                  key={`${value}-${index}`}
                  className={`number-board-last-called__chip ${isLatest ? 'latest' : ''}`}
                >
                  {value}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="number-board-last-called__empty">No numbers called yet.</p>
        )}
      </div>
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
  const [showRecreateModal, setShowRecreateModal] = useState(false)
  const [recreateReason, setRecreateReason] = useState('')
  const [recreateInProgress, setRecreateInProgress] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [callingInterval, setCallingInterval] = useState<number>(10)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingCallingInterval, setSavingCallingInterval] = useState(false)
  const [savingPrizes, setSavingPrizes] = useState(false)
  const [savingAgent, setSavingAgent] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [pendingActionTicketId, setPendingActionTicketId] = useState<string | null>(null)
  const [pendingActionType, setPendingActionType] = useState<'approve' | 'reject' | null>(null)
  const [bulkApproveInProgress, setBulkApproveInProgress] = useState(false)
  const [ticketManageActionTicketId, setTicketManageActionTicketId] = useState<string | null>(null)
  const [ticketManageActionType, setTicketManageActionType] = useState<
    'book' | 'edit' | 'remove' | null
  >(null)
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false)
  const [announcementSendMode, setAnnouncementSendMode] = useState<'text' | 'voice' | null>(null)
  const [announcementText, setAnnouncementText] = useState('')
  const [lobbyAnnouncementTitle, setLobbyAnnouncementTitle] = useState('')
  const [lobbyAnnouncementContent, setLobbyAnnouncementContent] = useState('')
  const [lobbyAnnouncementVersion, setLobbyAnnouncementVersion] = useState<number | null>(null)
  const [lobbyAnnouncementActive, setLobbyAnnouncementActive] = useState(true)
  const [loadingLobbyAnnouncement, setLoadingLobbyAnnouncement] = useState(false)
  const [savingLobbyAnnouncement, setSavingLobbyAnnouncement] = useState(false)
  const [micSupported, setMicSupported] = useState<boolean>(() => Boolean(getSpeechRecognitionCtor()))
  const [micListening, setMicListening] = useState(false)
  const [voiceRecordingSupported, setVoiceRecordingSupported] = useState<boolean>(() =>
    supportsVoiceRecording(),
  )
  const [recordingVoiceAnnouncement, setRecordingVoiceAnnouncement] = useState(false)
  const [recordedVoiceAnnouncementBlob, setRecordedVoiceAnnouncementBlob] = useState<Blob | null>(null)
  const [recordedVoiceAnnouncementMimeType, setRecordedVoiceAnnouncementMimeType] = useState('')
  const [recordedVoiceAnnouncementUrl, setRecordedVoiceAnnouncementUrl] = useState('')
  const [showTicketCards, setShowTicketCards] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('housie_admin_sound_enabled') !== '0'
  })
  const [theme, setTheme] = useState(getActiveTheme())
  const [posterBackgroundKey, setPosterBackgroundKey] = useState<PosterBackgroundKey>(() =>
    resolveWallpaperTheme(getActiveTheme()),
  )

  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    gameName: '',
    gameDateTime: getCurrentDateTimeLocalValue(),
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
  const announcementRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const announcementVoiceRecorderRef = useRef<MediaRecorder | null>(null)
  const announcementVoiceStreamRef = useRef<MediaStream | null>(null)
  const announcementVoiceChunksRef = useRef<Blob[]>([])
  const recordedVoiceAnnouncementUrlRef = useRef('')
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

  const applyLobbyAnnouncementState = useCallback(
    (announcement: AdminLobbyAnnouncementResponse | null) => {
      if (!announcement) {
        setLobbyAnnouncementTitle('')
        setLobbyAnnouncementContent('')
        setLobbyAnnouncementVersion(null)
        setLobbyAnnouncementActive(true)
        return
      }
      setLobbyAnnouncementTitle(String(announcement.title ?? ''))
      setLobbyAnnouncementContent(String(announcement.content ?? ''))
      setLobbyAnnouncementVersion(
        typeof announcement.version === 'number' ? announcement.version : null,
      )
      setLobbyAnnouncementActive(Boolean(announcement.is_active))
    },
    [],
  )

  const clearRecordedVoiceAnnouncement = useCallback(() => {
    if (recordedVoiceAnnouncementUrl) {
      URL.revokeObjectURL(recordedVoiceAnnouncementUrl)
    }
    recordedVoiceAnnouncementUrlRef.current = ''
    setRecordedVoiceAnnouncementUrl('')
    setRecordedVoiceAnnouncementBlob(null)
    setRecordedVoiceAnnouncementMimeType('')
  }, [recordedVoiceAnnouncementUrl])

  const releaseVoiceRecorderResources = useCallback(() => {
    if (announcementVoiceStreamRef.current) {
      announcementVoiceStreamRef.current.getTracks().forEach((track) => {
        track.stop()
      })
      announcementVoiceStreamRef.current = null
    }
    announcementVoiceRecorderRef.current = null
    announcementVoiceChunksRef.current = []
  }, [])

  useEffect(() => {
    return subscribeThemeChange(({ theme: updatedTheme }) => {
      setTheme(updatedTheme)
    })
  }, [])

  const ticketSectionRef = useRef<HTMLElement | null>(null)
  const winnerSectionRef = useRef<HTMLElement | null>(null)
  const businessSectionRef = useRef<HTMLElement | null>(null)
  const gamesRef = useRef<AdminGameListItem[]>([])
  const activeGameIdRef = useRef<string>('')
  const gameStatusRef = useRef<string>('CREATED')
  const winnerPauseQueueRef = useRef<Promise<void>>(Promise.resolve())
  const winnerPauseProcessedRef = useRef<Set<string>>(new Set())
  const winnerPauseInitializedRef = useRef(false)

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
  } = useBingoCaller({ soundEnabled })
  const voiceMode = useVoiceModeStore((state) => state.mode)
  const setVoiceMode = useVoiceModeStore((state) => state.setMode)
  const voiceSpeed = useVoiceModeStore((state) => state.speed)
  const setVoiceSpeed = useVoiceModeStore((state) => state.setSpeed)
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
    if (typeof window === 'undefined') return
    window.localStorage.setItem('housie_admin_sound_enabled', soundEnabled ? '1' : '0')
  }, [soundEnabled])

  useEffect(() => {
    recordedVoiceAnnouncementUrlRef.current = recordedVoiceAnnouncementUrl
  }, [recordedVoiceAnnouncementUrl])

  useEffect(() => {
    setMicSupported(Boolean(getSpeechRecognitionCtor()))
    setVoiceRecordingSupported(supportsVoiceRecording())
    return () => {
      if (announcementRecognitionRef.current) {
        try {
          announcementRecognitionRef.current.stop()
        } catch {
          // ignore
        }
        announcementRecognitionRef.current = null
      }

      const recorder = announcementVoiceRecorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop()
          } catch {
            // ignore
          }
        }
      }
      releaseVoiceRecorderResources()

      if (recordedVoiceAnnouncementUrlRef.current) {
        URL.revokeObjectURL(recordedVoiceAnnouncementUrlRef.current)
        recordedVoiceAnnouncementUrlRef.current = ''
      }
    }
  }, [releaseVoiceRecorderResources])

  useEffect(() => {
    gamesRef.current = games
  }, [games])

  useEffect(() => {
    activeGameIdRef.current = gameId
  }, [gameId])

  useEffect(() => {
    const statusFromSummary = summary?.game.status
    if (typeof statusFromSummary === 'string' && statusFromSummary.length > 0) {
      gameStatusRef.current = statusFromSummary
      return
    }
    if (liveStatus === 'RUNNING' || liveStatus === 'FINISHED') {
      gameStatusRef.current = liveStatus
      return
    }
    gameStatusRef.current = 'CREATED'
  }, [liveStatus, summary?.game.status])

  useEffect(() => {
    winnerPauseProcessedRef.current.clear()
    winnerPauseInitializedRef.current = false
  }, [gameId])

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

      const selectedGame = gamesRef.current.find((item) => item.id === selectedGameId)
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
    [replaceFromBackendState, setTicketsFromBackend],
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
          setSettingsForm((state) => ({
            ...state,
            gameDateTime: getCurrentDateTimeLocalValue(),
          }))
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
    let mounted = true
    const loadLobbyAnnouncement = async () => {
      if (!gameId) {
        applyLobbyAnnouncementState(null)
        setLoadingLobbyAnnouncement(false)
        return
      }

      setLoadingLobbyAnnouncement(true)
      try {
        const payload = await getAdminLobbyAnnouncement(gameId)
        if (!mounted) return
        applyLobbyAnnouncementState(payload)
      } catch (loadError) {
        if (!mounted) return
        applyLobbyAnnouncementState(null)
        setActionMessage(`Unable to load lobby announcement: ${getErrorMessage(loadError)}`)
      } finally {
        if (mounted) {
          setLoadingLobbyAnnouncement(false)
        }
      }
    }

    void loadLobbyAnnouncement()
    return () => {
      mounted = false
    }
  }, [applyLobbyAnnouncementState, gameId])

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

    const handleGameRecreated = (event: unknown) => {
      const payload = (event as { data?: GameRecreatedSocketPayload }).data
      if (!payload || typeof payload !== 'object') return

      const oldGameId = typeof payload.old_game_id === 'string' ? payload.old_game_id : ''
      const newGamePayload =
        payload.new_game && typeof payload.new_game === 'object' ? payload.new_game : undefined
      const newGameId =
        typeof payload.new_game_id === 'string'
          ? payload.new_game_id
          : typeof newGamePayload?.id === 'string'
            ? newGamePayload.id
            : ''

      if (!newGameId) return

      if (newGamePayload) {
        setGames((current) => {
          const next = current.map((game) =>
            game.id === oldGameId
              ? {
                  ...game,
                  is_active: false,
                  is_current: false,
                  status: 'CANCELLED',
                }
              : game,
          )
          const existingIndex = next.findIndex((game) => game.id === newGameId)
          if (existingIndex >= 0) {
            next[existingIndex] = {
              ...next[existingIndex],
              ...newGamePayload,
            }
            return next
          }
          return [newGamePayload, ...next]
        })
      }

      setShowRecreateModal(false)
      setRecreateReason('')
      setActionMessage(
        typeof payload.reason === 'string' && payload.reason.trim()
          ? `Game has been updated. Reason: ${payload.reason.trim()}`
          : 'Game has been updated.',
      )

      setSummary(null)
      setBusiness(null)
      setPrizes([])
      setEditablePrizes([])
      setTickets([])
      setWinners([])
      setGameId(newGameId)
      void loadAll(newGameId)
    }

    const unsubGameRecreated = socketManager.subscribe('game_recreated', handleGameRecreated)

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
      unsubGameRecreated()
      unsubGameStarted()
      unsubGameFinished()
      unsubTicketsGenerated()
      unsubTicketBooked()
    }
  }, [gameId, loadAll, setTicketsFromBackend])

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

  useEffect(() => {
    if (!gameId) return

    if (!winnerPauseInitializedRef.current) {
      mergedWinners.forEach((winner) => {
        const winnerKey = winner.id
          ? `id:${winner.id}`
          : `fallback:${winner.prize_type}:${winner.ticket_number}:${winner.player_name ?? ''}`
        winnerPauseProcessedRef.current.add(winnerKey)
      })
      winnerPauseInitializedRef.current = true
      return
    }

    const pendingWinnerKeys: string[] = []
    const pendingWinners: Array<Partial<WinnerResponse>> = []
    mergedWinners.forEach((winner) => {
      const winnerKey = winner.id
        ? `id:${winner.id}`
        : `fallback:${winner.prize_type}:${winner.ticket_number}:${winner.player_name ?? ''}`
      if (winnerPauseProcessedRef.current.has(winnerKey)) return
      winnerPauseProcessedRef.current.add(winnerKey)
      pendingWinnerKeys.push(winnerKey)
      pendingWinners.push(winner)
    })

    if (pendingWinnerKeys.length === 0) return

    // Announce and store each pending winner via admin API (includes optional API key).
    // Fire-and-forget: failures should not block local UI flow.
    pendingWinners.forEach((winner) => {
      try {
        const prize = winner.prize_type
          ? PRIZE_LABEL_MAP[winner.prize_type] ?? winner.prize_type
          : 'Prize'
        const message = `Congratulations players. ${prize} prize has been won.`
        void announceGame(gameId, message).catch(() => undefined)
      } catch {
        // ignore
      }
    })

    pendingWinnerKeys.forEach(() => {
      const queuedGameId = gameId
      winnerPauseQueueRef.current = winnerPauseQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!queuedGameId) return
          if (activeGameIdRef.current !== queuedGameId) return
          if (gameStatusRef.current !== 'RUNNING') return

          try {
            await pauseGame(queuedGameId)
            gameStatusRef.current = 'PAUSED'
          } catch {
            return
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 3000)
          })

          if (activeGameIdRef.current !== queuedGameId) return
          if (gameStatusRef.current !== 'PAUSED') return

          try {
            await resumeGame(queuedGameId)
            gameStatusRef.current = 'RUNNING'
          } catch {
            return
          }
        })
    })
  }, [gameId, mergedWinners])

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
  const bookingActionsDisabled = running || finished
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

  // Listen for external booking events from modal and refresh tickets.
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ gameId?: string; ticket_numbers?: number[] }>
        if (!ce?.detail) return
        const eventGameId = ce.detail.gameId
        if (!eventGameId) return
        if (!gameId) return
        if (eventGameId !== gameId) return
        void refreshTicketsAndBusiness(gameId)
      } catch {
        // ignore
      }
    }
    window.addEventListener('admin:ticket:booked', handler as EventListener)
    return () => window.removeEventListener('admin:ticket:booked', handler as EventListener)
  }, [gameId, refreshTicketsAndBusiness])

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
    if (bookingActionsDisabled) {
      setActionMessage('Ticket booking actions are disabled while the game is running or finished.')
      return
    }
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
      const bookingResult = await bookTicketAsAdmin({
        game_id: gameId,
        ticket_number: ticket.ticket_number,
        booking_mode: 'RANDOM',
        player_name: assignment.playerName,
        player_phone: assignment.playerPhone,
      })
      await refreshTicketsAndBusiness(gameId)
      setSearchKeyword('')
      const privilegeLabel = bookingResult.eligible_privileges.full_sheet_bonus
        ? 'Full Sheet bonus eligible.'
        : bookingResult.eligible_privileges.half_sheet_bonus
          ? 'Half Sheet bonus eligible.'
          : 'Sheet bonus not enabled.'
      setActionMessage(`Ticket ${ticket.ticket_number} booked for ${assignment.playerName}. ${privilegeLabel}`)
    } catch (bookError) {
      setActionMessage(getErrorMessage(bookError))
    } finally {
      setTicketManageActionTicketId(null)
      setTicketManageActionType(null)
    }
  }

  const handleEditTicketAssignment = async (ticket: TicketResponse) => {
    if (!gameId) return
    if (bookingActionsDisabled) {
      setActionMessage('Ticket booking actions are disabled while the game is running or finished.')
      return
    }
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
    if (bookingActionsDisabled) {
      setActionMessage('Ticket booking actions are disabled while the game is running or finished.')
      return
    }
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
    if (bookingActionsDisabled) {
      setActionMessage('Ticket booking actions are disabled while the game is running or finished.')
      return
    }
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
    if (bookingActionsDisabled) {
      setActionMessage('Ticket booking actions are disabled while the game is running or finished.')
      return
    }
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

  const handleApproveAllPendingRequests = async () => {
    if (!gameId) return
    if (bookingActionsDisabled) {
      setActionMessage('Ticket booking actions are disabled while the game is running or finished.')
      return
    }
    if (bulkApproveInProgress) return

    const approvable = pendingTickets.filter((ticket) => Boolean(ticket.id))
    if (approvable.length === 0) {
      setActionMessage('No pending requests with valid ticket ids to approve.')
      return
    }

    const proceed = window.confirm(`Approve all ${approvable.length} pending ticket requests?`)
    if (!proceed) return

    setBulkApproveInProgress(true)
    setActionMessage('')

    let approvedCount = 0
    const failedTicketNumbers: number[] = []

    try {
      for (const ticket of approvable) {
        try {
          await confirmTicketRequest(ticket.id as string)
          approvedCount += 1
        } catch {
          failedTicketNumbers.push(ticket.ticket_number)
        }
      }

      await refreshTicketsAndBusiness(gameId)
      setSearchKeyword('')

      if (failedTicketNumbers.length === 0) {
        setActionMessage(`Approved ${approvedCount} pending ticket requests.`)
      } else {
        const preview = failedTicketNumbers.slice(0, 5).join(', ')
        const suffix = failedTicketNumbers.length > 5 ? '...' : ''
        setActionMessage(
          `Approved ${approvedCount}/${approvable.length}. Failed tickets: ${preview}${suffix}`,
        )
      }
    } catch (approveAllError) {
      setActionMessage(getErrorMessage(approveAllError))
    } finally {
      setBulkApproveInProgress(false)
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

  const handleSetCallingInterval = async () => {
    if (!gameId || !summary) return
    const nextInterval =
      Number.isFinite(callingInterval) && callingInterval > 0 ? Math.floor(callingInterval) : 10

    setSavingCallingInterval(true)
    setActionMessage('')
    try {
      const updatedGame = await saveGameSettings({
        ...buildSettingsPayload(nextInterval),
        game_id: gameId,
      })

      const updatedInterval =
        typeof (updatedGame as { calling_interval?: unknown })?.calling_interval === 'number' &&
        (updatedGame as { calling_interval: number }).calling_interval > 0
          ? Math.floor((updatedGame as { calling_interval: number }).calling_interval)
          : nextInterval

      setCallingInterval(updatedInterval)
      setSettingsForm((state) => ({ ...state, callingInterval: String(updatedInterval) }))
      setGames((current) =>
        current.map((game) =>
          game.id === gameId
            ? { ...game, ...updatedGame, calling_interval: updatedInterval }
            : game,
        ),
      )
      setSummary((previous) =>
        previous
          ? {
              ...previous,
              game: {
                ...previous.game,
                ...updatedGame,
                calling_interval: updatedInterval,
              },
            }
          : previous,
      )
      setActionMessage(`Calling interval set to ${updatedInterval}s.`)
    } catch (errorValue) {
      setActionMessage(getErrorMessage(errorValue))
    } finally {
      setSavingCallingInterval(false)
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
          enabled: true,
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
            enabled: true,
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

  const handleSaveLobbyAnnouncement = async (nextIsActive: boolean) => {
    if (!gameId) {
      setActionMessage('Select a game before saving lobby announcement.')
      return
    }

    const title = lobbyAnnouncementTitle.trim()
    const content = lobbyAnnouncementContent.trim()

    if (nextIsActive && (!title || !content)) {
      setActionMessage('Lobby announcement title and content are required.')
      return
    }
    if (!nextIsActive && lobbyAnnouncementVersion === null) {
      setActionMessage('No active lobby announcement to disable.')
      return
    }

    setSavingLobbyAnnouncement(true)
    setActionMessage('')
    try {
      const payload = await saveAdminLobbyAnnouncement(gameId, {
        title: title || 'Announcement',
        content: content || 'Announcement',
        is_active: nextIsActive,
      })
      applyLobbyAnnouncementState(payload)
      setActionMessage(
        nextIsActive
          ? `Lobby announcement saved. Version ${payload.version}.`
          : 'Lobby announcement disabled for this lobby.',
      )
    } catch (saveError) {
      setActionMessage(getErrorMessage(saveError))
    } finally {
      setSavingLobbyAnnouncement(false)
    }
  }

  const handleSendAnnouncement = async (mode: 'text' | 'voice' = 'text') => {
    const targetGameId = String(
      gameId || summary?.game.id || games.find((item) => item.is_current)?.id || '',
    ).trim()

    if (!targetGameId) {
      setActionMessage('Select a game before sending an announcement.')
      return
    }

    const message = announcementText.trim()
    const hasRecordedVoice =
      Boolean(recordedVoiceAnnouncementBlob) &&
      Number(recordedVoiceAnnouncementBlob?.size ?? 0) > 0

    if (mode === 'text' && !message) {
      setActionMessage('Announcement message cannot be empty for text send.')
      return
    }

    if (mode === 'voice' && !message && !hasRecordedVoice) {
      setActionMessage('Enter announcement text or record your real voice before sending.')
      return
    }

    if (recordingVoiceAnnouncement) {
      setActionMessage('Stop voice recording before sending the announcement.')
      return
    }

    if (micListening && announcementRecognitionRef.current) {
      try {
        announcementRecognitionRef.current.stop()
      } catch {
        // ignore
      }
      setMicListening(false)
    }

    setSendingAnnouncement(true)
    setAnnouncementSendMode(mode)
    setActionMessage('')
    try {
      const useRecordedVoice = mode === 'voice' && hasRecordedVoice
      const outgoingMessage =
        mode === 'voice' && !useRecordedVoice
          ? encodeVoiceAnnouncement(message)
          : message
      const audioFileName = useRecordedVoice
        ? `announcement-${Date.now()}.${getVoiceRecordingExtension(recordedVoiceAnnouncementMimeType)}`
        : undefined

      await announceGame(
        targetGameId,
        outgoingMessage,
        useRecordedVoice
          ? {
              audioClip: recordedVoiceAnnouncementBlob as Blob,
              audioFileName,
            }
          : undefined,
      )
      setAnnouncementText('')
      if (useRecordedVoice) {
        clearRecordedVoiceAnnouncement()
      }
      setActionMessage(
        useRecordedVoice
          ? 'Real voice announcement sent to connected players.'
          : mode === 'voice'
            ? 'Voice announcement sent to connected players.'
            : 'Announcement sent to connected players.',
      )
    } catch (sendError) {
      setActionMessage(getErrorMessage(sendError))
    } finally {
      setSendingAnnouncement(false)
      setAnnouncementSendMode(null)
    }
  }

  const handleToggleVoiceRecording = async () => {
    if (!voiceRecordingSupported) {
      setActionMessage('Voice recording is not supported in this browser.')
      return
    }

    if (recordingVoiceAnnouncement) {
      const recorder = announcementVoiceRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          releaseVoiceRecorderResources()
          setRecordingVoiceAnnouncement(false)
        }
      } else {
        releaseVoiceRecorderResources()
        setRecordingVoiceAnnouncement(false)
      }
      return
    }

    if (micListening && announcementRecognitionRef.current) {
      try {
        announcementRecognitionRef.current.stop()
      } catch {
        // ignore
      }
      setMicListening(false)
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = resolveVoiceRecorderMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      clearRecordedVoiceAnnouncement()
      announcementVoiceChunksRef.current = []
      announcementVoiceStreamRef.current = stream
      announcementVoiceRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          announcementVoiceChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        releaseVoiceRecorderResources()
        setRecordingVoiceAnnouncement(false)
        setActionMessage('Unable to capture voice recording.')
      }

      recorder.onstop = () => {
        const chunks = [...announcementVoiceChunksRef.current]
        releaseVoiceRecorderResources()
        setRecordingVoiceAnnouncement(false)

        if (chunks.length === 0) {
          setActionMessage('No voice recorded. Please try again.')
          return
        }

        const fallbackType = mimeType || recorder.mimeType || 'audio/webm'
        const recordedBlob = new Blob(chunks, {
          type: chunks[0]?.type || fallbackType,
        })
        if (!recordedBlob.size) {
          setActionMessage('No voice recorded. Please try again.')
          return
        }

        const objectUrl = URL.createObjectURL(recordedBlob)
        recordedVoiceAnnouncementUrlRef.current = objectUrl
        setRecordedVoiceAnnouncementBlob(recordedBlob)
        setRecordedVoiceAnnouncementMimeType(recordedBlob.type || fallbackType)
        setRecordedVoiceAnnouncementUrl(objectUrl)
        setActionMessage('Voice recording captured. You can now send your real voice.')
      }

      recorder.start(250)
      setRecordingVoiceAnnouncement(true)
      setActionMessage('Recording real voice announcement...')
    } catch {
      releaseVoiceRecorderResources()
      setRecordingVoiceAnnouncement(false)
      setActionMessage('Unable to access microphone for recording. Check permissions and try again.')
    }
  }

  const handleClearRecordedVoice = () => {
    if (recordingVoiceAnnouncement) {
      const recorder = announcementVoiceRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null
        recorder.onerror = null
        recorder.onstop = null
        try {
          recorder.stop()
        } catch {
          // ignore
        }
      }
      releaseVoiceRecorderResources()
      setRecordingVoiceAnnouncement(false)
    }
    clearRecordedVoiceAnnouncement()
  }

  const handleToggleAnnouncementMic = () => {
    if (!micSupported) {
      setActionMessage('Microphone input is not supported in this browser.')
      return
    }

    if (recordingVoiceAnnouncement) {
      setActionMessage('Stop voice recording before using speech-to-text.')
      return
    }

    if (micListening) {
      try {
        announcementRecognitionRef.current?.stop()
      } catch {
        // ignore
      }
      setMicListening(false)
      return
    }

    const RecognitionCtor = getSpeechRecognitionCtor()
    if (!RecognitionCtor) {
      setMicSupported(false)
      setActionMessage('Microphone input is not supported in this browser.')
      return
    }

    const recognition = announcementRecognitionRef.current ?? new RecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-IN'
    recognition.onresult = (event) => {
      const results = event.results
      let transcript = ''
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]
        if (!result?.isFinal) continue
        const chunk = String(result[0]?.transcript ?? '').trim()
        if (!chunk) continue
        transcript = `${transcript}${transcript ? ' ' : ''}${chunk}`
      }
      if (!transcript) return
      setAnnouncementText((previous) => {
        const merged = `${previous.trim()} ${transcript}`.trim()
        return merged.slice(0, 1000)
      })
    }
    recognition.onerror = (event) => {
      const errorCode = String(event.error ?? '').trim()
      if (errorCode && errorCode !== 'no-speech') {
        setActionMessage(`Microphone error: ${errorCode}.`)
      }
      setMicListening(false)
    }
    recognition.onend = () => {
      setMicListening(false)
    }

    announcementRecognitionRef.current = recognition

    try {
      recognition.start()
      setMicListening(true)
      setActionMessage('')
    } catch {
      setMicListening(false)
      setActionMessage('Unable to start microphone input. Check mic permission and try again.')
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
        const intervalFromSummary =
          Number.isFinite(callingInterval) && callingInterval > 0
            ? Math.floor(callingInterval)
            : typeof summary.game.calling_interval === 'number' && summary.game.calling_interval > 0
              ? summary.game.calling_interval
              : 10
        await startGame(gameId, intervalFromSummary)
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
      gameDateTime: getCurrentDateTimeLocalValue(),
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

  const handleOpenRecreateModal = () => {
    if (!gameId || !summary) {
      setActionMessage('Select a game before recreating.')
      return
    }
    setRecreateReason('')
    setShowRecreateModal(true)
  }

  const handleCloseRecreateModal = () => {
    if (recreateInProgress) return
    setShowRecreateModal(false)
  }

  const handleRecreateCurrentGame = async () => {
    if (!gameId || !summary) return

    const reason = recreateReason.trim()
    if (!reason) {
      setActionMessage('Recreate reason is required.')
      return
    }

    setRecreateInProgress(true)
    setActionMessage('')
    try {
      const recreated = await recreateGame(gameId, {
        reason,
        updated_fields: {
          ...buildSettingsPayload(),
        },
      })

      setGames((current) => {
        const next = current.map((game) =>
          game.id === gameId
            ? {
                ...game,
                is_active: false,
                is_current: false,
                status: 'CANCELLED',
              }
            : game,
        )
        const existingIndex = next.findIndex((game) => game.id === recreated.id)
        if (existingIndex >= 0) {
          next[existingIndex] = { ...next[existingIndex], ...recreated }
          return next
        }
        return [recreated, ...next]
      })

      setShowRecreateModal(false)
      setRecreateReason('')
      setGameId(recreated.id)
      await loadAll(recreated.id)
      setActionMessage(
        `Game recreated successfully${typeof recreated.version === 'number' ? ` (v${recreated.version})` : ''}.`,
      )
    } catch (recreateError) {
      setActionMessage(getErrorMessage(recreateError))
    } finally {
      setRecreateInProgress(false)
    }
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
          {!isSetupMode && Boolean(gameId) && Boolean(summary) && (
            <button
              type="button"
              className="secondary-btn recreate-btn"
              onClick={handleOpenRecreateModal}
              disabled={recreateInProgress}
            >
              Recreate Game
            </button>
          )}
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

      {/* Floating booking button for quick admin booking */}
      <FloatingBookButton gameId={gameId} />

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
          Send a live message to all connected players. Use prefixes like [warning], [success], [danger]
          for style. Use voice send when you want players to hear your message.
        </p>
        <div className="announcement-form">
          <textarea
            value={announcementText}
            onChange={(event) => setAnnouncementText(event.target.value)}
            placeholder="Example: Game will resume in 2 minutes."
            rows={3}
            maxLength={1000}
          />
          <div className="announcement-recording-row">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleToggleVoiceRecording()}
              disabled={sendingAnnouncement || !voiceRecordingSupported}
            >
              {!voiceRecordingSupported
                ? 'Voice Recorder Unsupported'
                : recordingVoiceAnnouncement
                  ? 'Stop Recording'
                  : 'Record Real Voice'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={handleClearRecordedVoice}
              disabled={sendingAnnouncement || (!recordedVoiceAnnouncementBlob && !recordingVoiceAnnouncement)}
            >
              Clear Recording
            </button>
            <span className="announcement-recording-status">
              {recordingVoiceAnnouncement
                ? 'Recording...'
                : recordedVoiceAnnouncementBlob
                  ? 'Voice clip ready'
                  : 'No voice clip'}
            </span>
          </div>
          {recordedVoiceAnnouncementUrl && (
            <div className="announcement-recording-preview">
              <audio
                controls
                src={recordedVoiceAnnouncementUrl}
                preload="metadata"
              />
            </div>
          )}
          <div className="announcement-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={handleToggleAnnouncementMic}
              disabled={sendingAnnouncement || !micSupported}
            >
              {!micSupported ? 'Mic Not Supported' : micListening ? 'Stop Mic' : 'Use Mic'}
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => void handleSendAnnouncement('text')}
              disabled={sendingAnnouncement || !announcementText.trim()}
            >
              {sendingAnnouncement && announcementSendMode === 'text' ? 'Sending...' : 'Send Text Announcement'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleSendAnnouncement('voice')}
              disabled={
                sendingAnnouncement ||
                recordingVoiceAnnouncement ||
                (!announcementText.trim() && !recordedVoiceAnnouncementBlob)
              }
            >
              {sendingAnnouncement && announcementSendMode === 'voice'
                ? 'Sending...'
                : recordedVoiceAnnouncementBlob
                  ? 'Send Real Voice Announcement'
                  : 'Send Voice Announcement'}
            </button>
          </div>
          {micListening && <p className="announcement-mic-hint">Listening... speak now.</p>}
          {recordingVoiceAnnouncement && (
            <p className="announcement-mic-hint">Recording... speak your announcement now.</p>
          )}
        </div>
      </section>

      <section className="admin-card">
        <h2>Lobby Entry Announcement</h2>
        <p className="announcement-help">
          Shown as a mandatory accept modal for this selected lobby. Users see it once per version, then
          must re-accept only when you update content.
        </p>
        <div className="lobby-announcement-editor">
          <div className="lobby-announcement-meta">
            <span>
              Status:{' '}
              {loadingLobbyAnnouncement
                ? 'Loading...'
                : lobbyAnnouncementVersion === null
                  ? 'Not configured'
                  : lobbyAnnouncementActive
                    ? 'Active'
                    : 'Disabled'}
            </span>
            <span>Version: {lobbyAnnouncementVersion ?? '-'}</span>
          </div>
          <label className="lobby-announcement-field">
            Title
            <input
              type="text"
              value={lobbyAnnouncementTitle}
              onChange={(event) => setLobbyAnnouncementTitle(event.target.value)}
              maxLength={255}
              placeholder="Example: Important Lobby Notice"
              disabled={loadingLobbyAnnouncement || savingLobbyAnnouncement || !gameId}
            />
          </label>
          <label className="lobby-announcement-field">
            Content
            <textarea
              value={lobbyAnnouncementContent}
              onChange={(event) => setLobbyAnnouncementContent(event.target.value)}
              rows={6}
              maxLength={10000}
              placeholder="Write the mandatory notice users must accept before entering this lobby."
              disabled={loadingLobbyAnnouncement || savingLobbyAnnouncement || !gameId}
            />
          </label>
          <div className="announcement-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={() => void handleSaveLobbyAnnouncement(true)}
              disabled={loadingLobbyAnnouncement || savingLobbyAnnouncement || !gameId}
            >
              {savingLobbyAnnouncement ? 'Saving...' : 'Save Lobby Announcement'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleSaveLobbyAnnouncement(false)}
              disabled={
                loadingLobbyAnnouncement ||
                savingLobbyAnnouncement ||
                !gameId ||
                lobbyAnnouncementVersion === null
              }
            >
              {savingLobbyAnnouncement ? 'Saving...' : 'Disable Lobby Announcement'}
            </button>
          </div>
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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {editablePrizes.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{prizeTypesLoading ? 'Loading prize types...' : 'No prize types found.'}</td>
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
                                      enabled: event.target.checked,
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
                onChange={(event) => {
                  const nextMode = event.target.value as VoiceMode
                  setVoiceMode(nextMode)
                  if (!gameId) return
                  socketManager.send({
                    type: 'voice_mode_update',
                    voice_mode: nextMode,
                  })
                }}
              >
                {VOICE_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                id="admin-voice-speed"
                aria-label="Voice speed"
                value={String(voiceSpeed)}
                onChange={(event) => {
                  const nextSpeed = Number.parseFloat(event.target.value)
                  if (!Number.isFinite(nextSpeed)) return
                  setVoiceSpeed(nextSpeed)
                  if (!gameId) return
                  socketManager.send({
                    type: 'voice_speed_update',
                    voice_speed: nextSpeed,
                  })
                }}
              >
                {VOICE_SPEED_OPTIONS.map((option) => (
                  <option key={option.value} value={String(option.value)}>
                    Speed {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondary-btn voice-unlock-btn"
                onClick={() =>
                  setSoundEnabled((previous) => {
                    const next = !previous
                    if (next) {
                      void unlockAudio()
                    }
                    return next
                  })
                }
              >
                Sound: {soundEnabled ? 'ON' : 'OFF'}
              </button>
              {soundEnabled && isSpeechSupported && (!isAudioReady || Boolean(audioBlockedMessage)) && (
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
              <div className="calling-interval-control">
                <select
                  value={String(callingInterval)}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (!Number.isFinite(next) || next <= 0) return
                    const safe = Math.floor(next)
                    setCallingInterval(safe)
                    setSettingsForm((state) => ({ ...state, callingInterval: String(safe) }))
                  }}
                  disabled={!gameId || !summary || finished || savingCallingInterval}
                >
                  {[2, 3, 4, 5, 7, 10, 12, 15, 20].map((option) => (
                    <option key={option} value={option}>
                      {option}s
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void handleSetCallingInterval()}
                  disabled={!gameId || !summary || finished || savingCallingInterval}
                >
                  {savingCallingInterval ? 'Setting...' : 'Set'}
                </button>
              </div>
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
              <div className="pending-requests-head-main">
                <strong>Pending ticket requests</strong>
                <span>{pendingTickets.length}</span>
              </div>
              <button
                type="button"
                className="approve-btn pending-approve-all-btn"
                onClick={() => void handleApproveAllPendingRequests()}
                disabled={
                  pendingTickets.length === 0 || bookingActionsDisabled || bulkApproveInProgress
                }
              >
                {bulkApproveInProgress ? 'Approving all...' : 'Approve all'}
              </button>
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
                                disabled={
                                  !ticket.id ||
                                  approving ||
                                  rejecting ||
                                  bookingActionsDisabled ||
                                  bulkApproveInProgress
                                }
                              >
                                {approving ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                className="reject-btn"
                                onClick={() => void handleRejectPendingRequest(ticket)}
                                disabled={
                                  !ticket.id ||
                                  approving ||
                                  rejecting ||
                                  bookingActionsDisabled ||
                                  bulkApproveInProgress
                                }
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
            <TambolaTicketGrid className="admin-ticket-grid">
              {filteredTickets.map((ticket) => (
                <TambolaTicketCard
                  key={ticket.ticket_number}
                  ticket={ticket}
                />
              ))}
            </TambolaTicketGrid>
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
                                disabled={rowActionBusy || bookingActionsDisabled}
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
                                    disabled={!ticket.id || rowActionBusy || bookingActionsDisabled}
                                  >
                                    {approving ? 'Approving...' : 'Approve'}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="approve-btn"
                                  onClick={() => void handleEditTicketAssignment(ticket)}
                                  disabled={!ticket.id || rowActionBusy || bookingActionsDisabled}
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
                                  disabled={!ticket.id || rowActionBusy || bookingActionsDisabled}
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

      {showRecreateModal && (
        <div className="admin-modal-backdrop" onClick={handleCloseRecreateModal}>
          <section
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Recreate game"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Recreate Game</h3>
            <p>
              This will cancel the current game version and create a corrected new version using
              your current Game Settings values.
            </p>
            <label htmlFor="recreate-reason">Reason</label>
            <textarea
              id="recreate-reason"
              value={recreateReason}
              onChange={(event) => setRecreateReason(event.target.value)}
              placeholder="Correction needed"
              maxLength={1000}
              disabled={recreateInProgress}
            />
            <div className="admin-modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={handleCloseRecreateModal}
                disabled={recreateInProgress}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleRecreateCurrentGame()}
                disabled={recreateInProgress || !recreateReason.trim()}
              >
                {recreateInProgress ? 'Recreating...' : 'Recreate Game'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default AdminDashboard
