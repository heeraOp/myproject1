import { useEffect, useRef } from 'react'
import confetti from 'canvas-confetti'
import { playAudioElementSafely } from '@/utils/audioEngine'
import './WinnerPopup.css'

type WinnerPopupProps = {
  visible: boolean
  winnerName: string
  prizeType: string
}

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

const toPrizeLabel = (value: string): string => {
  const key = value.trim().toUpperCase()
  return PRIZE_LABEL_MAP[key] || value || 'Prize'
}

const WinnerPopup = ({ visible, winnerName, prizeType }: WinnerPopupProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/sounds/winner.mp3')
      audioRef.current.preload = 'auto'
    }
  }, [])

  useEffect(() => {
    if (!visible) return

    confetti({
      particleCount: 130,
      spread: 92,
      startVelocity: 45,
      origin: { y: 0.64 },
      colors: ['#ff2d2d', '#ffd54f', '#ffffff', '#35d76f'],
    })

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      void playAudioElementSafely(audioRef.current)
    }
  }, [visible, winnerName, prizeType])

  if (!visible) return null

  return (
    <div className="winner-popup-overlay" role="status" aria-live="assertive">
      <section className="winner-popup-card">
        <h3>Winner Announced</h3>
        <p>
          <strong>{winnerName || 'Player'}</strong>
        </p>
        <p>{toPrizeLabel(prizeType)}</p>
      </section>
    </div>
  )
}

export default WinnerPopup
