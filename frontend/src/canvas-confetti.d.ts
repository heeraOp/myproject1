declare module 'canvas-confetti' {
  export type ConfettiOptions = {
    particleCount?: number
    angle?: number
    spread?: number
    startVelocity?: number
    decay?: number
    gravity?: number
    drift?: number
    ticks?: number
    x?: number
    y?: number
    scalar?: number
    zIndex?: number
    origin?: {
      x?: number
      y?: number
    }
    colors?: string[]
  }

  const confetti: (options?: ConfettiOptions) => Promise<null> | null
  export default confetti
}
