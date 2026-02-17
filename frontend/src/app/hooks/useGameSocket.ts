import { useEffect } from 'react'
import { socketManager } from '@/api/websocket/socketManager'
import { useAnnouncementStore } from '@/app/store/announcement.store'
import { useGameStore } from '@/app/store/game.store'
import { REST_BASE_URL } from '@/config'

type GameStartedEvent = {
  type: 'game.started'
  calling_interval?: number
}

type NumberCalledEvent = {
  type: 'number.called'
  number: number
  called_numbers: number[]
}

type GameFinishedEvent = {
  type: 'game.finished'
}

type Winner = {
  id: number
  prize_type: string
  prize_amount: number
  ticket_number: number
  player_name: string | null
  won_at: string
}

type WinnerAnnouncedEvent = {
  type: 'winner.announced'
  winner: Winner
}

type WinnerBroadcastEvent = {
  type: 'winner'
  winner_id: string | number
  ticket_id: string | number
  prize_id: string | number
  winner_name: string
  prize_name: string
  timestamp: string
}

type AnnouncementEvent = {
  type: 'announcement'
  message: string
  timestamp: string
  game_id: string
  announcement_id?: number
}

type EngineSocketEvent = GameStartedEvent | NumberCalledEvent | GameFinishedEvent | WinnerAnnouncedEvent

type GameStateResponse = {
  game: {
    id: string
    status: string
    calling_status: string
    calling_interval: number
    booking_status: string
  }
  called_numbers: number[]
  won_prizes: Array<{
    prize_type: string
    ticket_number: number
    player_name: string | null
  }>
}

const isNumberCalledEvent = (payload: unknown): payload is NumberCalledEvent => {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  return (
    event.type === 'number.called' &&
    Number.isInteger(event.number) &&
    Array.isArray(event.called_numbers)
  )
}

const isWinnerAnnouncedEvent = (payload: unknown): payload is WinnerAnnouncedEvent => {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  const winner = event.winner as Record<string, unknown> | undefined
  return (
    event.type === 'winner.announced' &&
    Boolean(winner) &&
    Number.isInteger(winner?.id) &&
    typeof winner?.prize_type === 'string'
  )
}

const isAnnouncementEvent = (payload: unknown): payload is AnnouncementEvent => {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  return (
    event.type === 'announcement' &&
    typeof event.message === 'string' &&
    typeof event.timestamp === 'string' &&
    typeof event.game_id === 'string'
  )
}

const isWinnerBroadcastEvent = (payload: unknown): payload is WinnerBroadcastEvent => {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  return (
    event.type === 'winner' &&
    (typeof event.winner_id === 'string' || Number.isInteger(event.winner_id)) &&
    (typeof event.ticket_id === 'string' || Number.isInteger(event.ticket_id)) &&
    (typeof event.prize_id === 'string' || Number.isInteger(event.prize_id)) &&
    typeof event.winner_name === 'string' &&
    typeof event.prize_name === 'string' &&
    typeof event.timestamp === 'string'
  )
}

