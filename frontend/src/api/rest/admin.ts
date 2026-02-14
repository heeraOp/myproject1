import { adminApiClient } from '@/api/rest/client'
import type { ThemeName } from '@/types/backend/game'

export type GameSummaryResponse = {
  game: {
    id: string
    status: string
    calling_interval: number
    booking_status: string
    website_status: string
    total_tickets: number
    ticket_price: number
    agent_commission: number
    active_theme?: ThemeName
  }
  prizes: Array<{
    prize_type: string
    amount: number
    enabled: boolean
    claimed: boolean
  }>
  winners: Array<{
    id: number
    prize_type: string
    prize_amount: number
    ticket_number: number
    player_name: string | null
    won_at: string
  }>
  called_numbers: number[]
}

export type GameStateResponse = {
  game: {
    id: string
    status: string
    calling_status: 'ON' | 'OFF'
    calling_interval: number
    booking_status: string
    website_status: string
  }
  called_numbers: number[]
  won_prizes: Array<{
    prize_type: string
    ticket_number: number
    player_name: string | null
  }>
}

export type GameBusinessSummaryResponse = {
  total_tickets: number
  tickets_booked: number
  fullsheet_booked: number
  halfsheet_booked: number
  tickets_left: number
  total_prize_money: number
  total_revenue: number
  total_profit: number
  agent_commission: number
  website_status: string
}

export type PrizeResponse = {
  prize_type: string
  amount: number
  enabled: boolean
  claimed: boolean
}

export type PrizeTypeResponse = {
  prize_type: string
  label: string
}

export type CreatePrizePayload = {
  prize_type: string
  amount?: number
  enabled?: boolean
}

export type WinnerResponse = {
  id: number
  prize_type: string
  prize_amount: number
  ticket_number: number
  player_name: string | null
  won_at: string
}

export type TicketResponse = {
  ticket_number: number
  ticket_type: string
  status: string
  ticket_data: {
    rows: Array<Array<number | null>>
  }
  player_name: string | null
  player_phone?: string | null
}

export const getGameSummary = async (gameId: string): Promise<GameSummaryResponse> => {
  const response = await adminApiClient.get<GameSummaryResponse>(`/games/${gameId}/summary/`)
  return response.data
}

export const getGameState = async (gameId: string): Promise<GameStateResponse> => {
  const response = await adminApiClient.get<GameStateResponse>(`/games/${gameId}/state/`)
  return response.data
}

export const getGameBusinessSummary = async (
  gameId: string,
): Promise<GameBusinessSummaryResponse> => {
  const response = await adminApiClient.get<GameBusinessSummaryResponse>(
    `/games/${gameId}/business-summary/`,
  )
  return response.data
}

export const getPrizes = async (gameId: string): Promise<PrizeResponse[]> => {
  const response = await adminApiClient.get<PrizeResponse[]>(`/prizes/game/${gameId}/`)
  return response.data
}

export const getPrizeTypes = async (): Promise<PrizeTypeResponse[]> => {
  const response = await adminApiClient.get<PrizeTypeResponse[]>('/prizes/types/')
  return response.data
}

export const createGamePrizes = async (
  gameId: string,
  payload: CreatePrizePayload[],
): Promise<{
  detail: string
  created: PrizeResponse[]
  existing: PrizeResponse[]
}> => {
  const response = await adminApiClient.post(`/prizes/game/${gameId}/`, payload)
  return response.data
}

export const updateGamePrize = async (
  gameId: string,
  prizeType: string,
  payload: { amount?: number; enabled?: boolean },
): Promise<PrizeResponse> => {
  const response = await adminApiClient.patch<PrizeResponse>(
    `/prizes/game/${gameId}/${prizeType}/`,
    payload,
  )
  return response.data
}

export const deleteGamePrize = async (
  gameId: string,
  prizeType: string,
): Promise<{ detail: string; deleted: number }> => {
  const response = await adminApiClient.delete<{ detail: string; deleted: number }>(
    `/prizes/game/${gameId}/${prizeType}/`,
  )
  return response.data
}

export const updatePrizes = async (
  gameId: string,
  payload: Array<{ prize_type: string; amount: number; enabled: boolean }>,
): Promise<PrizeResponse[]> => {
  const response = await adminApiClient.put<PrizeResponse[]>(`/prizes/game/${gameId}/`, payload)
  return response.data
}

export const getTickets = async (
  gameId: string,
  status?: 'OPEN' | 'BOOKED',
): Promise<TicketResponse[]> => {
  const response = await adminApiClient.get<TicketResponse[]>(`/tickets/game/${gameId}/`, {
    params: status ? { status } : undefined,
  })
  return response.data
}

export const getWinners = async (gameId: string): Promise<WinnerResponse[]> => {
  const response = await adminApiClient.get<WinnerResponse[]>(`/claims/game/${gameId}/winners/`)
  return response.data
}

export const bookTicket = async (payload: {
  game_id: string
  ticket_number?: number
  ticket_numbers?: number[]
  booking_mode?: 'RANDOM' | 'HALF_SHEET' | 'FULL_SHEET'
  player_name: string
  player_phone: string
}) => {
  const response = await adminApiClient.post('/tickets/admin/book/', payload)
  return response.data
}

export const generateTickets = async (payload: { game_id: string; total_tickets: number }) => {
  const response = await adminApiClient.post<{ total_generated: number }>(
    '/tickets/admin/generate/',
    payload,
  )
  return response.data
}

export const saveGameSettings = async (payload: {
  date: string
  total_tickets: number
  ticket_price: number
  agent_commission: number
  booking_status: string
  website_status: string
}) => {
  const response = await adminApiClient.post('/games/', payload)
  return response.data
}

export const startGame = async (gameId: string, callingInterval: number) => {
  const response = await adminApiClient.post(`/games/admin/${gameId}/start/`, {
    calling_interval: callingInterval,
  })
  return response.data
}

export const pauseGame = async (gameId: string) => {
  const response = await adminApiClient.post(`/games/admin/${gameId}/pause/`)
  return response.data
}

export const resumeGame = async (gameId: string) => {
  const response = await adminApiClient.post(`/games/admin/${gameId}/resume/`)
  return response.data
}

export const callNextNumber = async (gameId: string) => {
  const response = await adminApiClient.post<{ number: number }>(`/games/admin/${gameId}/call-next/`)
  return response.data
}

export const resetCall = async (gameId: string) => {
  const response = await adminApiClient.post(`/games/admin/${gameId}/reset-call/`)
  return response.data
}

export const resetTicket = async (gameId: string) => {
  const response = await adminApiClient.post(`/games/admin/${gameId}/reset-ticket/`)
  return response.data
}

export const resetAgent = async (gameId: string) => {
  const response = await adminApiClient.post(`/games/admin/${gameId}/reset-agent/`)
  return response.data
}

export const updateActiveTheme = async (gameId: string, activeTheme: ThemeName) => {
  const response = await adminApiClient.post<{ active_theme: ThemeName }>(
    `/games/admin/${gameId}/theme/`,
    { active_theme: activeTheme },
  )
  return response.data
}
