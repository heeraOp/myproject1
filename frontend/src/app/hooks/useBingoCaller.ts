import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '@/app/store/game.store'
import { useVoiceModeStore } from '@/app/store/voiceMode.store'
import { getBingoCallText, getFunnyBingoSpeechText, getFunnyVoiceStyle } from '@/utils/bingoCalls'

type BingoCallerState = {
  announcement: string
  number: number | null
  isAudioReady: boolean
  isSpeechSupported: boolean
  audioBlockedMessage: string | null
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
  const [audioBlockedMessage, setAudioBlockedMessage] = useState<string | null>(null)

  const initializedRef = useRef(false)
  const previousCalledSetRef = useRef<Set<number>>(new Set())
  const clearTimerRef = useRef<number | null>(null)
  const healthCheckTimeoutRef = useRef<number | null>(null)
  const healthCheckInFlightRef = useRef(false)

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

  const resetSpeechEngine = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!('speechSynthesis' in window)) return
    try {
      // Browser audio engines can get stuck; cancel clears residual state.
      window.speechSynthesis.cancel()
      window.speechSynthesis.resume()
      window.speechSynthesis.getVoices()
    } catch {
      // Ignore reset failures.
    }
  }, [])

  const runAudioHealthCheck = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!('speechSynthesis' in window)) return
    if (healthCheckInFlightRef.current) return
    healthCheckInFlightRef.current = true

    let started = false
    const utterance = new SpeechSynthesisUtterance(' ')
    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 0.001

    const cleanup = () => {
      healthCheckInFlightRef.current = false
      if (healthCheckTimeoutRef.current) {
        window.clearTimeout(healthCheckTimeoutRef.current)
        healthCheckTimeoutRef.current = null
      }
      utterance.onstart = null
      utterance.onerror = null
    }

    utterance.onstart = () => {
      started = true
      // Audio is working; clear any blocked warning.
      setAudioBlockedMessage(null)
      cleanup()
    }
    utterance.onerror = () => {
      // Browser blocked speech output.
      setAudioBlockedMessage(
        'Sound is blocked by your browser or system. Please unmute your browser, click anywhere on the page, and press Enable Sound.',
      )
      cleanup()
    }

    // Cancel any residual speech before the test utterance.
    resetSpeechEngine()
    window.speechSynthesis.speak(utterance)

    healthCheckTimeoutRef.current = window.setTimeout(() => {
      if (!started) {
        // onstart never fired -> treat as blocked audio.
        setAudioBlockedMessage(
          'Sound is blocked by your browser or system. Please unmute your browser, click anywhere on the page, and press Enable Sound.',
        )
      }
      cleanup()
    }, 800)
  }, [resetSpeechEngine])

  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!('speechSynthesis' in window)) return
    try {
      // User gesture: force audio context to resume with a tiny silent utterance.
      resetSpeechEngine()
      const utterance = new SpeechSynthesisUtterance(' ')
      utterance.rate = 1
      utterance.pitch = 1
      utterance.volume = 0.001
      window.speechSynthesis.speak(utterance)
      // Follow with a normal (audible) cue so user knows it's enabled.
      const confirm = new SpeechSynthesisUtterance('Audio enabled')
      confirm.rate = 1
      confirm.pitch = 1
      confirm.volume = 1
      window.speechSynthesis.speak(confirm)
      setIsAudioReady(true)
      // Run a quick health check to detect blocked output.
      runAudioHealthCheck()
    } catch {
      // Ignore unlock failures.
    }
  }, [resetSpeechEngine, runAudioHealthCheck])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('speechSynthesis' in window)) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isAudioReady) {
        // Reset engine when tab regains focus to avoid silent failures.
        resetSpeechEngine()
        runAudioHealthCheck()
      }
    }
    const handleFocus = () => {
      if (isAudioReady) {
        resetSpeechEngine()
        runAudioHealthCheck()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
    }
  }, [isAudioReady, resetSpeechEngine, runAudioHealthCheck])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleUserClick = () => {
      if (audioBlockedMessage) {
        // User gesture retry: attempt to resume speech safely.
        runAudioHealthCheck()
      }
    }
    window.addEventListener('click', handleUserClick)
    return () => {
      window.removeEventListener('click', handleUserClick)
    }
  }, [audioBlockedMessage, runAudioHealthCheck])

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
        // Always reset before speaking to avoid stale audio engine state.
        resetSpeechEngine()
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
      audioBlockedMessage,
      unlockAudio,
    }),
    [
      announcement,
      announcementNumber,
      isAudioReady,
      isSpeechSupported,
      audioBlockedMessage,
      unlockAudio,
    ],
  )
}
