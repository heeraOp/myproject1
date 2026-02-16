import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '@/app/store/game.store'
import { useVoiceModeStore, type VoiceMode } from '@/app/store/voiceMode.store'
import {
  initGlobalAudioUnlock,
  isAudioUnlocked,
  resumeGlobalAudioContext,
  subscribeAudioUnlock,
  unlockAudioFromUserGesture,
} from '@/utils/audioEngine'
import { getBingoCallText } from '@/utils/bingoCalls'
import { pickVoiceForMode, resolveSpeechConfig } from '@/voices/voiceRegistry'

type BingoCallerState = {
  announcement: string
  number: number | null
  audioUnlocked: boolean
  isAudioReady: boolean
  isSpeechSupported: boolean
  audioBlockedMessage: string | null
  unlockAudio: () => void
}

type PendingSpeechAnnouncement = {
  number: number
  text: string
  voiceMode: VoiceMode
}

export const useBingoCaller = (): BingoCallerState => {
  const status = useGameStore((state) => state.status)
  const calledNumbers = useGameStore((state) => state.calledNumbers)
  const voiceMode = useVoiceModeStore((state) => state.mode)
  const [announcement, setAnnouncement] = useState('')
  const [announcementNumber, setAnnouncementNumber] = useState<number | null>(null)
  const [audioUnlocked, setAudioUnlocked] = useState(isAudioUnlocked())
  const [isAudioReady, setIsAudioReady] = useState(false)
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)
  const [audioBlockedMessage, setAudioBlockedMessage] = useState<string | null>(null)

  const initializedRef = useRef(false)
  const previousCalledSetRef = useRef<Set<number>>(new Set())
  const clearTimerRef = useRef<number | null>(null)
  const healthCheckTimeoutRef = useRef<number | null>(null)
  const healthCheckInFlightRef = useRef(false)
  const pendingSpeechRef = useRef<PendingSpeechAnnouncement | null>(null)

  useEffect(() => {
    initGlobalAudioUnlock()
    const unsubscribe = subscribeAudioUnlock((unlocked) => {
      setAudioUnlocked(unlocked)
      if (!unlocked) {
        setIsAudioReady(false)
      }
    })
    return () => {
      unsubscribe()
    }
  }, [])

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
    void resumeGlobalAudioContext()
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
    if (!isAudioUnlocked()) return
    if (healthCheckInFlightRef.current) return
    healthCheckInFlightRef.current = true
    void (async () => {
      await resumeGlobalAudioContext()

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
        setIsAudioReady(true)
        cleanup()
      }
      utterance.onerror = () => {
        // Browser blocked speech output.
        setIsAudioReady(false)
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
          setIsAudioReady(false)
          setAudioBlockedMessage(
            'Sound is blocked by your browser or system. Please unmute your browser, click anywhere on the page, and press Enable Sound.',
          )
        }
        cleanup()
      }, 800)
    })()
  }, [resetSpeechEngine])

  useEffect(() => {
    if (!audioUnlocked) {
      setIsAudioReady(false)
      return
    }
    runAudioHealthCheck()
  }, [audioUnlocked, runAudioHealthCheck])

  const speakAnnouncement = useCallback(
    async (calledNumber: number, text: string, mode: VoiceMode): Promise<boolean> => {
      if (typeof window === 'undefined') return false
      if (!('speechSynthesis' in window)) return false
      if (!audioUnlocked) return false

      const resumed = await resumeGlobalAudioContext()
      if (!resumed || !isAudioUnlocked()) return false

      try {
        // Always reset before speaking to avoid stale audio engine state.
        resetSpeechEngine()
        const { speechText, rate, pitch } = resolveSpeechConfig(mode, calledNumber, text)
        const utterance = new SpeechSynthesisUtterance(speechText || text)
        const voices = window.speechSynthesis.getVoices()
        const preferredVoice = pickVoiceForMode(voices, mode, calledNumber)
        if (preferredVoice) {
          utterance.voice = preferredVoice
        }
        utterance.rate = Math.min(1.45, Math.max(0.75, rate))
        utterance.pitch = Math.min(2, Math.max(0.65, pitch))
        utterance.volume = 1
        window.speechSynthesis.speak(utterance)
        setIsAudioReady(true)
        setAudioBlockedMessage(null)
        return true
      } catch {
        return false
      }
    },
    [audioUnlocked, resetSpeechEngine],
  )

  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!('speechSynthesis' in window)) return
    void (async () => {
      const unlocked = await unlockAudioFromUserGesture()
      setAudioUnlocked(unlocked)
      if (!unlocked) return
      try {
        // User gesture: force audio engine to resume with a tiny silent utterance.
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
        // Run a quick health check to detect blocked output.
        runAudioHealthCheck()
      } catch {
        // Ignore unlock failures.
      }
    })()
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
      if (audioBlockedMessage || !audioUnlocked) {
        // User gesture retry: attempt to resume speech safely.
        void (async () => {
          const unlocked = await unlockAudioFromUserGesture()
          setAudioUnlocked(unlocked)
          if (unlocked) {
            runAudioHealthCheck()
          }
        })()
      }
    }
    window.addEventListener('click', handleUserClick)
    window.addEventListener('touchstart', handleUserClick)
    return () => {
      window.removeEventListener('click', handleUserClick)
      window.removeEventListener('touchstart', handleUserClick)
    }
  }, [audioBlockedMessage, audioUnlocked, runAudioHealthCheck])

  useEffect(() => {
    if (!audioUnlocked) return
    if (!pendingSpeechRef.current) return
    const pending = pendingSpeechRef.current
    pendingSpeechRef.current = null
    void speakAnnouncement(pending.number, pending.text, pending.voiceMode)
  }, [audioUnlocked, speakAnnouncement])

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
      if (!audioUnlocked) {
        pendingSpeechRef.current = { number: calledNumber, text, voiceMode }
      } else {
        void (async () => {
          const played = await speakAnnouncement(calledNumber, text, voiceMode)
          if (!played && !isAudioUnlocked()) {
            pendingSpeechRef.current = { number: calledNumber, text, voiceMode }
          }
        })()
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
  }, [audioUnlocked, calledNumbers, speakAnnouncement, status, voiceMode])

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
      audioUnlocked,
      isAudioReady,
      isSpeechSupported,
      audioBlockedMessage,
      unlockAudio,
    }),
    [
      announcement,
      announcementNumber,
      audioUnlocked,
      isAudioReady,
      isSpeechSupported,
      audioBlockedMessage,
      unlockAudio,
    ],
  )
}
