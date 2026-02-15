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

export type WinnerAnnouncement = {
  id: string
  winner_name: string
  prize_name: string
  ticket_number: number | null
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

type StoreTicket = {
  ticket_number: number
  ticket_data: {
    rows: Array<Array<number | null>>
  }
  marked_numbers?: number[]
  final_immutable?: boolean
} & Record<string, unknown>

type GameStateStore = {
  gameId: string | null
  status: GameStatus
  callingInterval: number | null
  currentNumber: number | null
  calledNumbers: number[]
  tickets: StoreTicket[]
  winners: Winner[]
  winnerQueue: WinnerAnnouncement[]
  lockedPrizeTypes: string[]
  isInteractionFrozen: boolean
  canSubmitClaims: boolean
  applyBackendEvent: (event: BackendGameEvent) => void
  replaceFromBackendState: (payload: BackendGameStatePayload) => void
  setTicketsFromBackend: (gameId: string, tickets: StoreTicket[]) => void
  enqueueWinnerAnnouncement: (winner: WinnerAnnouncement) => void
  dismissWinnerAnnouncement: () => void
  clearWinnerQueue: () => void
  reset: () => void
}

const initialState = {
  gameId: null as string | null,
  status: 'IDLE' as GameStatus,
  callingInterval: null as number | null,
  currentNumber: null as number | null,
  calledNumbers: [] as number[],
  tickets: [] as StoreTicket[],
  winners: [] as Winner[],
  winnerQueue: [] as WinnerAnnouncement[],
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

const numbersInTicket = (ticket: StoreTicket): number[] => {
  const rows = ticket.ticket_data?.rows
  if (!Array.isArray(rows)) return []

  const values: number[] = []
  rows.forEach((row) => {
    if (!Array.isArray(row)) return
    row.forEach((cell) => {
      if (typeof cell === 'number' && Number.isInteger(cell)) {
        values.push(cell)
      }
    })
  })

  return values
}

const withMarkedNumbers = (ticket: StoreTicket, calledSet: Set<number>, isFinal: boolean): StoreTicket => ({
  ...ticket,
  marked_numbers: numbersInTicket(ticket).filter((value) => calledSet.has(value)),
  final_immutable: isFinal || Boolean(ticket.final_immutable),
})

const toWinnerAnnouncement = (winner: Winner): WinnerAnnouncement => ({
  id: `winner-${winner.id}`,
  winner_name: winner.player_name?.trim() || 'Player',
  prize_name: winner.prize_type,
  ticket_number: Number.isInteger(winner.ticket_number) ? winner.ticket_number : null,
})

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
        const calledSet = new Set(nextCalledNumbers)
        const nextTickets = state.tickets.map((ticket) =>
          withMarkedNumbers(ticket, calledSet, false),
        )

        return {
          ...state,
          currentNumber: currentNumberFromList,
          calledNumbers: nextCalledNumbers,
          tickets: nextTickets,
        }
      }

      if (event.type === 'game.finished') {
        const calledSet = new Set(state.calledNumbers)
        const frozenTickets = state.tickets.map((ticket) => withMarkedNumbers(ticket, calledSet, true))
        return {
          ...state,
          status: 'FINISHED',
          currentNumber: state.calledNumbers.length
            ? state.calledNumbers[state.calledNumbers.length - 1]
            : state.currentNumber,
          calledNumbers: state.calledNumbers,
          tickets: frozenTickets,
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
        const winnerQueue = winnerExists
          ? state.winnerQueue
          : [...state.winnerQueue, toWinnerAnnouncement(event.winner)]

        return {
          ...state,
          winners: winnerExists ? state.winners : [...state.winners, event.winner],
          winnerQueue,
          lockedPrizeTypes,
        }
      }

      return state
    }),
  replaceFromBackendState: (payload) =>
    set((state) => {
      const rawCalledNumbers = isValidCalledNumbers(payload?.called_numbers) ? payload.called_numbers : []
      const wonPrizes = Array.isArray(payload?.won_prizes) ? payload.won_prizes : []
      const mappedStatus = mapBackendStatus(payload?.game?.status ?? '')
      const calledNumbers = rawCalledNumbers
      const calledSet = new Set(calledNumbers)
      const winnersFromState: Winner[] = wonPrizes.map((winner, index) => ({
        id: index + 1,
        prize_type: winner.prize_type,
        ticket_number: winner.ticket_number,
        player_name: winner.player_name ?? null,
      }))
      const lockedPrizeTypes = toLockedPrizeTypes(wonPrizes)
      const nextTickets =
        state.gameId && payload?.game?.id && state.gameId === payload.game.id
          ? state.tickets.map((ticket) =>
              withMarkedNumbers(ticket, calledSet, mappedStatus === 'FINISHED'),
            )
          : state.tickets

      return {
        gameId: payload?.game?.id ?? state.gameId,
        status: mappedStatus,
        callingInterval:
          typeof payload?.game?.calling_interval === 'number' ? payload.game.calling_interval : null,
        currentNumber: calledNumbers.length ? calledNumbers[calledNumbers.length - 1] : null,
        calledNumbers,
        tickets: nextTickets,
        winners: winnersFromState,
        winnerQueue:
          state.gameId && payload?.game?.id && state.gameId !== payload.game.id
            ? []
            : state.winnerQueue,
        lockedPrizeTypes,
        isInteractionFrozen: mappedStatus === 'FINISHED',
        canSubmitClaims: mappedStatus !== 'FINISHED',
      }
    }),
  setTicketsFromBackend: (gameId, tickets) =>
    set((state) => {
      const calledSet = state.gameId === gameId ? new Set(state.calledNumbers) : new Set<number>()
      const isFinal = state.gameId === gameId && state.status === 'FINISHED'
      return {
        ...state,
        gameId,
        tickets: tickets.map((ticket) => withMarkedNumbers(ticket, calledSet, isFinal)),
      }
    }),
  enqueueWinnerAnnouncement: (winner) =>
    set((state) => ({
      ...state,
      winnerQueue: [...state.winnerQueue, winner],
    })),
  dismissWinnerAnnouncement: () =>
    set((state) => ({
      ...state,
      winnerQueue: state.winnerQueue.length > 0 ? state.winnerQueue.slice(1) : state.winnerQueue,
    })),
  clearWinnerQueue: () =>
    set((state) => ({
      ...state,
      winnerQueue: [],
    })),
  reset: () => set(initialState),
}))
