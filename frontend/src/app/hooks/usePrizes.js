import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/api/rest/client'

const mapPrize = (prize) => ({
  prize_type: prize.prize_type,
  amount: prize.amount,
  enabled: prize.enabled,
  claimed: prize.claimed,
  locked: Boolean(prize.claimed),
})

export const usePrizes = (gameId) => {
  const [prizes, setPrizes] = useState([])
  const [loading, setLoading] = useState(Boolean(gameId))
  const [error, setError] = useState(null)

  const fetchPrizes = useCallback(async () => {
    if (!gameId) {
      setPrizes([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await apiClient.get(`/prizes/game/${gameId}/`)
      const mappedPrizes = Array.isArray(response.data) ? response.data.map(mapPrize) : []
      setPrizes(mappedPrizes)
    } catch (err) {
      setError(err?.message || 'Unable to load prizes.')
      setPrizes([])
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => {
    void fetchPrizes()
  }, [fetchPrizes])

  return {
    prizes,
    loading,
    error,
    refetch: fetchPrizes,
  }
}
