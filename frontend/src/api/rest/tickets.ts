import { apiClient } from '@/api/rest/client'
import type { PlayerTicket } from '@/types/backend/ticket'

export const fetchGameTickets = async (
  gameId: string,
  playerPhone?: string,
): Promise<PlayerTicket[]> => {
  // Use the public tickets endpoint to avoid exposing other players' data.
  const response = await apiClient.get<PlayerTicket[]>(`/tickets/game/${gameId}/public/`, {
    params: playerPhone ? { player_phone: playerPhone } : undefined,
  })
  return response.data
}
