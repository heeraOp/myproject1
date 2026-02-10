import { apiClient } from '@/api/rest/client'
import type { PublicGame } from '@/types/backend/game'

export const fetchPublicGames = async (): Promise<PublicGame[]> => {
  const response = await apiClient.get<PublicGame[]>('/games/public/')
  return response.data
}
