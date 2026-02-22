import './SelectTicket.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCurrentAdminGame, bookTicketAsAdmin, getTickets, getGameSummary } from '@/api/rest/admin'
import { socketManager } from '@/api/websocket/socketManager'

const tickets = Array.from({ length: 84 }, (_, i) => i + 1)

type SelectTicketProps = {
  gameId?: string
}

type AdminBookingMode = 'RANDOM' | 'HALF_SHEET' | 'FULL_SHEET'

const readErrorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const responseData = (error as { response?: { data?: unknown } }).response?.data

    if (typeof responseData === 'string' && responseData.trim()) {
      const normalized = responseData.trim()
      if (normalized.startsWith('<!DOCTYPE html') || normalized.startsWith('<html')) {
        return 'Booking was processed but server returned an invalid error page. Please refresh ticket status.'
      }
      return normalized
    }

    if (typeof responseData === 'object' && responseData !== null) {
      const detail = (responseData as { detail?: unknown }).detail
      if (typeof detail === 'string' && detail.trim()) return detail
      if (Array.isArray(detail) && detail.length) {
        const text = detail.map((item) => String(item)).join(', ').trim()
        if (text) return text
      }

      const firstEntry = Object.entries(responseData as Record<string, unknown>)[0]
      if (firstEntry) {
        const [field, value] = firstEntry
        if (typeof value === 'string' && value.trim()) return `${field}: ${value}`
        if (Array.isArray(value) && value.length) {
          return `${field}: ${value.map((item) => String(item)).join(', ')}`
        }
      }
    }
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Booking failed.'
}

