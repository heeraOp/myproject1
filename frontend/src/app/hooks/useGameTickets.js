import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/api/rest/client'

const mapTicket = (ticket) => ({
  ticket_number: ticket.ticket_number,
  ticket_type: ticket.ticket_type,
  status: ticket.status,
  ticket_data: ticket.ticket_data,
  player_name: ticket.player_name,
  marked_numbers: Array.isArray(ticket.marked_numbers) ? ticket.marked_numbers : [],
  final_immutable: Boolean(ticket.final_immutable),
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
      // Canonical ticket snapshot used across admin/player.
      const response = await apiClient.get(`/games/${gameId}/tickets/`, {
        params: playerPhone ? { player_phone: playerPhone } : undefined,
      })
      const snapshotTickets = Array.isArray(response.data?.tickets) ? response.data.tickets : []
      const mappedTickets = snapshotTickets.map(mapTicket)
      setTickets(mappedTickets)
    } catch (err) {
      setError(err?.message || 'Unable to load tickets.')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [gameId, playerPhone])

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
