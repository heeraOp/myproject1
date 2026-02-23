import { useCallback, useEffect } from 'react'
import { socketManager } from '@/api/websocket/socketManager'
import { useAnnouncementStore } from '@/app/store/announcement.store'
import { useGameStore } from '@/app/store/game.store'
import { type VoiceMode, useVoiceModeStore } from '@/app/store/voiceMode.store'
import { REST_BASE_URL } from '@/config'
import { playAudioElementSafely } from '@/utils/audioEngine'
import { queueSpeakText, type VoiceType } from '@/utils/speakText'

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
  game_id: string | number
  announcement_id?: number | string
  audio_url?: string | null
  audio_mime_type?: string | null
}

type VoiceModeUpdateEvent = {
  type: 'VOICE_MODE_UPDATE'
  voice_mode: VoiceMode
}

type VoiceSpeedUpdateEvent = {
  type: 'VOICE_SPEED_UPDATE'
  voice_speed: number
}

type VoiceEventSocketPayload = {
  type: 'voice_event'
  event: string
  audio_url: string
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
  const hasGameId = typeof event.game_id === 'string' || typeof event.game_id === 'number'
  const hasValidAudioUrl =
    event.audio_url === undefined ||
    event.audio_url === null ||
    typeof event.audio_url === 'string'
  const hasValidAudioMime =
    event.audio_mime_type === undefined ||
    event.audio_mime_type === null ||
    typeof event.audio_mime_type === 'string'
  return (
    event.type === 'announcement' &&
    typeof event.message === 'string' &&
    typeof event.timestamp === 'string' &&
    hasGameId &&
    hasValidAudioUrl &&
    hasValidAudioMime
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

const isVoiceMode = (value: unknown): value is VoiceMode =>
  value === 'CLASSIC' ||
  value === 'FEMALE_SHOUT' ||
  value === 'FUNNY' ||
  value === 'CRAZY' ||
  value === 'MALE_DEEP' ||
  value === 'MALE_ENERGETIC' ||
  value === 'ROYAL_COMMANDER' ||
  value === 'SPORTS_COMMENTATOR' ||
  value === 'FUNNY_CARTOON' ||
  value === 'FUNNY_COMEDIC' ||
  value === 'FUNNY_CRAZY'

const isVoiceModeUpdateEvent = (payload: unknown): payload is VoiceModeUpdateEvent => {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  return event.type === 'VOICE_MODE_UPDATE' && isVoiceMode(event.voice_mode)
}

const isVoiceSpeedUpdateEvent = (payload: unknown): payload is VoiceSpeedUpdateEvent => {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  return event.type === 'VOICE_SPEED_UPDATE' && Number.isFinite(Number(event.voice_speed))
}

const isVoiceEventSocketPayload = (payload: unknown): payload is VoiceEventSocketPayload => {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Record<string, unknown>
  return (
    event.type === 'voice_event' &&
    typeof event.event === 'string' &&
    typeof event.audio_url === 'string' &&
    String(event.audio_url).trim().length > 0
  )
}

const GAME_START_FALLBACK_TEXT =
  'The game is about to start. Players get ready. Today is your lucky day.'
const GAME_END_FALLBACK_TEXT = 'The game has ended. Congratulations to all winners.'

const PRIZE_LABEL_MAP: Record<string, string> = {
  FIRST_HOUSE: 'First Full House',
  SECOND_HOUSE: 'Second Full House',
  THIRD_HOUSE: 'Third Full House',
  FULL_SHEET: 'Full Sheet Bonus',
  FULL_SHEET_BONUS: 'Full Sheet Bonus',
  HALF_SHEET: 'Half Sheet Bonus',
  HALF_SHEET_BONUS: 'Half Sheet Bonus',
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

const normalizePrizeToken = (value: string): string =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

const prizeLabelFromWinnerEvent = (value: string): string => {
  const token = normalizePrizeToken(value)
  return PRIZE_LABEL_MAP[token] ?? (String(value || '').trim() || 'Prize')
}

const resolveVoiceTypeForMode = (mode: VoiceMode): VoiceType => {
  if (mode === 'FEMALE_SHOUT') return 'female_shout'
  if (mode === 'FUNNY' || mode === 'FUNNY_CARTOON' || mode === 'FUNNY_COMEDIC' || mode === 'FUNNY_CRAZY') {
    return 'funny'
  }
  if (mode === 'SPORTS_COMMENTATOR') return 'savage'
  if (mode === 'ROYAL_COMMANDER') return 'dramatic'
  if (mode === 'CRAZY') return 'savage'
  if (mode === 'MALE_DEEP' || mode === 'MALE_ENERGETIC') return 'dramatic'
  return 'normal'
}

const normalizeBaseUrl = (value: string): string => String(value || '').replace(/\/+$/, '')
const toInteger = (value: string | number): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  const parsed = Number.parseInt(String(value), 10)
  return Number.isInteger(parsed) ? parsed : null
}

const resolveMediaAudioUrl = (value: string): string => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const configuredBase = normalizeBaseUrl(REST_BASE_URL || '')
  const base = configuredBase || runtimeOrigin

  try {
    const resolved = new URL(raw, base || 'http://localhost')
    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      resolved.protocol === 'http:' &&
      resolved.host === window.location.host
    ) {
      resolved.protocol = 'https:'
    }
    return resolved.toString()
  } catch {
    return raw
  }
}

