import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TambolaTicketCard from '@/components/common/TambolaTicketCard'
import AnnouncementBanner from '@/components/common/AnnouncementBanner'
import WinnerCelebrationOverlay from '@/components/common/WinnerCelebrationOverlay'
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
import { useVoiceModeStore, type VoiceMode } from '@/app/store/voiceMode.store'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(getActiveTheme())
  const [isThemeLocked, setIsThemeLocked] = useState(isAdminThemeActive())

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
    setActiveTheme,
  } = useGameStore((state) => state)
  const {
    announcement: bingoAnnouncement,
    isAudioReady,
    isSpeechSupported,
    audioBlockedMessage,
    unlockAudio,
  } = useBingoCaller()

  useEffect(() => {
    return subscribeThemeChange(({ theme: updatedTheme, isLocked }) => {
      setTheme(updatedTheme)
      setIsThemeLocked(isLocked)
    })
  }, [])
  const voiceMode = useVoiceModeStore((state) => state.mode)
  const setVoiceMode = useVoiceModeStore((state) => state.setMode)

  useGameSocket(selectedGameId || undefined)

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
  }, [searchParams, setActiveTheme])

  const loadGameData = useCallback(async (gameId: string) => {
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

      setSummary(summaryData)
      setPrizes(prizesData)
      replaceFromBackendState(stateData)
      setTicketsFromBackend(gameId, ticketsData)
      setTickets(ticketsData)
      setHistoryWinners(dedupeWinners(winnersData))
    } catch {
      setError('Unable to load live game state.')
    } finally {
      setLoading(false)
    }
  }, [playerPhone, replaceFromBackendState, setTicketsFromBackend])

  useEffect(() => {
    if (!selectedGameId) return
    clearWinnerQueue()
    void loadGameData(selectedGameId)
  }, [clearWinnerQueue, loadGameData, selectedGameId])

  useEffect(() => {
    const unsubNewGame = socketManager.subscribe('new_game_created', async (event: unknown) => {
      const payload = (event as { data?: PublicGame }).data
      const nextGameId = typeof payload?.id === 'string' ? payload.id : ''
      if (!nextGameId) return

      const nextGame: PublicGame = {
        id: nextGameId,
        date: String(payload?.date ?? new Date().toISOString()),
        status: (payload?.status ?? 'CREATED') as PublicGame['status'],
        ticket_price: Number(payload?.ticket_price ?? 0),
        booking_status: (payload?.booking_status ?? 'OPEN') as PublicGame['booking_status'],
        website_status: (payload?.website_status ?? 'OPEN') as PublicGame['website_status'],
        agent: payload?.agent ?? null,
        active_theme: payload?.active_theme,
        is_active: true,
      }

      if (nextGame.active_theme) {
        setAdminTheme(nextGame.active_theme)
      }
      setActiveTheme(nextGame.active_theme ?? null)
      setGames([nextGame])
      setSelectedGameId(nextGameId)
      setTickets([])
      setHistoryWinners([])
      setTicketsFromBackend(nextGameId, [])
      clearWinnerQueue()

      try {
        await loadGameData(nextGameId)
      } catch {
        return
      }
    })

    const unsubTicketsGenerated = socketManager.subscribe('tickets_generated', async (event: unknown) => {
      const payload = (event as { data?: { game_id?: string } }).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (!eventGameId || !selectedGameId || eventGameId !== selectedGameId) return

      try {
        const latestTickets = await fetchGameTickets(eventGameId, playerPhone)
        setTicketsFromBackend(eventGameId, latestTickets)
        setTickets(latestTickets)
      } catch {
        return
      }
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
      if (!eventGameId || !selectedGameId || eventGameId !== selectedGameId) return

      const ticketId = typeof payload?.ticket_id === 'string' ? payload.ticket_id : ''
      if (ticketId) {
        setTickets((prev) =>
          prev.map((ticket) =>
            ticket.id === ticketId
              ? {
                  ...ticket,
                  status: typeof payload?.status === 'string' ? payload.status : ticket.status,
                }
              : ticket,
          ),
        )
      }

      try {
        const latestTickets = await fetchGameTickets(eventGameId, playerPhone)
        setTicketsFromBackend(eventGameId, latestTickets)
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
  }, [clearWinnerQueue, loadGameData, playerPhone, selectedGameId, setActiveTheme, setTicketsFromBackend])

  useEffect(() => {
    if (!selectedGameId || storeGameId !== selectedGameId) return
    setTickets(liveTickets as PlayerTicket[])
  }, [liveTickets, selectedGameId, storeGameId])

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
    if (summary?.game.status === 'FINISHED') return 'FINISHED'
    if (liveStatus === 'RUNNING') return 'RUNNING'
    if (summary?.game.status) return summary.game.status
    return 'CREATED'
  }, [liveStatus, summary?.game.status])

  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers])

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
      <AnnouncementBanner gameId={selectedGameId || undefined} />
      <WinnerCelebrationOverlay />
      <section className="live-header-card">
        <div className="live-header-top">
          <h1>Live Tambola</h1>
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
                {formatDateTimeInIST(game.date)} ({game.status})
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
            <strong>{currentNumber ?? '--'}</strong>
          </div>
          <div>
            <span>Called</span>
            <strong>{calledNumbers.length}/90</strong>
          </div>
          <div>
            <span>Booking</span>
            <strong>{summary?.game.booking_status ?? selectedGame?.booking_status ?? '--'}</strong>
          </div>
        </div>
        <div className="live-voice-control">
          <label htmlFor="live-voice-mode">Voice mode</label>
          <div className="live-voice-actions">
            <select
              id="live-voice-mode"
              value={voiceMode}
              onChange={(event) => setVoiceMode(event.target.value as VoiceMode)}
            >
              <option value="CLASSIC">Classic</option>
              <option value="FUNNY">Funny</option>
              <option value="CRAZY">Crazy</option>
            </select>
            {isSpeechSupported && !isAudioReady && (
              <button type="button" className="ghost-btn" onClick={unlockAudio}>
                Enable Sound
              </button>
            )}
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
          <section className="live-card">
            <h2>Number Board</h2>
            <div className="live-number-board">
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
            {tickets.length === 0 ? (
              <div className="live-empty">No tickets available.</div>
            ) : (
              <div className="live-ticket-list">
              {tickets.map((ticket) => (
                <TambolaTicketCard
                  key={ticket.ticket_number}
                  ticket={ticket}
                  variant="player"
                />
              ))}
              </div>
            )}
          </section>
        </>
      )}

    </main>
  )
}

export default LiveGame
