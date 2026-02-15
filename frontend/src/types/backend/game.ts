export type GameStatus = 'CREATED' | 'BOOKING_OPEN' | 'RUNNING' | 'PAUSED' | 'FINISHED'
export type BookingStatus = 'OPEN' | 'CLOSED'
export type WebsiteStatus = 'OPEN' | 'CLOSED'
export type ThemeName = 'dark' | 'light' | 'festival-gold' | 'festival-diwali'

export type GameAgent = {
  id: number
  name: string
  whatsapp_number: string
}

export type PublicGame = {
  id: string
  name: string
  date: string
  status: GameStatus
  ticket_price: number
  booking_status: BookingStatus
  website_status: WebsiteStatus
  agent?: GameAgent | null
  active_theme?: ThemeName
  is_active?: boolean
}
