export type CanonicalTicketStatus = 'AVAILABLE' | 'PENDING' | 'CONFIRMED'
// Keep legacy values for backward compatibility during rollout.
export type TicketStatus = CanonicalTicketStatus | 'OPEN' | 'BOOKED'
export type TicketType = 'RANDOM' | 'HALF_SHEET' | 'FULL_SHEET'

export type TicketData = {
  rows: Array<Array<number | null>>
}

export type PlayerTicket = {
  id?: string
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

export const normalizeTicketStatus = (status: TicketStatus | string): CanonicalTicketStatus => {
  if (status === 'OPEN') return 'AVAILABLE'
  if (status === 'BOOKED') return 'CONFIRMED'
  if (status === 'PENDING') return 'PENDING'
  if (status === 'CONFIRMED') return 'CONFIRMED'
  return 'AVAILABLE'
}
