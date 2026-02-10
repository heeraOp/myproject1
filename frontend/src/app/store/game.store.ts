import { create } from 'zustand'

type GameStatus = 'IDLE' | 'RUNNING' | 'FINISHED'

type GameStartedEvent = {
  type: 'game.started'
  calling_interval?: number
}

type NumberCalledEvent = {
  type: 'number.called'
  number: number
  called_numbers: number[]
}

type GameFinishedEvent = {
  type: 'game.finished'
}

type Winner = {
  id: number
  prize_type: string
  prize_amount?: number
  ticket_number: number
  player_name: string | null
  won_at?: string
}

type WinnerAnnouncedEvent = {
  type: 'winner.announced'
  winner: Winner
}

type BackendGameEvent = GameStartedEvent | NumberCalledEvent | GameFinishedEvent | WinnerAnnouncedEvent

type BackendGameStatePayload = {
  game: {
    id: string
    status: string
    calling_status: string
    calling_interval: number
    booking_status: string
  }
  called_numbers: number[]
  won_prizes: Array<{
    prize_type: string
    ticket_number: number
    player_name: string | null
  }>
}

type GameStateStore = {
  status: GameStatus
  callingInterval: number | null
  currentNumber: number | null
  calledNumbers: number[]
  winners: Winner[]
  lockedPrizeTypes: string[]
  isInteractionFrozen: boolean
  canSubmitClaims: boolean
  applyBackendEvent: (event: BackendGameEvent) => void
  replaceFromBackendState: (payload: BackendGameStatePayload) => void
  reset: () => void
}

const initialState = {
  status: 'IDLE' as GameStatus,
  callingInterval: null as number | null,
  currentNumber: null as number | null,
  calledNumbers: [] as number[],
  winners: [] as Winner[],
  lockedPrizeTypes: [] as string[],
  isInteractionFrozen: false as boolean,
  canSubmitClaims: true as boolean,
}

const isValidCalledNumbers = (numbers: unknown): numbers is number[] =>
  Array.isArray(numbers) && numbers.every((value) => Number.isInteger(value) && value >= 1 && value <= 90)

const isValidWinner = (winner: unknown): winner is Winner => {
  if (!winner || typeof winner !== 'object') return false
  const value = winner as Record<string, unknown>
  return Number.isInteger(value.id) && typeof value.prize_type === 'string'
}

const mapBackendStatus = (status: string): GameStatus => {
  if (status === 'RUNNING') return 'RUNNING'
  if (status === 'FINISHED') return 'FINISHED'
  return 'IDLE'
}

const toLockedPrizeTypes = (wonPrizes: Array<{ prize_type: string }>): string[] => {
  const set = new Set<string>()
  wonPrizes.forEach((prize) => {
    if (typeof prize.prize_type === 'string' && prize.prize_type) {
      set.add(prize.prize_type)
    }
  })
  return Array.from(set)
}

export const useGameStore = create<GameStateStore>((set) => ({
  ...initialState,
  applyBackendEvent: (event) =>
    set((state) => {
      if (event.type === 'game.started') {
        return {
          ...state,
          status: 'RUNNING',
          callingInterval:
            typeof event.calling_interval === 'number'
              ? event.calling_interval
              : state.callingInterval,
          isInteractionFrozen: false,
          canSubmitClaims: true,
        }
      }

      if (event.type === 'number.called') {
        // Once finished, ignore further number events to keep board frozen.
        if (state.status === 'FINISHED' || state.isInteractionFrozen) {
          return state
        }

        if (!isValidCalledNumbers(event.called_numbers)) {
          return state
        }

        const nextCalledNumbers = event.called_numbers
        const currentNumberFromList = nextCalledNumbers.length
          ? nextCalledNumbers[nextCalledNumbers.length - 1]
          : event.number

        return {
          ...state,
          currentNumber: currentNumberFromList,
          calledNumbers: nextCalledNumbers,
        }
      }

      if (event.type === 'game.finished') {
        return {
          ...state,
          status: 'FINISHED',
          currentNumber: null,
          calledNumbers: [],
          isInteractionFrozen: true,
          canSubmitClaims: false,
        }
      }

      if (event.type === 'winner.announced') {
        if (!isValidWinner(event.winner)) {
          return state
        }

        const winnerExists = state.winners.some((winner) => winner.id === event.winner.id)
        const lockedPrizeTypes = state.lockedPrizeTypes.includes(event.winner.prize_type)
          ? state.lockedPrizeTypes
          : [...state.lockedPrizeTypes, event.winner.prize_type]

        return {
          ...state,
          winners: winnerExists ? state.winners : [...state.winners, event.winner],
          lockedPrizeTypes,
        }
      }

      return state
    }),
  replaceFromBackendState: (payload) =>
    set(() => {
      const rawCalledNumbers = isValidCalledNumbers(payload?.called_numbers) ? payload.called_numbers : []
      const wonPrizes = Array.isArray(payload?.won_prizes) ? payload.won_prizes : []
      const mappedStatus = mapBackendStatus(payload?.game?.status ?? '')
      const calledNumbers = mappedStatus === 'FINISHED' ? [] : rawCalledNumbers
      const winnersFromState: Winner[] = wonPrizes.map((winner, index) => ({
        id: index + 1,
        prize_type: winner.prize_type,
        ticket_number: winner.ticket_number,
        player_name: winner.player_name ?? null,
      }))
      const lockedPrizeTypes = toLockedPrizeTypes(wonPrizes)

      return {
        status: mappedStatus,
        callingInterval:
          typeof payload?.game?.calling_interval === 'number' ? payload.game.calling_interval : null,
        currentNumber: calledNumbers.length ? calledNumbers[calledNumbers.length - 1] : null,
        calledNumbers,
        winners: winnersFromState,
        lockedPrizeTypes,
        isInteractionFrozen: mappedStatus === 'FINISHED',
        canSubmitClaims: mappedStatus !== 'FINISHED',
      }
    }),
  reset: () => set(initialState),
}))
