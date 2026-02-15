import { useMemo } from 'react'
import type { PlayerTicket } from '@/types/backend/ticket'
import './TambolaTicketCard.css'

type TambolaTicketCardProps = {
  ticket: PlayerTicket
  variant?: 'admin' | 'player'
}

const TambolaTicketCard = ({ ticket, variant = 'admin' }: TambolaTicketCardProps) => {
  const isBooked = ticket.status === 'BOOKED'
  const markedSet = useMemo(() => new Set(ticket.marked_numbers ?? []), [ticket.marked_numbers])
  const normalizedPlayerName = ticket.player_name?.trim() || ''

  let ownerLabel = `${ticket.ticket_number}:(open)`
  let statusLabel = 'OPEN'

  if (variant === 'player') {
    let displayName = 'AVAILABLE'
    if (ticket.status === 'BOOKED' && normalizedPlayerName) {
      displayName = normalizedPlayerName
    }
    ownerLabel = `${ticket.ticket_number}:(${displayName})`
    statusLabel = ticket.status === 'BOOKED' ? `BOOKED : ${displayName}` : 'AVAILABLE'
  } else {
    const ownerName = isBooked ? (normalizedPlayerName || 'booked') : 'open'
    ownerLabel = `${ticket.ticket_number}:(${ownerName})`
    statusLabel = isBooked ? (normalizedPlayerName ? `BOOKED : ${normalizedPlayerName}` : 'BOOKED') : 'OPEN'
  }

  return (
    <article className="ticket-card">
      <header className="ticket-card__header">
        <span className="ticket-owner">{ownerLabel}</span>
        <span className={`ticket-status ${isBooked ? 'booked' : 'open'}`}>
          {statusLabel}
        </span>
      </header>
      <div className="ticket-grid-wrapper">
        <div className="ticket-grid">
          {ticket.ticket_data.rows.map((row, rowIndex) =>
            row.map((value, cellIndex) => {
              const isMarked = value !== null && markedSet.has(value)
              return (
                <div
                  className={`ticket-cell ${isMarked ? 'called' : ''}`}
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