export const useGameSocket = (gameId?: string): void => {
  const applyBackendEvent = useGameStore((state) => state.applyBackendEvent)
  const replaceFromBackendState = useGameStore((state) => state.replaceFromBackendState)
  const enqueueWinnerAnnouncement = useGameStore((state) => state.enqueueWinnerAnnouncement)
  const addAnnouncement = useAnnouncementStore((state) => state.addAnnouncement)
  const setVoiceMode = useVoiceModeStore((state) => state.setMode)
  const setVoiceSpeed = useVoiceModeStore((state) => state.setSpeed)
  const addWinnerEvent = useCallback(
    (event: {
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

      const winnerAnnouncementId = `winner-${String(event.id)}`
      const storeState = useGameStore.getState()
      const alreadyQueued = storeState.winnerQueue.some((item) => item.id === winnerAnnouncementId)
      const alreadyKnownWinner =
        winnerId !== null && storeState.winners.some((winner) => winner.id === winnerId)
      if (!alreadyQueued && !alreadyKnownWinner) {
        enqueueWinnerAnnouncement({
          id: winnerAnnouncementId,
          winner_name: event.winnerName.trim() || 'Player',
          prize_name: event.prizeName.trim() || 'Prize',
          ticket_number: resolvedTicketNumber ?? null,
        })
      }
    },
    [applyBackendEvent, enqueueWinnerAnnouncement],
  )

  useEffect(() => {
    if (!gameId) return
    let isActive = true
    let recoveryInFlight = false
    let activeVoiceAudio: HTMLAudioElement | null = null
    const voiceEventSeenAt = new Map<string, number>()

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
        const scheduledAt = Date.now()
        window.setTimeout(() => {
          if (!isActive) return
          const seenAt = voiceEventSeenAt.get('game_start') ?? 0
          if (seenAt >= scheduledAt) return
          const mode = useVoiceModeStore.getState().mode
          void queueSpeakText(GAME_START_FALLBACK_TEXT, resolveVoiceTypeForMode(mode), {
            rate: useVoiceModeStore.getState().speed,
            pitch: 1,
          })
        }, 1400)
      }),
      socketManager.subscribe('number.called', (event: unknown) => {
        if (!isNumberCalledEvent(event)) return
        applyBackendEvent(event)
      }),
      socketManager.subscribe('game.finished', (event: unknown) => {
        applyBackendEvent(event as EngineSocketEvent)
        const scheduledAt = Date.now()
        window.setTimeout(() => {
          if (!isActive) return
          const seenAt = voiceEventSeenAt.get('game_end') ?? 0
          if (seenAt >= scheduledAt) return
          const mode = useVoiceModeStore.getState().mode
          void queueSpeakText(GAME_END_FALLBACK_TEXT, resolveVoiceTypeForMode(mode), {
            rate: useVoiceModeStore.getState().speed,
            pitch: 1,
          })
        }, 1400)
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
        const prizeLabel = prizeLabelFromWinnerEvent(event.prize_name)
        const fallbackText = `Congratulations players. ${prizeLabel} prize has been won.`
        const scheduledAt = Date.now()
        window.setTimeout(() => {
          if (!isActive) return
          const seenAt = voiceEventSeenAt.get('winner_prize') ?? 0
          if (seenAt >= scheduledAt) return
          const mode = useVoiceModeStore.getState().mode
          void queueSpeakText(fallbackText, resolveVoiceTypeForMode(mode), {
            rate: useVoiceModeStore.getState().speed,
            pitch: 1,
          })
        }, 900)
      }),
      socketManager.subscribe('announcement', (event: unknown) => {
        if (!isAnnouncementEvent(event)) return
        const normalizedGameId = String(event.game_id).trim()
        if (!normalizedGameId) return
        const rawId = event.announcement_id
        const parsedId =
          typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId ?? ''), 10)
        const numericId =
          Number.isInteger(parsedId) ? parsedId : Date.now() + Math.floor(Math.random() * 1000)
        addAnnouncement({
          id: Number(numericId),
          gameId: normalizedGameId,
          message: event.message,
          timestamp: event.timestamp,
          audioUrl: typeof event.audio_url === 'string' ? resolveMediaAudioUrl(event.audio_url) : undefined,
          audioMimeType: typeof event.audio_mime_type === 'string' ? event.audio_mime_type : undefined,
        })
      }),
      socketManager.subscribe('VOICE_MODE_UPDATE', (event: unknown) => {
        if (!isVoiceModeUpdateEvent(event)) return
        setVoiceMode(event.voice_mode)
      }),
      socketManager.subscribe('VOICE_SPEED_UPDATE', (event: unknown) => {
        if (!isVoiceSpeedUpdateEvent(event)) return
        setVoiceSpeed(Number(event.voice_speed))
      }),
      socketManager.subscribe('voice_event', (event: unknown) => {
        if (!isVoiceEventSocketPayload(event)) return
        const eventName = String(event.event || '').trim()
        if (eventName) {
          voiceEventSeenAt.set(eventName, Date.now())
        }
        const mediaUrl = resolveMediaAudioUrl(event.audio_url)
        if (!mediaUrl) return

        if (activeVoiceAudio) {
          activeVoiceAudio.pause()
          activeVoiceAudio.currentTime = 0
          activeVoiceAudio = null
        }

        const audio = new Audio(mediaUrl)
        audio.preload = 'auto'
        activeVoiceAudio = audio
        try {
          window.dispatchEvent(
            new CustomEvent('voice-event-playback-started', {
              detail: { event: eventName || 'voice_event' },
            }),
          )
        } catch {
          // ignore
        }
        const clearActiveAudio = () => {
          if (activeVoiceAudio === audio) {
            activeVoiceAudio = null
          }
          try {
            window.dispatchEvent(
              new CustomEvent('voice-event-playback-ended', {
                detail: { event: eventName || 'voice_event' },
              }),
            )
          } catch {
            // ignore
          }
        }
        audio.onended = clearActiveAudio
        audio.onerror = clearActiveAudio
        void playAudioElementSafely(audio)
      }),
      socketManager.on('reconnect', () => {
        void recoverState()
      }),
    ]
    console.log('Subscribed to winner events')

    return () => {
      isActive = false
      unsubs.forEach((unsubscribe) => unsubscribe())
      if (activeVoiceAudio) {
        activeVoiceAudio.pause()
        activeVoiceAudio.currentTime = 0
        activeVoiceAudio = null
      }
      socketManager.disconnect()
    }
  }, [
    gameId,
    applyBackendEvent,
    replaceFromBackendState,
    enqueueWinnerAnnouncement,
    addAnnouncement,
    addWinnerEvent,
    setVoiceMode,
    setVoiceSpeed,
  ])
}