const SelectTicket = ({ gameId: preferredGameId }: SelectTicketProps) => {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [bookingMode, setBookingMode] = useState<AdminBookingMode>('RANDOM')
  const [ticketNumberInput, setTicketNumberInput] = useState('')
  const [activeGameId, setActiveGameId] = useState<string | null>(null)
  const [gameStatus, setGameStatus] = useState<string | null>(null)
  const [loadingGame, setLoadingGame] = useState(false)
  const [booking, setBooking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoadingGame(true)
      try {
        if (preferredGameId) {
          const summary = await getGameSummary(preferredGameId)
          if (!mounted) return
          setActiveGameId(preferredGameId)
          setGameStatus((summary?.game?.status ?? '').toString())
        } else {
          const current = await getCurrentAdminGame()
          if (!mounted) return
          setActiveGameId(current?.id ?? null)
          setGameStatus((current?.status ?? '').toString())
        }
      } catch {
        if (!mounted) return
        setActiveGameId(null)
        setGameStatus(null)
      } finally {
        if (mounted) setLoadingGame(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [preferredGameId])

  const normalizedGameStatus = useMemo(
    () => String(gameStatus ?? '').trim().toUpperCase(),
    [gameStatus],
  )
  const isGameEnded = normalizedGameStatus === 'FINISHED' || normalizedGameStatus === 'ENDED'
  const requiredSelectionCount = bookingMode === 'HALF_SHEET' ? 3 : bookingMode === 'FULL_SHEET' ? 6 : null
  const bookingModeLabel =
    bookingMode === 'HALF_SHEET' ? 'Half Sheet' : bookingMode === 'FULL_SHEET' ? 'Full Sheet' : 'Random'

  const bookingDisabled = useMemo(() => {
    if (!normalizedGameStatus) return true
    return (
      normalizedGameStatus === 'RUNNING' ||
      normalizedGameStatus === 'FINISHED' ||
      normalizedGameStatus === 'ENDED'
    )
  }, [normalizedGameStatus])

  // Track booked ticket numbers from backend snapshot
  const [bookedNumbers, setBookedNumbers] = useState<Set<number>>(new Set())

  const fetchTicketsSnapshot = useCallback(async () => {
    if (!activeGameId) return
    try {
      const snapshot = await getTickets(activeGameId)
      const booked = new Set<number>()
      snapshot.forEach((t) => {
        // consider any non-AVAILABLE status as booked/reserved
        if (String(t.status ?? '').toUpperCase() !== 'AVAILABLE') {
          if (typeof t.ticket_number === 'number') booked.add(t.ticket_number)
        }
      })
      setBookedNumbers(booked)
      // ensure selected doesn't include now-booked numbers
      setSelected((prev) => prev.filter((n) => !booked.has(n)))
    } catch {
      // ignore failures silently
    }
  }, [activeGameId])

  const handleBookingModeChange = useCallback((nextMode: AdminBookingMode) => {
    setBookingMode(nextMode)
    setError(null)
    setMessage(null)
    setSelected((prev) => {
      if (nextMode === 'RANDOM') return prev
      const required = nextMode === 'HALF_SHEET' ? 3 : 6
      return prev.slice(0, required)
    })
  }, [])

  const handleAddTicketNumbers = useCallback(() => {
    setError(null)
    setMessage(null)
    const raw = ticketNumberInput.trim()
    if (!raw) {
      setError('Enter ticket number(s), comma separated (example: 1,2,3).')
      return
    }

    const fragments = raw.split(',').map((item) => item.trim()).filter(Boolean)
    if (!fragments.length) {
      setError('Enter valid ticket numbers.')
      return
    }

    const numbersToAdd: number[] = []
    const seenInput = new Set<number>()
    for (const fragment of fragments) {
      if (!/^\d+$/.test(fragment)) {
        setError('Ticket input accepts only comma-separated numeric values.')
        return
      }
      const value = Number.parseInt(fragment, 10)
      if (!Number.isInteger(value) || value < 1 || value > tickets.length) {
        setError(`Ticket ${fragment} is outside available range (1-${tickets.length}).`)
        return
      }
      if (seenInput.has(value)) {
        setError(`Ticket ${value} is duplicated in input.`)
        return
      }
      if (bookedNumbers.has(value)) {
        setError(`Ticket ${value} is already booked.`)
        return
      }
      seenInput.add(value)
      numbersToAdd.push(value)
    }

    let merged = [...selected]
    numbersToAdd.forEach((value) => {
      if (!merged.includes(value)) merged.push(value)
    })
    merged = merged.sort((a, b) => a - b)

    if (requiredSelectionCount !== null && merged.length > requiredSelectionCount) {
      setError(`${bookingModeLabel} booking allows exactly ${requiredSelectionCount} tickets.`)
      merged = merged.slice(0, requiredSelectionCount)
    }

    setSelected(merged)
    setTicketNumberInput('')
  }, [bookingModeLabel, bookedNumbers, requiredSelectionCount, selected, ticketNumberInput])

  const toggleSelect = useCallback((num: number) => {
    if (bookingDisabled) return
    // don't allow selecting already booked tickets
    if (bookedNumbers.has(num)) return
    setSelected((prev) => {
      if (prev.includes(num)) return prev.filter((v) => v !== num)
      if (requiredSelectionCount !== null && prev.length >= requiredSelectionCount) {
        setError(`${bookingModeLabel} booking allows exactly ${requiredSelectionCount} tickets.`)
        return prev
      }
      setError(null)
      return [...prev, num].sort((a, b) => a - b)
    })
  }, [bookedNumbers, bookingDisabled, bookingModeLabel, requiredSelectionCount])

  // fetch tickets snapshot when game id becomes available
  useEffect(() => {
    if (activeGameId) void fetchTicketsSnapshot()
  }, [activeGameId, fetchTicketsSnapshot])

  useEffect(() => {
    const unsubGameStarted = socketManager.subscribe('game.started', () => {
      setGameStatus('RUNNING')
    })

    const unsubGameFinished = socketManager.subscribe('game.finished', () => {
      setGameStatus('FINISHED')
    })

    const handleGameUpdate = (event: unknown) => {
      const payload = (
        event as {
          data?: {
            game_id?: string
            changed_fields?: {
              status?: string
            }
          }
        }
      ).data

      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (eventGameId && activeGameId && eventGameId !== activeGameId) return

      const nextStatus = payload?.changed_fields?.status
      if (typeof nextStatus === 'string' && nextStatus.trim()) {
        setGameStatus(nextStatus)
      }
    }

    const refreshTicketsOnSocket = (event: unknown) => {
      const payload = (
        event as {
          data?: {
            game_id?: string
          }
        }
      ).data
      const eventGameId = typeof payload?.game_id === 'string' ? payload.game_id : ''
      if (eventGameId && activeGameId && eventGameId !== activeGameId) return
      void fetchTicketsSnapshot()
    }

    const unsubGameUpdate = socketManager.subscribe('game_update', handleGameUpdate)
    const unsubGameUpdateUpper = socketManager.subscribe('GAME_UPDATE', handleGameUpdate)
    const unsubTicketBooked = socketManager.subscribe('ticket_booked', refreshTicketsOnSocket)
    const unsubTicketsGenerated = socketManager.subscribe('tickets_generated', refreshTicketsOnSocket)

    return () => {
      unsubGameStarted()
      unsubGameFinished()
      unsubGameUpdate()
      unsubGameUpdateUpper()
      unsubTicketBooked()
      unsubTicketsGenerated()
    }
  }, [activeGameId, fetchTicketsSnapshot])

  const handleBook = async () => {
    setError(null)
    setMessage(null)
    if (bookingDisabled) {
      setError('Booking is disabled for the current game status.')
      return
    }
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!phone.trim()) {
      setError('Phone is required')
      return
    }
    if (!selected.length) {
      setError('Select at least one ticket number')
      return
    }
    if (requiredSelectionCount !== null && selected.length !== requiredSelectionCount) {
      setError(`${bookingModeLabel} booking requires exactly ${requiredSelectionCount} tickets.`)
      return
    }

    if (!activeGameId) {
      setError('No active game selected')
      return
    }

    setBooking(true)
    const toBook = [...selected].sort((a, b) => a - b)
    try {
      // Backend accepts single `ticket_number` for single-booking; when multiple
      // tickets are selected, send `ticket_numbers` array. Build payload accordingly.
      const payload: {
        game_id: string
        player_name: string
        player_phone: string
        ticket_number?: number
        ticket_numbers?: number[]
        ticket_numbers_csv?: string
        booking_mode?: 'RANDOM' | 'HALF_SHEET' | 'FULL_SHEET'
      } = {
        game_id: activeGameId,
        player_name: name.trim(),
        player_phone: phone.trim(),
        booking_mode: bookingMode,
      }
      payload.ticket_numbers = toBook
      if (toBook.length === 1) payload.ticket_number = toBook[0]

      const bookingResult = await bookTicketAsAdmin(payload)
      const privilegeLabel = bookingResult.eligible_privileges.full_sheet_bonus
        ? 'Full Sheet bonus eligible.'
        : bookingResult.eligible_privileges.half_sheet_bonus
          ? 'Half Sheet bonus eligible.'
          : 'Sheet bonus not enabled.'
      setMessage(`Booked ${toBook.length} ticket(s) successfully. ${privilegeLabel}`)
      // refresh snapshot to mark booked tickets
      await fetchTicketsSnapshot()
      try {
        // notify admin dashboard (minimal integration) with the original selection
        window.dispatchEvent(
          new CustomEvent('admin:ticket:booked', { detail: { gameId: activeGameId, ticket_numbers: toBook } }),
        )
      } catch {
        /* ignore */
      }
      // finally clear form and selection
      setName('')
      setPhone('')
      setSelected([])
      setTicketNumberInput('')
    } catch (errorValue: unknown) {
      console.error('Booking error', errorValue)
      let treatedAsSuccess = false
      try {
        const snapshot = await getTickets(activeGameId)
        const bookedSet = new Set<number>()
        snapshot.forEach((ticket) => {
          if (String(ticket.status ?? '').toUpperCase() !== 'AVAILABLE') {
            if (typeof ticket.ticket_number === 'number') bookedSet.add(ticket.ticket_number)
          }
        })

        const allBooked = toBook.length > 0 && toBook.every((ticketNumber) => bookedSet.has(ticketNumber))
        if (allBooked) {
          setBookedNumbers(bookedSet)
          setMessage(
            `Booked ${toBook.length} ticket(s) successfully. Server returned a malformed response, but booking is confirmed.`,
          )
          setError(null)
          setName('')
          setPhone('')
          setSelected([])
          setTicketNumberInput('')
          treatedAsSuccess = true
        }
      } catch {
        // Ignore status-refresh errors and surface original message below.
      }

      if (!treatedAsSuccess) {
        setError(readErrorMessage(errorValue))
      }
    } finally {
      setBooking(false)
    }
  }

  return (
    <div className="select-shell">
      <div className="select-header">
        <h1>SELECT TICKET</h1>
      </div>

      <div className="input-row">
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>

      <div className="ticket-types">
        <button
          type="button"
          className={bookingMode === 'RANDOM' ? 'active' : ''}
          onClick={() => handleBookingModeChange('RANDOM')}
        >
          Random ticket
        </button>
        <button
          type="button"
          className={bookingMode === 'HALF_SHEET' ? 'active' : ''}
          onClick={() => handleBookingModeChange('HALF_SHEET')}
        >
          Halfsheet ticket
        </button>
        <button
          type="button"
          className={bookingMode === 'FULL_SHEET' ? 'active' : ''}
          onClick={() => handleBookingModeChange('FULL_SHEET')}
        >
          Fullsheet ticket
        </button>
      </div>

      <div className="ticket-add">
        <input
          placeholder="Enter TNO (e.g. 1,2,3)"
          value={ticketNumberInput}
          onChange={(e) => setTicketNumberInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddTicketNumbers()
            }
          }}
        />
        <button type="button" onClick={handleAddTicketNumbers}>ADD</button>
      </div>

      <button className="book-now" onClick={handleBook} disabled={bookingDisabled || booking}>
        {booking ? 'BOOKING...' : 'BOOK NOW'}
      </button>

      {loadingGame ? <div style={{ padding: 8 }}>Loading game...</div> : null}
      {gameStatus ? <div style={{ padding: 8 }}>Game status: {String(gameStatus)}</div> : null}
      <div style={{ padding: 8 }}>Booking Type: {bookingModeLabel}</div>
      {error ? <div className="select-error">{error}</div> : null}
      {message ? <div className="select-success">{message}</div> : null}

      <div className="ticket-grid">
        {tickets.map((num) => {
          const isBooked = bookedNumbers.has(num)
          const isSelectable = !bookingDisabled && !isBooked
          const isSelected = isSelectable && selected.includes(num)
          const statusLabel = isGameEnded ? 'Ended' : isBooked ? 'Booked' : 'Available'
          const statusClass = isGameEnded ? 'ended' : isBooked ? 'booked' : 'available'
          return (
            <div
              key={num}
              className={`ticket-cell ticket-cell--${statusClass} ${isSelected ? 'selected' : ''}`}
              onClick={() => toggleSelect(num)}
              role="button"
              tabIndex={isSelectable ? 0 : -1}
              aria-disabled={!isSelectable}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggleSelect(num)
              }}
            >
              <span className="ticket-cell__number">{num}</span>
              <span className="ticket-cell__status">{statusLabel}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SelectTicket
