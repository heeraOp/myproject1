import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/api/rest/client'

const mapTicket = (ticket) => ({
  ticket_number: ticket.ticket_number,
  ticket_type: ticket.ticket_type,
  status: ticket.status,
  ticket_data: ticket.ticket_data,
  player_name: ticket.player_name,
})

export const useTicket = (gameId, ticketNumber) => {
  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(Boolean(gameId && ticketNumber))
  const [error, setError] = useState(null)

  const fetchTicket = useCallback(async () => {
    if (!gameId || ticketNumber === undefined || ticketNumber === null) {
      setTicket(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await apiClient.get(`/tickets/game/${gameId}/${ticketNumber}/`)
      setTicket(mapTicket(response.data))
    } catch (err) {
      setError(err?.message || 'Unable to load ticket.')
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }, [gameId, ticketNumber])

  useEffect(() => {
    void fetchTicket()
  }, [fetchTicket])

  return {
    ticket,
    loading,
    error,
    refetch: fetchTicket,
  }
}
