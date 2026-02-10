import { useEffect } from 'react'
import { socketManager } from '@/api/websocket/socketManager'
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

type SocketEvent = GameStartedEvent | NumberCalledEvent | GameFinishedEvent | WinnerAnnouncedEvent

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

export const useGameSocket = (gameId?: string): void => {
  const applyBackendEvent = useGameStore((state) => state.applyBackendEvent)
  const replaceFromBackendState = useGameStore((state) => state.replaceFromBackendState)
  const reset = useGameStore((state) => state.reset)

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
        applyBackendEvent(event as SocketEvent)
      }),
      socketManager.subscribe('number.called', (event: unknown) => {
        if (!isNumberCalledEvent(event)) return
        applyBackendEvent(event)
      }),
      socketManager.subscribe('game.finished', (event: unknown) => {
        applyBackendEvent(event as SocketEvent)
      }),
      socketManager.subscribe('winner.announced', (event: unknown) => {
        if (!isWinnerAnnouncedEvent(event)) return
        applyBackendEvent(event)
      }),
      socketManager.on('reconnect', () => {
        void recoverState()
      }),
    ]

    return () => {
      isActive = false
      unsubs.forEach((unsubscribe) => unsubscribe())
      socketManager.disconnect()
      reset()
    }
  }, [gameId, applyBackendEvent, replaceFromBackendState, reset])
}
