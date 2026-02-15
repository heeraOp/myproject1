export type TicketStatus = 'OPEN' | 'BOOKED'
export type TicketType = 'RANDOM' | 'HALF_SHEET' | 'FULL_SHEET'

export type TicketData = {
  rows: Array<Array<number | null>>
}

export type PlayerTicket = {
  ticket_number: number
  ticket_type: TicketType
  status: TicketStatus
  ticket_data: TicketData
  player_name: string | null
  marked_numbers: number[]
  final_immutable: boolean
}
