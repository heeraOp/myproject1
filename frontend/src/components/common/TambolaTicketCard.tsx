import type { PlayerTicket } from '@/types/backend/ticket'
import './TambolaTicketCard.css'

type TambolaTicketCardProps = {
  ticket: PlayerTicket
}

const TambolaTicketCard = ({ ticket }: TambolaTicketCardProps) => {
  const isBooked = ticket.status === 'BOOKED'
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
            row.map((value, cellIndex) => (
              <div className="ticket-cell" key={`${ticket.ticket_number}-${rowIndex}-${cellIndex}`}>
                {value ?? ''}
              </div>
            )),
          )}
        </div>
        <div className="ticket-side-strip" />
      </div>
    </article>
  )
}

export default TambolaTicketCard
