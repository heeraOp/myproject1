import { apiClient } from '@/api/rest/client'
import type { PlayerTicket } from '@/types/backend/ticket'

export type GameTicketsSnapshotResponse = {
  game: {
    id: string
    name?: string
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

export type RequestBookingPayload = {
  player_name: string
  whatsapp: string
}

export type RequestBookingResponse = {
  id: string
  game_id: string
  ticket_number: number
  ticket_type: string
  status: string
  player_name: string | null
  player_phone: string | null
  booked_at: string | null
  requested_by_name: string | null
  requested_by_whatsapp: string | null
  requested_at: string | null
}

export const requestTicketBooking = async (
  ticketId: string,
  payload: RequestBookingPayload,
): Promise<RequestBookingResponse> => {
  const response = await apiClient.post<RequestBookingResponse>(
    `/tickets/${ticketId}/request-booking/`,
    payload,
  )
  return response.data
}