export const useGameSocket = (gameId?: string): void => {
  const applyBackendEvent = useGameStore((state) => state.applyBackendEvent)
  const replaceFromBackendState = useGameStore((state) => state.replaceFromBackendState)
  const enqueueWinnerAnnouncement = useGameStore((state) => state.enqueueWinnerAnnouncement)
  const addAnnouncement = useAnnouncementStore((state) => state.addAnnouncement)
  const toInteger = (value: string | number): number | null => {
    if (typeof value === 'number' && Number.isInteger(value)) return value
    const parsed = Number.parseInt(String(value), 10)
    return Number.isInteger(parsed) ? parsed : null
  }
  const addWinnerEvent = (event: {
    id: string | number
    ticketId: string | number
    prizeName: string
    winnerName: string
    timestamp: string
  }) => {
    const winnerId = toInteger(event.id)
    const ticketId = String(event.ticketId)
    const ticketMatch = useGameStore
      .getState()
      .tickets.find((ticket) => String((ticket as { id?: string }).id ?? '') === ticketId) as
      | { ticket_number?: number }
      | undefined
    const resolvedTicketNumber =
      ticketMatch && Number.isInteger(ticketMatch.ticket_number) ? ticketMatch.ticket_number : null

    if (winnerId !== null && resolvedTicketNumber !== null && resolvedTicketNumber !== undefined) {
      applyBackendEvent({
        type: 'winner.announced',
        winner: {
          id: winnerId,
          prize_type: event.prizeName,
          prize_amount: 0,
          ticket_number: resolvedTicketNumber,
          player_name: event.winnerName.trim() || 'Player',
          won_at: event.timestamp,
        },
      })
    }

    enqueueWinnerAnnouncement({
      id: `winner-${String(event.id)}`,
      winner_name: event.winnerName.trim() || 'Player',
      prize_name: event.prizeName.trim() || 'Prize',
      ticket_number: resolvedTicketNumber ?? null,
    })
  }

  useEffect(() => {
    if (!gameId) return
    let isActive = true
    let recoveryInFlight = false

    const recoverState = async () => {
      if (recoveryInFlight || !isActive) return
      recoveryInFlight = true
      try {
        const response = await fetch(`${REST_BASE_URL}/api/games/${gameId}/state/`, {
          credentials: 'include',
        })
        if (!response.ok || !isActive) return
        const payload = (await response.json()) as GameStateResponse
        if (!isActive) return
        // Reconnect recovery must replace local state from backend authority.
        replaceFromBackendState(payload)
      } catch {
        return
      } finally {
        recoveryInFlight = false
      }
    }

    socketManager.connect(gameId)

    const unsubs = [
      socketManager.subscribe('*', (event: unknown) => {
        console.log('RAW SOCKET:', event)
      }),
      socketManager.on('connect', () => {
        console.log('SOCKET CONNECTED')
      }),
      socketManager.subscribe('game.started', (event: unknown) => {
        applyBackendEvent(event as EngineSocketEvent)
      }),
      socketManager.subscribe('number.called', (event: unknown) => {
        if (!isNumberCalledEvent(event)) return
        applyBackendEvent(event)
      }),
      socketManager.subscribe('game.finished', (event: unknown) => {
        applyBackendEvent(event as EngineSocketEvent)
      }),
      socketManager.subscribe('winner.announced', (event: unknown) => {
        if (!isWinnerAnnouncedEvent(event)) return
        applyBackendEvent(event)
      }),
      socketManager.subscribe('winner', (event: unknown) => {
        if (!event || typeof event !== 'object' || (event as { type?: unknown }).type !== 'winner') return
        if (!isWinnerBroadcastEvent(event)) return
        console.log('WINNER EVENT RECEIVED:', event)
        addWinnerEvent({
          id: event.winner_id,
          ticketId: event.ticket_id,
          prizeName: event.prize_name,
          winnerName: event.winner_name,
          timestamp: event.timestamp,
        })
      }),
      socketManager.subscribe('announcement', (event: unknown) => {
        if (!isAnnouncementEvent(event)) return
        const rawId = event.announcement_id
        const numericId =
          typeof rawId === 'number' && Number.isInteger(rawId) ? rawId : Date.now() + Math.random()
        addAnnouncement({
          id: Number(numericId),
          gameId: event.game_id,
          message: event.message,
          timestamp: event.timestamp,
        })
      }),
      socketManager.on('reconnect', () => {
        void recoverState()
      }),
    ]
    console.log('Subscribed to winner events')

    return () => {
      isActive = false
      unsubs.forEach((unsubscribe) => unsubscribe())
      socketManager.disconnect()
    }
  }, [gameId, applyBackendEvent, replaceFromBackendState, enqueueWinnerAnnouncement, addAnnouncement])
}
