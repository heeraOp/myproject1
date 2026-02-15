import { apiClient } from '@/api/rest/client'
import type { PublicGame } from '@/types/backend/game'

export type PublicSupportSettings = {
  support: {
    name: string
    whatsapp_number: string
  }
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
