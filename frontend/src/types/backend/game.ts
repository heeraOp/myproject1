export type GameStatus = 'CREATED' | 'BOOKING_OPEN' | 'RUNNING' | 'PAUSED' | 'FINISHED'
export type BookingStatus = 'OPEN' | 'CLOSED'
export type WebsiteStatus = 'OPEN' | 'CLOSED'

export type PublicGame = {
  id: string
  date: string
  status: GameStatus
  ticket_price: number
  booking_status: BookingStatus
  website_status: WebsiteStatus
}
