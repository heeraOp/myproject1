import { apiClient } from '@/api/rest/client'
import type { PublicGame } from '@/types/backend/game'

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
