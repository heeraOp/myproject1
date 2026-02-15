import { adminApiClient } from '@/api/rest/client'
import type { GameAgent, ThemeName } from '@/types/backend/game'
import type { TicketData, TicketStatus, TicketType } from '@/types/backend/ticket'
import { toISOStringFromInput } from '@/utils/dateTime'

export type AgentOption = {
  id: number
  name: string
  whatsapp_number: string
}

export type AdminGameListItem = {
  id: string
  name: string
  date: string
  status: string
  calling_interval?: number
  booking_status: string
  website_status: string
  total_tickets: number
  ticket_price: number
  agent_commission: number
  agent?: GameAgent | null
  active_theme?: ThemeName
  is_active?: boolean
}

export type GameSummaryResponse = {
  game: {
    id: string
    name: string
    status: string
    calling_interval: number
    booking_status: string
    website_status: string
    total_tickets: number
    ticket_price: number
    agent_commission: number
    agent?: GameAgent | null
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
    name: string
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

export type AnnouncementResponse = {
  announcement_id: number
  message: string
  timestamp: string
  game_id: string
}

const normalizeGameId = (value: string): string => value.trim().replace(/^\/+|\/+$/g, '')

export type TicketResponse = {
  id?: string
  game_id?: string
  ticket_number: number
  ticket_type: TicketType
  status: TicketStatus
  ticket_data: TicketData
  player_name: string | null
  player_phone?: string | null
  requested_by_name?: string | null
  requested_by_whatsapp?: string | null
  requested_at?: string | null
  marked_numbers: number[]
  final_immutable: boolean
}

export type GameTicketsSnapshotResponse = {
  game: {
    id: string
    name?: string
    status: string
  }
  final_immutable: boolean
  called_numbers: number[]
  tickets: TicketResponse[]
}

export const getGameSummary = async (gameId: string): Promise<GameSummaryResponse> => {
  console.log('Fetching summary for gameId:', gameId)
  const response = await adminApiClient.get<GameSummaryResponse>(`/games/${gameId}/summary/`)
  console.log('Summary response:', response.data)
  return response.data
}

export const listAdminGames = async (): Promise<AdminGameListItem[]> => {
  const response = await adminApiClient.get<AdminGameListItem[]>('/games/admin/')
  return response.data
}

export const fetchAgents = async (): Promise<AgentOption[]> =>
  (await adminApiClient.get<AgentOption[]>('/games/admin/agents/')).data

export const getCurrentAdminGame = async (): Promise<AdminGameListItem> => {
  const response = await adminApiClient.get<AdminGameListItem>('/games/current/')
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
  status?: 'AVAILABLE' | 'PENDING' | 'CONFIRMED',
): Promise<TicketResponse[]> => {
  const response = await adminApiClient.get<GameTicketsSnapshotResponse>(`/games/${gameId}/tickets/`, {
    params: status ? { status } : undefined,
  })
  return Array.isArray(response.data?.tickets) ? response.data.tickets : []
}

export const getGameTicketsSnapshot = async (
  gameId: string,
  status?: 'AVAILABLE' | 'PENDING' | 'CONFIRMED',
): Promise<GameTicketsSnapshotResponse> => {
  const response = await adminApiClient.get<GameTicketsSnapshotResponse>(`/games/${gameId}/tickets/`, {
    params: status ? { status } : undefined,
  })
  return response.data
}

export type RehydratedGameState = {
  summary: GameSummaryResponse
  state: GameStateResponse
  business: GameBusinessSummaryResponse
  prizes: PrizeResponse[]
  ticketsSnapshot: GameTicketsSnapshotResponse
  winners: WinnerResponse[]
}

export const loadGameState = async (gameId: string): Promise<RehydratedGameState> => {
  const [summary, state, business, prizes, ticketsSnapshot, winners] = await Promise.all([
    getGameSummary(gameId),
    getGameState(gameId),
    getGameBusinessSummary(gameId),
    getPrizes(gameId),
    getGameTicketsSnapshot(gameId),
    getWinners(gameId),
  ])

  return {
    summary,
    state,
    business,
    prizes,
    ticketsSnapshot,
    winners,
  }
}

export const getWinners = async (gameId: string): Promise<WinnerResponse[]> => {
  const response = await adminApiClient.get<WinnerResponse[]>(`/claims/game/${gameId}/winners/`)
  return response.data
}

export const confirmTicketRequest = async (ticketId: string) => {
  const response = await adminApiClient.post<TicketResponse>(`/admin/tickets/${ticketId}/confirm/`)
  return response.data
}

export const rejectTicketRequest = async (ticketId: string) => {
  const response = await adminApiClient.post<TicketResponse>(`/admin/tickets/${ticketId}/reject/`)
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
  name: string
  date: string
  total_tickets: number
  ticket_price: number
  agent_commission: number
  agent_id?: number | null
  booking_status: string
  website_status: string
}) => {
  const dateIso = toISOStringFromInput(payload.date)
  if (!dateIso) {
    throw new Error('Please select a valid game date and time.')
  }

  const response = await adminApiClient.post('/games/admin/', {
    ...payload,
    date: dateIso,
  })
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

export const announceGame = async (
  gameId: string,
  message: string,
): Promise<AnnouncementResponse> => {
  const normalizedGameId = normalizeGameId(gameId)
  const response = await adminApiClient.post<AnnouncementResponse>(
    `/games/${normalizedGameId}/announce/`,
    { message },
  )
  return response.data
}
