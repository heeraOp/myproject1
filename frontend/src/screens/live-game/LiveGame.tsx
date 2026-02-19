import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import AnnouncementBanner from '@/components/common/AnnouncementBanner'
import Leaderboard, { type LeaderboardEntry } from '@/components/common/Leaderboard'
import WinnerPopup from '@/components/common/WinnerPopup'
import { fetchCurrentPublicGame } from '@/api/rest/games'
import { fetchGameTickets } from '@/api/rest/tickets'
import {
  fetchGameState,
  fetchGameSummary,
  fetchPrizes,
  fetchWinners,
  type PublicGameSummary,
  type PublicPrize,
  type PublicWinner,
} from '@/api/rest/gamePublic'
import { socketManager } from '@/api/websocket/socketManager'
import { useGameSocket } from '@/app/hooks/useGameSocket'
import { useBingoCaller } from '@/app/hooks/useBingoCaller'
import { useGameStore } from '@/app/store/game.store'
import type { PublicGame } from '@/types/backend/game'
import type { PlayerTicket } from '@/types/backend/ticket'
import {
  formatThemeLabel,
  getActiveTheme,
  isAdminThemeActive,
  setAdminTheme,
  subscribeThemeChange,
  toggleTheme,
} from '@/utils/theme'
import { formatDateTimeInIST } from '@/utils/dateTime'
import { playWinnerSoundFlow } from '@/utils/speakText'
import './LiveGame.css'

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

