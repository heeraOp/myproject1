import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/api/rest/client'

const mapTicket = (ticket) => ({
  ticket_number: ticket.ticket_number,
  ticket_type: ticket.ticket_type,
  status: ticket.status,
  ticket_data: ticket.ticket_data,
  player_name: ticket.player_name,
})

export const useGameTickets = (gameId, playerPhone) => {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(Boolean(gameId))
  const [error, setError] = useState(null)

  const fetchTickets = useCallback(async () => {
    if (!gameId) {
      setTickets([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Public ticket feed: avoid exposing other players' personal data.
      const response = await apiClient.get(`/tickets/game/${gameId}/public/`, {
        params: playerPhone ? { player_phone: playerPhone } : undefined,
      })
      const mappedTickets = Array.isArray(response.data) ? response.data.map(mapTicket) : []
      setTickets(mappedTickets)
    } catch (err) {
      setError(err?.message || 'Unable to load tickets.')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => {
    void fetchTickets()
  }, [fetchTickets])

  return {
    tickets,
    loading,
    error,
    refetch: fetchTickets,
  }
}
