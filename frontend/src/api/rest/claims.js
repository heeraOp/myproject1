import { apiClient } from '@/api/rest/client'
import { useGameStore } from '@/app/store/game.store'

const inFlightClaims = new Set()

const getClaimKey = (gameId, ticketNumber, prizeType) =>
  `${String(gameId)}:${String(ticketNumber)}:${String(prizeType)}`

export const isClaimSubmitting = (gameId, ticketNumber, prizeType) =>
  inFlightClaims.has(getClaimKey(gameId, ticketNumber, prizeType))

export const submitClaim = async (gameId, ticketNumber, prizeType) => {
  const gameState = useGameStore.getState()
  if (gameState.isInteractionFrozen || !gameState.canSubmitClaims || gameState.status === 'FINISHED') {
    return null
  }

  const claimKey = getClaimKey(gameId, ticketNumber, prizeType)

  if (inFlightClaims.has(claimKey)) {
    return null
  }

  inFlightClaims.add(claimKey)

  try {
    const response = await apiClient.post('/claims/submit/', {
      game_id: gameId,
      ticket_number: ticketNumber,
      prize_type: prizeType,
    })

    return response.data
  } finally {
    inFlightClaims.delete(claimKey)
  }
}