const dedupeWinners = (winners: Array<PublicWinner>) => {
  const seen = new Set<string>()
  return winners.filter((winner) => {
    const key = winner.id ? `id:${winner.id}` : `${winner.prize_type}:${winner.ticket_number}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const areLeaderboardEntriesEqual = (
  previous: LeaderboardEntry[],
  next: LeaderboardEntry[],
): boolean => {
  if (previous === next) return true
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index]
    const right = next[index]
    if (!right) return false
    if (
      left.user_id !== right.user_id ||
      left.username !== right.username ||
      left.total_marked !== right.total_marked ||
      left.remaining_for_full_house !== right.remaining_for_full_house ||
      left.remaining_for_half_seat !== right.remaining_for_half_seat
    ) {
      return false
    }
  }
  return true
}

const LiveTicketGrid = memo(
  function LiveTicketGrid({
    tickets,
    bookingClosed,
  }: {
    tickets: PlayerTicket[]
    bookingClosed: boolean
  }) {
    if (tickets.length === 0) {
      return <div className="live-empty">No tickets available.</div>
    }

    return (
      <div className="live-ticket-list">
        {tickets.map((ticket) => (
          <TambolaTicketCard
            key={ticket.ticket_number}
            ticket={ticket}
            variant="player"
            bookingClosed={bookingClosed}
          />
        ))}
      </div>
    )
  },
  (previous, next) =>
    previous.tickets === next.tickets &&
    previous.bookingClosed === next.bookingClosed,
)

const LiveGame = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Optional: mark owned tickets without exposing other players (phone passed via URL).
  const playerPhone = searchParams.get('playerPhone') ?? undefined
  const [games, setGames] = useState<PublicGame[]>([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [summary, setSummary] = useState<PublicGameSummary | null>(null)
  const [tickets, setTickets] = useState<PlayerTicket[]>([])
  const [prizes, setPrizes] = useState<PublicPrize[]>([])
  const [historyWinners, setHistoryWinners] = useState<PublicWinner[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [winnerPopup, setWinnerPopup] = useState<{
    visible: boolean
    winnerName: string
    prizeType: string
  }>({
    visible: false,
    winnerName: '',
    prizeType: '',
  })
  const [isNumberUiFrozen, setIsNumberUiFrozen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [soundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('housie_player_sound_enabled') !== '0'
  })
  const [theme, setTheme] = useState(getActiveTheme())
  const [isThemeLocked, setIsThemeLocked] = useState(isAdminThemeActive())
  const currentGameIdRef = useRef<string>('')
  const loadRequestRef = useRef(0)
  const ticketRefreshRequestRef = useRef(0)
  const currentNumberRef = useRef<number | null>(null)
  const calledNumbersRef = useRef<number[]>([])
  const winnerFreezeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const announcedWinnerKeysRef = useRef<Set<string>>(new Set())
  const winnerQueueProcessingRef = useRef(false)
  const frozenDisplayRef = useRef<{
    currentNumber: number | null
    calledNumbers: number[]
  }>({
    currentNumber: null,
    calledNumbers: [],
  })

  const handleThemeToggle = () => {
    if (isThemeLocked) return
    setTheme(toggleTheme())
  }

  const {
    gameId: storeGameId,
    status: liveStatus,
    currentNumber,
    calledNumbers,
    tickets: liveTickets,
    winners: liveWinners,
    lockedPrizeTypes,
    replaceFromBackendState,
    setTicketsFromBackend,
    clearWinnerQueue,
    winnerQueue,
    dismissWinnerAnnouncement,
    setActiveTheme,
  } = useGameStore((state) => state)
  const {
    announcement: bingoAnnouncement,
    audioBlockedMessage,
  } = useBingoCaller({ soundEnabled })

  useEffect(() => {
    return subscribeThemeChange(({ theme: updatedTheme, isLocked }) => {
      setTheme(updatedTheme)
      setIsThemeLocked(isLocked)
    })
  }, [])

  useEffect(() => {
    currentNumberRef.current = currentNumber
    calledNumbersRef.current = calledNumbers
  }, [calledNumbers, currentNumber])

  useEffect(() => {
    return () => {
      if (winnerFreezeTimerRef.current) {
        window.clearTimeout(winnerFreezeTimerRef.current)
        winnerFreezeTimerRef.current = null
      }
    }
  }, [])

  useGameSocket(selectedGameId || undefined)

  const handleWinnerAnnouncement = useCallback(async (winnerName: string, prizeType: string) => {
    const normalizedWinnerName = winnerName.trim() || 'Player'
    const normalizedPrizeType = prizeType.trim() || 'Prize'
    const prizeLabel = PRIZE_LABEL_MAP[normalizedPrizeType] ?? normalizedPrizeType
    const announcement = `Congratulations ${normalizedWinnerName}! You won ${prizeLabel}.`
    const soundPromise = soundEnabled
      ? playWinnerSoundFlow(announcement, 'dramatic').catch(() => undefined)
      : Promise.resolve()

    if (winnerFreezeTimerRef.current) {
      window.clearTimeout(winnerFreezeTimerRef.current)
      winnerFreezeTimerRef.current = null
    }

    frozenDisplayRef.current = {
      currentNumber: currentNumberRef.current,
      calledNumbers: calledNumbersRef.current,
    }
    setIsNumberUiFrozen(true)
    setWinnerPopup({
      visible: true,
      winnerName: normalizedWinnerName,
      prizeType: normalizedPrizeType,
    })

    await new Promise<void>((resolve) => {
      winnerFreezeTimerRef.current = window.setTimeout(() => {
        setIsNumberUiFrozen(false)
        setWinnerPopup((previous) => ({ ...previous, visible: false }))
        winnerFreezeTimerRef.current = null
        resolve()
      }, 3000)
    })

    await soundPromise
  }, [soundEnabled])

  useEffect(() => {
    let mounted = true
    const hydrateGames = async () => {
      try {
        const currentGame = await fetchCurrentPublicGame()
        if (!mounted) return
        if (!currentGame) {
          setGames([])
          setSelectedGameId('')
          return
        }
        if (currentGame.active_theme) {
          setAdminTheme(currentGame.active_theme)
        }
        setActiveTheme(currentGame.active_theme ?? null)
        // Public side should only ever see the backend-active game.
        setGames([currentGame])
        setSelectedGameId(currentGame.id)
      } catch {
        if (!mounted) return
        setError('Unable to load game list.')
      }
    }

    void hydrateGames()
    return () => {
      mounted = false
    }
  }, [setActiveTheme])

  const loadGameData = useCallback(async (gameId: string) => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const [summaryData, stateData, prizesData, ticketsData, winnersData] = await Promise.all([
        fetchGameSummary(gameId),
        fetchGameState(gameId),
        fetchPrizes(gameId),
        fetchGameTickets(gameId, playerPhone),
        fetchWinners(gameId),
      ])
      if (loadRequestRef.current !== requestId) return
      if (currentGameIdRef.current !== gameId) return

      setSummary(summaryData)
      setPrizes(prizesData)
      replaceFromBackendState(stateData)
      setTicketsFromBackend(gameId, ticketsData)
      setTickets(ticketsData)
      setHistoryWinners(dedupeWinners(winnersData))
    } catch {
      if (loadRequestRef.current !== requestId) return
      if (currentGameIdRef.current !== gameId) return
      setError('Unable to load live game state.')
    } finally {
      if (loadRequestRef.current !== requestId) return
      if (currentGameIdRef.current !== gameId) return
      setLoading(false)
    }
  }, [playerPhone, replaceFromBackendState, setTicketsFromBackend])

  const refreshTicketsForGame = useCallback(
    async (gameId: string) => {
      const requestId = ticketRefreshRequestRef.current + 1
      ticketRefreshRequestRef.current = requestId
      try {
        const latestTickets = await fetchGameTickets(gameId, playerPhone)
        if (ticketRefreshRequestRef.current !== requestId) return
        if (currentGameIdRef.current !== gameId) return
        setTicketsFromBackend(gameId, latestTickets)
        setTickets(latestTickets)
      } catch {
        return
      }
    },
    [playerPhone, setTicketsFromBackend],
  )

  useEffect(() => {
    currentGameIdRef.current = selectedGameId
    loadRequestRef.current += 1
    ticketRefreshRequestRef.current += 1

    if (!selectedGameId) {
      winnerQueueProcessingRef.current = false
      announcedWinnerKeysRef.current.clear()
      setTickets([])
      setHistoryWinners([])
      setLeaderboard([])
      setWinnerPopup({ visible: false, winnerName: '', prizeType: '' })
      setIsNumberUiFrozen(false)
      setSummary(null)
      setPrizes([])
      setLoading(false)
      return
    }

    setTickets([])
    setHistoryWinners([])
    setLeaderboard([])
    announcedWinnerKeysRef.current.clear()
    winnerQueueProcessingRef.current = false
    setWinnerPopup({ visible: false, winnerName: '', prizeType: '' })
    setIsNumberUiFrozen(false)
    setTicketsFromBackend(selectedGameId, [])
    clearWinnerQueue()
    void loadGameData(selectedGameId)
  }, [clearWinnerQueue, loadGameData, selectedGameId, setTicketsFromBackend])

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
      setSelectedGameId(nextGameId)
      setSummary(null)
      setPrizes([])
      setTickets([])
      setHistoryWinners([])
      setTicketsFromBackend(nextGameId, [])
      clearWinnerQueue()
    })

    const unsubTicketsGenerated = socketManager.subscribe('tickets_generated', async (event: unknown) => {
      const payload = (event as { data?: { game_id?: string } }).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !currentGameIdRef.current || eventGameId !== currentGameIdRef.current) return
      await refreshTicketsForGame(eventGameId)
    })

    const unsubTicketBooked = socketManager.subscribe('ticket_booked', async (event: unknown) => {
      const payload = (
        event as {
          data?: {
            game_id?: string
            ticket_id?: string
            status?: string
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

      await refreshTicketsForGame(eventGameId)
    })

    const unsubLeaderboardUpdate = socketManager.subscribe('LEADERBOARD_UPDATE', (event: unknown) => {
      const payload = event as { data?: unknown }
      const rows = Array.isArray(payload.data) ? payload.data : []
      const nextEntries: LeaderboardEntry[] = rows
        .map((row) => {
          const item = row as Record<string, unknown>
          return {
            user_id: String(item.user_id ?? ''),
            username: String(item.username ?? 'Player'),
            total_marked: Number(item.total_marked ?? 0),
            remaining_for_full_house: Number(item.remaining_for_full_house ?? 0),
            remaining_for_half_seat: Number(item.remaining_for_half_seat ?? 0),
          }
        })
        .filter((entry) => entry.user_id || entry.username)

      setLeaderboard((previous) => (areLeaderboardEntriesEqual(previous, nextEntries) ? previous : nextEntries))
    })

    return () => {
      unsubNewGame()
      unsubTicketsGenerated()
      unsubTicketBooked()
      unsubLeaderboardUpdate()
    }
  }, [clearWinnerQueue, refreshTicketsForGame, setActiveTheme, setTicketsFromBackend])

  useEffect(() => {
    const activeWinner = winnerQueue[0]
    if (!activeWinner || winnerQueueProcessingRef.current) return

    const winnerName = String(activeWinner.winner_name ?? '').trim()
    const prizeType = String(activeWinner.prize_name ?? '').trim()
    if (!winnerName || !prizeType) {
      dismissWinnerAnnouncement()
      return
    }

    const winnerKey = activeWinner.id || `${winnerName.toLowerCase()}::${prizeType.toUpperCase()}`
    if (announcedWinnerKeysRef.current.has(winnerKey)) {
      dismissWinnerAnnouncement()
      return
    }
    announcedWinnerKeysRef.current.add(winnerKey)

    winnerQueueProcessingRef.current = true
    void (async () => {
      try {
        await handleWinnerAnnouncement(winnerName, prizeType)
      } finally {
        dismissWinnerAnnouncement()
        winnerQueueProcessingRef.current = false
      }
    })()
  }, [dismissWinnerAnnouncement, handleWinnerAnnouncement, winnerQueue])

  useEffect(() => {
    if (!selectedGameId || storeGameId !== selectedGameId) return
    setTickets(liveTickets as PlayerTicket[])
  }, [liveTickets, selectedGameId, storeGameId])

  useEffect(() => {
    if (!selectedGameId || storeGameId !== selectedGameId) return
    if (liveStatus !== 'FINISHED' && calledNumbers.length < 90) return

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
        if (game.id !== selectedGameId || game.status === 'FINISHED') return game
        changed = true
        return {
          ...game,
          status: 'FINISHED' as PublicGame['status'],
        }
      })
      return changed ? next : previous
    })
  }, [calledNumbers.length, liveStatus, selectedGameId, storeGameId])

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId],
  )

  const mergedWinners = useMemo(() => {
    const wsWinners: PublicWinner[] = liveWinners.map((winner) => ({
      id: winner.id,
      prize_type: winner.prize_type,
      prize_amount: winner.prize_amount ?? 0,
      ticket_number: winner.ticket_number,
      player_name: winner.player_name ?? null,
      won_at: winner.won_at ?? new Date().toISOString(),
    }))
    return dedupeWinners([...historyWinners, ...wsWinners])
  }, [historyWinners, liveWinners])

  const orderedPrizes = useMemo(
    () =>
      [...prizes].sort((a, b) => {
        const aLabel = PRIZE_LABEL_MAP[a.prize_type] ?? a.prize_type
        const bLabel = PRIZE_LABEL_MAP[b.prize_type] ?? b.prize_type
        return aLabel.localeCompare(bLabel)
      }),
    [prizes],
  )

  const effectiveStatus = useMemo(() => {
    if (liveStatus === 'FINISHED') return 'FINISHED'
    if (summary?.game.status === 'FINISHED') return 'FINISHED'
    if (liveStatus === 'RUNNING') return 'RUNNING'
    if (summary?.game.status) return summary.game.status
    return 'CREATED'
  }, [liveStatus, summary?.game.status])
  const isBookingClosed = useMemo(() => {
    const gameStatus = summary?.game.status ?? selectedGame?.status ?? null
    const bookingStatus = summary?.game.booking_status ?? selectedGame?.booking_status ?? null
    return (
      effectiveStatus === 'FINISHED' ||
      effectiveStatus === 'ENDED' ||
      gameStatus === 'FINISHED' ||
      gameStatus === 'ENDED' ||
      bookingStatus === 'CLOSED'
    )
  }, [
    effectiveStatus,
    selectedGame?.booking_status,
    selectedGame?.status,
    summary?.game.booking_status,
    summary?.game.status,
  ])

  const displayCalledNumbers = isNumberUiFrozen ? frozenDisplayRef.current.calledNumbers : calledNumbers
  const displayCurrentNumber = isNumberUiFrozen ? frozenDisplayRef.current.currentNumber : currentNumber
  const calledSet = useMemo(() => new Set(displayCalledNumbers), [displayCalledNumbers])

  const lockedPrizeSet = useMemo(() => {
    const set = new Set<string>(lockedPrizeTypes)
    prizes.forEach((prize) => {
      if (prize.claimed) set.add(prize.prize_type)
    })
    return set
  }, [lockedPrizeTypes, prizes])

  const goToFinished = () => {
    if (!selectedGameId) return
    navigate(`/finished?gameId=${selectedGameId}`)
  }

  return (
    <main className="live-shell">
      <AnnouncementBanner gameId={selectedGameId || undefined} enableSound={soundEnabled} />
      <WinnerPopup
        visible={winnerPopup.visible}
        winnerName={winnerPopup.winnerName}
        prizeType={winnerPopup.prizeType}
        enableSound={soundEnabled}
      />
      <section className="live-header-card">
        <div className="live-header-top">
          <h1>{selectedGame?.name || summary?.game.name || 'Live Tambola'}</h1>
          <div className="live-header-actions">
            <button type="button" className="ghost-btn" onClick={() => navigate('/')}>
              Lobby
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={handleThemeToggle}
              disabled={isThemeLocked}
            >
              Theme: {formatThemeLabel(theme)}
            </button>
            {effectiveStatus === 'FINISHED' && (
              <button type="button" className="primary-btn" onClick={goToFinished}>
                View Summary
              </button>
            )}
          </div>
        </div>

        <div className="live-game-picker">
          <label htmlFor="live-game-picker">Game</label>
          <select
            id="live-game-picker"
            value={selectedGameId}
            onChange={(event) => setSelectedGameId(event.target.value)}
            disabled={!games.length}
          >
            {!games.length && <option value="">No game</option>}
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name} - {formatDateTimeInIST(game.date)} ({game.status})
              </option>
            ))}
          </select>
        </div>

        <div className="live-meta-grid">
          <div>
            <span>Status</span>
            <strong>{effectiveStatus}</strong>
          </div>
          <div>
            <span>Current Number</span>
            <strong>{displayCurrentNumber ?? '--'}</strong>
          </div>
          <div>
            <span>Called</span>
            <strong>{displayCalledNumbers.length}/90</strong>
          </div>
          <div>
            <span>Booking</span>
            <strong>{summary?.game.booking_status ?? selectedGame?.booking_status ?? '--'}</strong>
          </div>
        </div>
        {(audioBlockedMessage || bingoAnnouncement) && (
          <div className="live-bingo-call">{audioBlockedMessage || bingoAnnouncement}</div>
        )}
      </section>

      {loading && <section className="live-message">Loading live game...</section>}
      {error && <section className="live-message error">{error}</section>}

      {!loading && !error && (
        <>
          <Leaderboard entries={leaderboard} />

          <section className="live-card">
            <h2>Number Board</h2>
            <div className={`live-number-board ${isNumberUiFrozen ? 'frozen' : ''}`}>
              {Array.from({ length: 90 }, (_, index) => {
                const number = index + 1
                return (
                  <div
                    key={number}
                    className={`live-number-cell ${calledSet.has(number) ? 'called' : ''}`}
                  >
                    {number}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="live-card">
            <h2>Prize Monitor</h2>
            <div className="live-prize-grid">
              {orderedPrizes.map((prize) => {
                const winner = mergedWinners.find((item) => item.prize_type === prize.prize_type)
                const claimed = lockedPrizeSet.has(prize.prize_type)
                return (
                  <article key={prize.prize_type} className={`prize-tile ${claimed ? 'claimed' : ''}`}>
                    <header>{PRIZE_LABEL_MAP[prize.prize_type] ?? prize.prize_type}</header>
                    <p>Amount: {prize.amount}</p>
                    <p>Status: {claimed ? 'CLAIMED' : 'OPEN'}</p>
                    <p>Winner: {winner ? `${winner.player_name ?? 'Player'} (#${winner.ticket_number})` : '--'}</p>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="live-card">
            <h2>Winners</h2>
            <div className="live-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Prize</th>
                    <th>Player</th>
                    <th>Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {mergedWinners.length === 0 && (
                    <tr>
                      <td colSpan={3}>No winners yet.</td>
                    </tr>
                  )}
                  {mergedWinners.map((winner) => (
                    <tr key={winner.id}>
                      <td>{PRIZE_LABEL_MAP[winner.prize_type] ?? winner.prize_type}</td>
                      <td>{winner.player_name ?? 'Player'}</td>
                      <td>{winner.ticket_number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="live-card">
            <h2>Tickets</h2>
            <LiveTicketGrid tickets={tickets} bookingClosed={isBookingClosed} />
          </section>
        </>
      )}

    </main>
  )
}

export default LiveGame
