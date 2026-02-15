import { useEffect, useMemo } from 'react'
import confetti from 'canvas-confetti'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '@/app/store/game.store'
import './WinnerCelebrationOverlay.css'

const AUTO_DISMISS_MS = 7000

const PRIZE_LABEL_MAP: Record<string, string> = {
  FIRST_HOUSE: 'First Full House',
  SECOND_HOUSE: 'Second Full House',
  THIRD_HOUSE: 'Third Full House',
  FULL_SHEET: 'Full Sheet Bonus',
  HALF_SHEET: 'Half Sheet Bonus',
  TOP_LINE: 'Top Line',
  MIDDLE_LINE: 'Middle Line',
  BOTTOM_LINE: 'Bottom Line',
  BOX: 'Box Bonus',
  CORNER: 'Corner',
  STAR: 'Star',
  EARLY_5: 'Early 5',
  QUICK_6: 'Quick 6',
  QUICK_7: 'Quick 7',
}

const toReadablePrizeName = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return 'Prize'
  if (PRIZE_LABEL_MAP[trimmed]) return PRIZE_LABEL_MAP[trimmed]
  if (!trimmed.includes('_')) return trimmed
  return trimmed
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const fireWinnerConfetti = () => {
  const burst = {
    origin: { x: 0.5, y: 0.55 },
    colors: ['#ffd54f', '#ffeb3b', '#ffb300', '#fff8c5'],
    gravity: 0.95,
    ticks: 220,
  }

  confetti({
    ...burst,
    particleCount: 120,
    spread: 82,
    startVelocity: 55,
    scalar: 1.05,
  })

  window.setTimeout(() => {
    confetti({
      ...burst,
      particleCount: 80,
      spread: 118,
      startVelocity: 45,
      scalar: 0.9,
    })
  }, 180)
}

const playVictorySound = () => {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return

    const ctx = new AudioContextCtor()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(523.25, ctx.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.18)

    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.04)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.24)

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.24)
    oscillator.onended = () => {
      void ctx.close()
    }
  } catch {
    return
  }
}

const WinnerCelebrationOverlay = () => {
  const activeWinner = useGameStore((state) => state.winnerQueue[0] ?? null)
  const dismissWinnerAnnouncement = useGameStore((state) => state.dismissWinnerAnnouncement)

  const prizeLabel = useMemo(
    () => toReadablePrizeName(activeWinner?.prize_name ?? ''),
    [activeWinner?.prize_name],
  )

  useEffect(() => {
    if (!activeWinner) return
    fireWinnerConfetti()
    playVictorySound()
  }, [activeWinner?.id, activeWinner])

  useEffect(() => {
    if (!activeWinner) return
    const timer = window.setTimeout(() => {
      dismissWinnerAnnouncement()
    }, AUTO_DISMISS_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [activeWinner?.id, activeWinner, dismissWinnerAnnouncement])

  return (
    <AnimatePresence mode="wait">
      {activeWinner ? (
        <motion.div
          key={activeWinner.id}
          className="winner-celebration-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
        >
          <motion.div
            className="winner-celebration-burst"
            aria-hidden
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.15 }}
            transition={{ duration: 0.35 }}
          />

          <motion.section
            className="winner-celebration-card"
            role="status"
            aria-live="assertive"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 250, damping: 21 }}
          >
            <h3 className="winner-celebration-title">Winner Announced</h3>
            <p className="winner-celebration-line">
              👑 Winner: <strong>{activeWinner.winner_name}</strong>
            </p>
            <p className="winner-celebration-line">
              🏆 Prize: <strong>{prizeLabel}</strong>
            </p>
            <p className="winner-celebration-line">
              🎫 Ticket: <strong>{activeWinner.ticket_number ?? 'N/A'}</strong>
            </p>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export default WinnerCelebrationOverlay
