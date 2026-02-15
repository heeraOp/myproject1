import { apiClient } from '@/api/rest/client'
import type { ThemeName } from '@/types/backend/game'

export type PublicGameSummary = {
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

export type PublicGameState = {
  game: {
    id: string
    name: string
    status: string
    calling_status: 'ON' | 'OFF'
    calling_interval: number
    booking_status: string
    website_status?: string
  }
  called_numbers: number[]
  won_prizes: Array<{
    prize_type: string
    ticket_number: number
    player_name: string | null
  }>
}

export type PublicGameBusinessSummary = {
  total_tickets: number
  tickets_booked: number
  fullsheet_booked: number
  halfsheet_booked: number
  tickets_left: number
  total_prize_money: number
  total_revenue: number
  total_profit: number
  agent_commission: number
  website_status?: string
}

export type PublicWinner = {
  id: number
  prize_type: string
  prize_amount: number
  ticket_number: number
  player_name: string | null
  won_at: string
}

export type PublicPrize = {
  prize_type: string
  amount: number
  enabled: boolean
  claimed: boolean
}

export const fetchGameSummary = async (gameId: string): Promise<PublicGameSummary> => {
  console.log('Fetching summary for gameId:', gameId)
  const response = await apiClient.get<PublicGameSummary>(`/games/${gameId}/summary/`)
  console.log('Summary response:', response.data)
  return response.data
}

export const fetchGameState = async (gameId: string): Promise<PublicGameState> => {
  const response = await apiClient.get<PublicGameState>(`/games/${gameId}/state/`)
  return response.data
}

export const fetchGameBusinessSummary = async (
  gameId: string,
): Promise<PublicGameBusinessSummary> => {
  const response = await apiClient.get<PublicGameBusinessSummary>(`/games/${gameId}/business-summary/`)
  return response.data
}

export const fetchPrizes = async (gameId: string): Promise<PublicPrize[]> => {
  const response = await apiClient.get<PublicPrize[]>(`/prizes/game/${gameId}/`)
  return response.data
}

export const fetchWinners = async (gameId: string): Promise<PublicWinner[]> => {
  const response = await apiClient.get<PublicWinner[]>(`/claims/game/${gameId}/winners/`)
  return response.data
}
