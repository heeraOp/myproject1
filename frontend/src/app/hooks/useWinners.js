import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/api/rest/client'

const mapWinner = (winner) => ({
  id: winner.id,
  prize_type: winner.prize_type,
  prize_amount: winner.prize_amount,
  ticket_number: winner.ticket_number,
  player_name: winner.player_name,
  won_at: winner.won_at,
})

const appendOnlyMerge = (existing, incoming) => {
  const knownIds = new Set(existing.map((winner) => winner.id))
  const next = [...existing]

  incoming.forEach((winner) => {
    if (!knownIds.has(winner.id)) {
      next.push(winner)
      knownIds.add(winner.id)
    }
  })

  return next
}

export const useWinners = (gameId) => {
  const [winners, setWinners] = useState([])
  const [loading, setLoading] = useState(Boolean(gameId))
  const [error, setError] = useState(null)

  const fetchWinners = useCallback(async () => {
    if (!gameId) {
      setWinners([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await apiClient.get(`/claims/game/${gameId}/winners/`)
      const mappedWinners = Array.isArray(response.data) ? response.data.map(mapWinner) : []
      setWinners((current) => appendOnlyMerge(current, mappedWinners))
    } catch (err) {
      setError(err?.message || 'Unable to load winners.')
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => {
    void fetchWinners()
  }, [fetchWinners])

  return {
    winners,
    loading,
    error,
    refetch: fetchWinners,
  }
}
