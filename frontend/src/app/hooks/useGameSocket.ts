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
  winner_name: string
  prize_name: string
  ticket_number?: number | null
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
    typeof event.winner_name === 'string' &&
    typeof event.prize_name === 'string' &&
    (event.ticket_number === undefined ||
      event.ticket_number === null ||
      Number.isInteger(event.ticket_number))
  )
}

export const useGameSocket = (gameId?: string): void => {
  const applyBackendEvent = useGameStore((state) => state.applyBackendEvent)
  const replaceFromBackendState = useGameStore((state) => state.replaceFromBackendState)
  const enqueueWinnerAnnouncement = useGameStore((state) => state.enqueueWinnerAnnouncement)
  const addAnnouncement = useAnnouncementStore((state) => state.addAnnouncement)

  useEffect(() => {
    if (!gameId) return
    let isActive = true
    let recoveryInFlight = false

    const recoverState = async () => {
      if (recoveryInFlight || !isActive) return
      recoveryInFlight = true
      try {
        const response = await fetch(`${REST_BASE_URL}/api/games/${gameId}/state/`)
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
        if (!isWinnerBroadcastEvent(event)) return
        enqueueWinnerAnnouncement({
          id: `winner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          winner_name: event.winner_name.trim() || 'Player',
          prize_name: event.prize_name.trim() || 'Prize',
          ticket_number:
            typeof event.ticket_number === 'number' && Number.isInteger(event.ticket_number)
              ? event.ticket_number
              : null,
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

    return () => {
      isActive = false
      unsubs.forEach((unsubscribe) => unsubscribe())
      socketManager.disconnect()
    }
  }, [gameId, applyBackendEvent, replaceFromBackendState, enqueueWinnerAnnouncement, addAnnouncement])
}
