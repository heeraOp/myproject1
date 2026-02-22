import { apiClient } from '@/api/rest/client'
import type { PublicGame } from '@/types/backend/game'

export type PublicSupportSettings = {
  support: {
    name: string
    whatsapp_number: string
  }
}

export type GameMetaResponse = {
  game_name: string
  ticket_price: number
  is_live: boolean
  agent_name: string
  agent_whatsapp: string
  payment_mode: string
  how_to_play: string
  prize_patterns: string[]
  prize_pattern_details?: Array<{
    prize_type: string
    label: string
    explanation: string
  }>
}

export const fetchPublicGames = async (): Promise<PublicGame[]> => {
  const response = await apiClient.get<PublicGame[]>('/games/public/')
  return response.data
}

export const fetchCurrentPublicGame = async (): Promise<PublicGame> => {
  const response = await apiClient.get<PublicGame>('/games/public/current/')
  return response.data
}

// Backward-compatible alias; current endpoint is the authority.
export const fetchLatestPublicGame = fetchCurrentPublicGame

export const fetchPublicSupportSettings = async (): Promise<PublicSupportSettings> => {
  const response = await apiClient.get<PublicSupportSettings>('/games/public/settings/')
  return response.data
}

export const fetchGameMeta = async (): Promise<GameMetaResponse> => {
  const response = await apiClient.get<GameMetaResponse>('/game/meta/')
  return response.data
}
