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
  const params = playerPhone ? { player_phone: playerPhone } : undefined

  // Canonical endpoint shape: { tickets: [...] }
  try {
    const response = await apiClient.get<GameTicketsSnapshotResponse | PlayerTicket[]>(
      `/games/${gameId}/tickets/`,
      { params },
    )

    if (Array.isArray(response.data)) return response.data
    if (Array.isArray(response.data?.tickets)) return response.data.tickets
  } catch {
    // Fallback below for deployments still serving legacy ticket routes.
  }

  // Legacy public endpoint shape: [...]
  try {
    const publicResponse = await apiClient.get<PlayerTicket[] | { tickets?: PlayerTicket[] }>(
      `/tickets/game/${gameId}/public/`,
      { params },
    )
    if (Array.isArray(publicResponse.data)) return publicResponse.data
    if (Array.isArray(publicResponse.data?.tickets)) return publicResponse.data.tickets
  } catch {
    // Continue to final fallback.
  }

  // Legacy player endpoint shape: [...]
  try {
    const playerResponse = await apiClient.get<PlayerTicket[] | { tickets?: PlayerTicket[] }>(
      `/tickets/game/${gameId}/`,
      { params },
    )
    if (Array.isArray(playerResponse.data)) return playerResponse.data
    if (Array.isArray(playerResponse.data?.tickets)) return playerResponse.data.tickets
  } catch {
    return []
  }

  return []
}

export type RequestBookingPayload = {
  player_name: string
  whatsapp: string
  payment_mode: string
}

export type BookingType = 'random' | 'halfsheet' | 'fullsheet'

export type BookingPrivileges = {
  normal_prizes: boolean
  half_sheet_bonus: boolean
  full_sheet_bonus: boolean
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
  booking_type?: BookingType
  booking_id?: number
  ticket_count?: number
  requested_ticket_count?: number
  ticket_numbers?: number[]
  eligible_privileges?: BookingPrivileges
  payment_status?: string
  whatsapp_redirect_url?: string
  wallet_deducted?: boolean
  wallet_amount?: number
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

export type BulkRequestBookingPayload = {
  game_id: string
  ticket_number?: number
  ticket_numbers?: number[]
  ticket_numbers_csv?: string
  booking_type?: BookingType
  player_name: string
  whatsapp: string
  payment_mode: string
}

export type BulkRequestBookingResponse = {
  booking_type: BookingType
  booking_id?: number
  ticket_count: number
  requested_ticket_count?: number
  ticket_numbers: number[]
  eligible_privileges: BookingPrivileges
  payment_status?: string
  whatsapp_redirect_url?: string
  wallet_deducted?: boolean
  wallet_amount?: number
  requested_tickets?: RequestBookingResponse[]
}

export const requestBulkTicketBooking = async (
  payload: BulkRequestBookingPayload,
): Promise<BulkRequestBookingResponse> => {
  const response = await apiClient.post<BulkRequestBookingResponse>(
    '/tickets/request-booking/',
    payload,
  )
  return response.data
}
