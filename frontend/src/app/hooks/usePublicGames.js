import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/api/rest/client'

const mapPublicGame = (game) => ({
  gameId: game.id,
  gameDate: game.date,
  status: game.status,
  ticketPrice: game.ticket_price,
  bookingStatus: game.booking_status,
})

export const usePublicGames = () => {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchGames = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Public side must only see the latest created game.
      const response = await apiClient.get('/games/public/latest/')
      const mappedGames = response.data ? [mapPublicGame(response.data)] : []
      setGames(mappedGames)
    } catch (err) {
      setError(err?.message || 'Unable to load public games.')
      setGames([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchGames()
  }, [fetchGames])

  return {
    games,
    loading,
    error,
    refetch: fetchGames,
  }
}
