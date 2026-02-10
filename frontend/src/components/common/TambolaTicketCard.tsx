import { useMemo } from 'react'
import type { PlayerTicket } from '@/types/backend/ticket'
import './TambolaTicketCard.css'

type TambolaTicketCardProps = {
  ticket: PlayerTicket
  calledNumbers?: number[]
}

const TambolaTicketCard = ({ ticket, calledNumbers }: TambolaTicketCardProps) => {
  const isBooked = ticket.status === 'BOOKED'
  const calledSet = useMemo(() => new Set(calledNumbers ?? []), [calledNumbers])
  const ownerLabel = isBooked
    ? ticket.player_name && ticket.player_name.trim().length > 0
      ? ticket.player_name
      : 'booked'
    : 'open'
  // Append player name to BOOKED status without changing layout.
  const statusLabel = isBooked
    ? ticket.player_name && ticket.player_name.trim().length > 0
      ? `BOOKED : ${ticket.player_name}`
      : 'BOOKED'
    : 'OPEN'

  return (
    <article className="ticket-card">
      <header className="ticket-card__header">
        <span className="ticket-owner">
          {ticket.ticket_number}:({ownerLabel})
        </span>
        <span className={`ticket-status ${isBooked ? 'booked' : 'open'}`}>
          {statusLabel}
        </span>
      </header>
      <div className="ticket-grid-wrapper">
        <div className="ticket-grid">
          {ticket.ticket_data.rows.map((row, rowIndex) =>
            row.map((value, cellIndex) => {
              const isCalled = isBooked && value !== null && calledSet.has(value)
              return (
                <div
                  className={`ticket-cell ${isCalled ? 'called' : ''}`}
                  key={`${ticket.ticket_number}-${rowIndex}-${cellIndex}`}
                >
                  {value ?? ''}
                </div>
              )
            }),
          )}
        </div>
        <div className="ticket-side-strip" />
      </div>
    </article>
  )
}

export default TambolaTicketCard
