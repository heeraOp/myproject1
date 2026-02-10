import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '@/app/store/game.store'
import { useVoiceModeStore } from '@/app/store/voiceMode.store'
import { getBingoCallText, getFunnyBingoSpeechText, getFunnyVoiceStyle } from '@/utils/bingoCalls'

type BingoCallerState = {
  announcement: string
  number: number | null
  isAudioReady: boolean
  isSpeechSupported: boolean
  unlockAudio: () => void
}

export const useBingoCaller = (): BingoCallerState => {
  const status = useGameStore((state) => state.status)
  const calledNumbers = useGameStore((state) => state.calledNumbers)
  const voiceMode = useVoiceModeStore((state) => state.mode)
  const [announcement, setAnnouncement] = useState('')
  const [announcementNumber, setAnnouncementNumber] = useState<number | null>(null)
  const [isAudioReady, setIsAudioReady] = useState(false)
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)

  const initializedRef = useRef(false)
  const previousCalledSetRef = useRef<Set<number>>(new Set())
  const clearTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('speechSynthesis' in window)) return
    setIsSpeechSupported(true)
    try {
      window.speechSynthesis.getVoices()
    } catch {
      // Ignore voice preload failures.
    }
  }, [])

  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance('Audio enabled')
      utterance.rate = 1
      utterance.pitch = 1
      utterance.volume = 0.9
      window.speechSynthesis.speak(utterance)
      setIsAudioReady(true)
    } catch {
      // Ignore unlock failures.
    }
  }, [])

  useEffect(() => {
    if (!initializedRef.current) {
      previousCalledSetRef.current = new Set(calledNumbers)
      initializedRef.current = true
      return
    }

    if (calledNumbers.length === 0) {
      previousCalledSetRef.current = new Set()
      setAnnouncement('')
      setAnnouncementNumber(null)
      return
    }

    if (status !== 'RUNNING') {
      previousCalledSetRef.current = new Set(calledNumbers)
      return
    }

    const previousSet = previousCalledSetRef.current
    let detectedNumber: number | null = null
    for (const number of calledNumbers) {
      if (!previousSet.has(number)) {
        detectedNumber = number
      }
    }
    previousCalledSetRef.current = new Set(calledNumbers)

    if (detectedNumber === null || !Number.isInteger(detectedNumber)) return
    const calledNumber = detectedNumber
    const text = getBingoCallText(calledNumber)
    if (!text) return

    setAnnouncement(text)
    setAnnouncementNumber(calledNumber)

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
        window.speechSynthesis.resume()
        let speechText = text
        let rate = 0.95
        let pitch = 1

        if (voiceMode === 'FUNNY') {
          speechText = getFunnyBingoSpeechText(calledNumber) || text
          const style = getFunnyVoiceStyle(calledNumber)
          rate = style.rate
          pitch = style.pitch
        } else if (voiceMode === 'CRAZY') {
          speechText = `Boom boom bingo! ${text}. Repeat! ${text}.`
          rate = 1.12 + (calledNumber % 3) * 0.08
          pitch = 1.35 + (calledNumber % 4) * 0.1
        }

        const utterance = new SpeechSynthesisUtterance(speechText || text)
        const voices = window.speechSynthesis.getVoices()
        const preferredVoice =
          voices.find((voice) =>
            /(fred|samantha|zira|david|daniel|karen|google uk english male)/i.test(voice.name),
          ) || voices[calledNumber % Math.max(1, voices.length)]
        if (preferredVoice) {
          utterance.voice = preferredVoice
        }
        utterance.rate = Math.min(1.4, rate)
        utterance.pitch = Math.min(1.8, pitch)
        utterance.volume = 1
        window.speechSynthesis.speak(utterance)
        setIsAudioReady(true)
      } catch {
        // Keep UI announcement even when speech API is blocked.
      }
    }

    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    clearTimerRef.current = window.setTimeout(() => {
      setAnnouncement('')
      setAnnouncementNumber(null)
    }, 3000)
  }, [calledNumbers, status, voiceMode])

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current)
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  return useMemo(
    () => ({
      announcement,
      number: announcementNumber,
      isAudioReady,
      isSpeechSupported,
      unlockAudio,
    }),
    [announcement, announcementNumber, isAudioReady, isSpeechSupported, unlockAudio],
  )
}
