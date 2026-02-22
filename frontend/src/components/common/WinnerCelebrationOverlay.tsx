import { useEffect, useMemo, useRef } from 'react'
import confetti from 'canvas-confetti'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '@/app/store/game.store'
import { initGlobalAudioUnlock, playAudioElementSafely } from '@/utils/audioEngine'
import { playWinnerSoundFlow } from '@/utils/soundManager'
import './WinnerCelebrationOverlay.css'

const AUTO_DISMISS_MS = 3000

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

const WinnerCelebrationOverlay = () => {
  const activeWinner = useGameStore((state) => state.winnerQueue[0] ?? null)
  const dismissWinnerAnnouncement = useGameStore((state) => state.dismissWinnerAnnouncement)
  const timeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const prizeLabel = useMemo(
    () => toReadablePrizeName(activeWinner?.prize_name ?? ''),
    [activeWinner?.prize_name],
  )

  useEffect(() => {
    initGlobalAudioUnlock()
    if (!audioRef.current) {
      audioRef.current = new Audio('/sounds/winner.mp3')
      audioRef.current.preload = 'auto'
    }
  }, [])

  useEffect(() => {
    if (!activeWinner) return
    fireWinnerConfetti()

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = window.setTimeout(() => {
      dismissWinnerAnnouncement()
    }, AUTO_DISMISS_MS)

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      void playAudioElementSafely(audioRef.current)
      const announcementText = `${activeWinner.winner_name ?? 'Player'} has won ${prizeLabel}`
      void playWinnerSoundFlow(announcementText)
    }
  }, [activeWinner?.id, activeWinner, dismissWinnerAnnouncement])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [])

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
