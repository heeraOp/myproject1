import { apiClient } from '@/api/rest/client'
import type { PlayerTicket } from '@/types/backend/ticket'

export type GameTicketsSnapshotResponse = {
  game: {
    id: string
    status: string
  }
  final_immutable: boolean
  called_numbers: number[]
  tickets: PlayerTicket[]
}

export const fetchGameTickets = async (
  gameId: string,
  playerPhone?: string,
): Promise<PlayerTicket[]> => {
  // Use the canonical game tickets snapshot endpoint used by admin as well.
  const response = await apiClient.get<GameTicketsSnapshotResponse>(`/games/${gameId}/tickets/`, {
    params: playerPhone ? { player_phone: playerPhone } : undefined,
  })
  return Array.isArray(response.data?.tickets) ? response.data.tickets : []
}
