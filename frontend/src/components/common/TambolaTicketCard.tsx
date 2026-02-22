import { memo, useMemo } from 'react'
import { normalizeTicketStatus, type PlayerTicket } from '@/types/backend/ticket'
import './TambolaTicketCard.css'

type TambolaTicketCardProps = {
  ticket: PlayerTicket
  variant?: 'admin' | 'player'
  onRequestBooking?: (ticket: PlayerTicket) => void
  requestingTicketNumber?: number | null
  bookingClosed?: boolean
}

const TambolaTicketCard = ({
  ticket,
  variant = 'admin',
  onRequestBooking,
  requestingTicketNumber = null,
  bookingClosed = false,
}: TambolaTicketCardProps) => {
  const normalizedStatus = normalizeTicketStatus(ticket.status)
  const isConfirmed = normalizedStatus === 'CONFIRMED'
  const isPending = normalizedStatus === 'PENDING'
  const isAvailable = normalizedStatus === 'AVAILABLE'
  const isRequesting = requestingTicketNumber === ticket.ticket_number
  const markedSet = useMemo(() => new Set(ticket.marked_numbers ?? []), [ticket.marked_numbers])
  const normalizedPlayerName = ticket.player_name?.trim() || ''
  const requestedByName = ticket.requested_by_name?.trim() || ''
  const requestedByWhatsapp = ticket.requested_by_whatsapp?.trim() || ''

  let ownerLabel = `${ticket.ticket_number}:(available)`
  let statusLabel = 'AVAILABLE'

  if (variant === 'player') {
    let displayName = bookingClosed && isAvailable ? 'ENDED' : 'AVAILABLE'
    if (isConfirmed && normalizedPlayerName) {
      displayName = normalizedPlayerName
    } else if (isPending && requestedByName) {
      displayName = requestedByName
    }
    ownerLabel = `${ticket.ticket_number}:(${displayName})`
    statusLabel = isConfirmed ? 'Booked ✅' : isPending ? 'Pending ⏳' : bookingClosed && isAvailable ? 'ENDED' : 'AVAILABLE'
  } else {
    const ownerName = isConfirmed ? (normalizedPlayerName || 'booked') : isPending ? 'pending' : 'available'
    ownerLabel = `${ticket.ticket_number}:(${ownerName})`
    statusLabel = isConfirmed
      ? normalizedPlayerName
        ? `BOOKED : ${normalizedPlayerName}`
        : 'BOOKED'
      : isPending
        ? requestedByName
          ? `PENDING : ${requestedByName}`
          : 'PENDING'
        : 'AVAILABLE'
  }

  return (
    <article className="tambola-ticket-card">
      <header className="tambola-ticket-card__header">
        <span className="tambola-ticket-card__owner">{ownerLabel}</span>
        {variant === 'player' && isAvailable && onRequestBooking ? (
          <button
            type="button"
            className="tambola-ticket-card__request-btn"
            onClick={() => onRequestBooking(ticket)}
            disabled={isRequesting || bookingClosed}
          >
            {isRequesting ? 'Requesting...' : bookingClosed ? 'Booking Closed' : 'Book Ticket'}
          </button>
        ) : (
          <span
            className={`tambola-ticket-card__status ${
              isConfirmed ? 'booked' : isPending ? 'pending' : 'open'
            }`}
          >
            {statusLabel}
          </span>
        )}
      </header>
      {variant === 'player' && isPending && (requestedByName || requestedByWhatsapp) ? (
        <div className="tambola-ticket-card__pending-meta">
          {requestedByName ? `Name: ${requestedByName}` : ''} {requestedByWhatsapp ? `WhatsApp: ${requestedByWhatsapp}` : ''}
        </div>
      ) : null}
      <div className="tambola-ticket-card__body">
        <div className="tambola-ticket-card__grid">
          {ticket.ticket_data.rows.map((row, rowIndex) =>
            row.map((value, cellIndex) => {
              const isMarked = value !== null && markedSet.has(value)
              return (
                <div
                  className={`tambola-ticket-card__cell ${isMarked ? 'is-called' : ''} ${value === null ? 'is-empty' : ''}`}
                  key={`${ticket.ticket_number}-${rowIndex}-${cellIndex}`}
                >
                  {value ?? ''}
                </div>
              )
            }),
          )}
        </div>
      </div>
    </article>
  )
}

export default memo(TambolaTicketCard)
