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
import { speakText, stopSpeaking, type VoiceType } from '@/utils/speakText'
import { resolveSpeechConfig } from '@/voices/voiceRegistry'

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

const AUDIO_BLOCKED_TEXT =
  'Sound is blocked by your browser or system. Please unmute your browser and press Enable Sound.'

const resolveVoiceTypeForMode = (mode: VoiceMode): VoiceType => {
  if (mode === 'FUNNY' || mode === 'FUNNY_CARTOON' || mode === 'FUNNY_COMEDIC' || mode === 'FUNNY_CRAZY') {
    return 'funny'
  }
  if (mode === 'CRAZY') return 'savage'
  if (mode === 'MALE_DEEP' || mode === 'MALE_ENERGETIC') return 'dramatic'
  return 'normal'
}

export const useBingoCaller = (): BingoCallerState => {
  const status = useGameStore((state) => state.status)
  const calledNumbers = useGameStore((state) => state.calledNumbers)
  const voiceMode = useVoiceModeStore((state) => state.mode)
  const [announcement, setAnnouncement] = useState('')
  const [announcementNumber, setAnnouncementNumber] = useState<number | null>(null)
  const [audioUnlocked, setAudioUnlocked] = useState(isAudioUnlocked())
  const [isAudioReady, setIsAudioReady] = useState(isAudioUnlocked())
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)
  const [audioBlockedMessage, setAudioBlockedMessage] = useState<string | null>(null)

  const initializedRef = useRef(false)
  const previousCalledSetRef = useRef<Set<number>>(new Set())
  const clearTimerRef = useRef<number | null>(null)
  const pendingSpeechRef = useRef<PendingSpeechAnnouncement | null>(null)

  useEffect(() => {
    initGlobalAudioUnlock()
    const unsubscribe = subscribeAudioUnlock((unlocked) => {
      setAudioUnlocked(unlocked)
      setIsAudioReady(unlocked)
      if (unlocked) {
        setAudioBlockedMessage(null)
      }
    })
    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setIsSpeechSupported(typeof Audio !== 'undefined')
  }, [])

  const speakAnnouncement = useCallback(
    async (calledNumber: number, text: string, mode: VoiceMode): Promise<boolean> => {
      if (!audioUnlocked) return false

      const resumed = await resumeGlobalAudioContext()
      if (!resumed || !isAudioUnlocked()) {
        setIsAudioReady(false)
        setAudioBlockedMessage(AUDIO_BLOCKED_TEXT)
        return false
      }

      const { speechText } = resolveSpeechConfig(mode, calledNumber, text)
      const played = await speakText(speechText || text, resolveVoiceTypeForMode(mode))
      if (!played) {
        setIsAudioReady(false)
        setAudioBlockedMessage(AUDIO_BLOCKED_TEXT)
        return false
      }

      setIsAudioReady(true)
      setAudioBlockedMessage(null)
      return true
    },
    [audioUnlocked],
  )

  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return
    void (async () => {
      const unlocked = await unlockAudioFromUserGesture()
      setAudioUnlocked(unlocked)
      setIsAudioReady(unlocked)
      setAudioBlockedMessage(unlocked ? null : AUDIO_BLOCKED_TEXT)
    })()
  }, [])

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
      stopSpeaking()
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
