import { REST_BASE_URL } from '@/config'
import {
  initGlobalAudioUnlock,
  playAudioElementSafely,
} from '@/utils/audioEngine'

export type VoiceType = 'normal' | 'savage' | 'funny' | 'dramatic'

type MusicOptions = {
  loop?: boolean
  volume?: number
  fadeInMs?: number
}

type StopMusicOptions = {
  fadeOutMs?: number
}

type EffectOptions = {
  volume?: number
  interrupt?: boolean
}

type SpeechPlaybackStyle = {
  rate?: number
  pitch?: number
}

type SpeechEnv = {
  VITE_ELEVENLABS_API_KEY?: string
  VITE_ELEVEN_API_KEY?: string
  VITE_ELEVENLABS_VOICE_ID?: string
  VITE_ELEVEN_VOICE_ID?: string
}

let speechAudio: HTMLAudioElement | null = null
let speechObjectUrl: string | null = null
let speechRequestController: AbortController | null = null
let speakQueue: Promise<boolean> = Promise.resolve(true)

let musicAudio: HTMLAudioElement | null = null
let musicFadeTimer: number | null = null

let effectAudio: HTMLAudioElement | null = null
let winnerSoundFlowQueue: Promise<void> = Promise.resolve()
let winnerSoundFlowActiveCount = 0
let effectContext: AudioContext | null = null
const DEFAULT_SPEECH_PLAYBACK_RATE = 1

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')

const buildVoiceUrl = (text: string, voiceType: VoiceType): string => {
  const query = encodeURIComponent(text)
  const voiceQuery = encodeURIComponent(voiceType)
  const base = normalizeBaseUrl(REST_BASE_URL || '')
  if (!base) return `/api/voice/?text=${query}&voice_type=${voiceQuery}`
  return `${base}/api/voice/?text=${query}&voice_type=${voiceQuery}`
}

const clampVolume = (value: number): number => Math.max(0, Math.min(1, value))
const clampRate = (value: number): number => Math.max(0.8, Math.min(1.55, value))
const clampPitch = (value: number): number => Math.max(0.5, Math.min(2, value))

const resolveAudioPlaybackRate = (style: SpeechPlaybackStyle = {}): number => {
  const rate = Number(style.rate)
  if (!Number.isFinite(rate)) return DEFAULT_SPEECH_PLAYBACK_RATE
  return clampRate(rate)
}

const clearSpeechObjectUrl = () => {
  if (!speechObjectUrl) return
  URL.revokeObjectURL(speechObjectUrl)
  speechObjectUrl = null
}

const selectWebSpeechVoice = (
  voices: SpeechSynthesisVoice[],
  voiceType: VoiceType,
): SpeechSynthesisVoice | null => {
  if (!voices.length) return null
  const englishVoices = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang || ''))
  const pool = englishVoices.length > 0 ? englishVoices : voices

  const findByName = (keywords: string[]): SpeechSynthesisVoice | null => {
    const lowered = keywords.map((keyword) => keyword.toLowerCase())
    return (
      pool.find((voice) => {
        const name = String(voice.name || '').toLowerCase()
        const uri = String(voice.voiceURI || '').toLowerCase()
        return lowered.some((keyword) => name.includes(keyword) || uri.includes(keyword))
      }) ?? null
    )
  }

  if (voiceType === 'dramatic' || voiceType === 'savage') {
    const deepVoice = findByName(['male', 'deep', 'david', 'mark', 'daniel'])
    if (deepVoice) return deepVoice
  }

  if (voiceType === 'funny') {
    const lightVoice = findByName(['female', 'samantha', 'google uk english female', 'zira'])
    if (lightVoice) return lightVoice
  }

  const defaultVoice = pool.find((voice) => voice.default)
  if (defaultVoice) return defaultVoice
  return pool[0] ?? null
}

const speakWithWebSpeech = async (
  inputText: string,
  voiceType: VoiceType,
  style: SpeechPlaybackStyle = {},
): Promise<boolean> => {
  if (typeof window === 'undefined') return false
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false

  const text = String(inputText || '').trim()
  if (!text) return false

  const synth = window.speechSynthesis
  try {
    synth.resume()
  } catch {
    // ignore
  }

  return new Promise<boolean>((resolve) => {
    let settled = false
    const utterance = new SpeechSynthesisUtterance(text)
    const voices = synth.getVoices()
    const selectedVoice = selectWebSpeechVoice(voices, voiceType)
    if (selectedVoice) {
      utterance.voice = selectedVoice
      if (selectedVoice.lang) {
        utterance.lang = selectedVoice.lang
      }
    }

    const fallbackRate =
      voiceType === 'funny' ? 1.07 : voiceType === 'savage' ? 1.04 : voiceType === 'dramatic' ? 1.02 : 1
    const fallbackPitch = voiceType === 'funny' ? 1.12 : 1
    utterance.rate = clampRate(Number.isFinite(Number(style.rate)) ? Number(style.rate) : fallbackRate)
    utterance.pitch = clampPitch(Number.isFinite(Number(style.pitch)) ? Number(style.pitch) : fallbackPitch)
    utterance.volume = 1

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(safetyTimer)
      utterance.onend = null
      utterance.onerror = null
      resolve(ok)
    }

    utterance.onend = () => finish(true)
    utterance.onerror = () => finish(false)

    const safetyTimer = window.setTimeout(() => {
      finish(Boolean(synth.speaking || synth.pending))
    }, Math.max(4500, Math.min(18000, text.length * 140)))

    try {
      synth.cancel()
      synth.speak(utterance)
    } catch {
      finish(false)
      return
    }

    window.setTimeout(() => {
      if (!synth.speaking && !synth.pending) {
        finish(false)
      }
    }, 220)
  })
}

const clearMusicFade = () => {
  if (musicFadeTimer === null) return
  window.clearInterval(musicFadeTimer)
  musicFadeTimer = null
}

const fadeAudioVolume = (
  audio: HTMLAudioElement,
  startVolume: number,
  endVolume: number,
  durationMs: number,
  onDone: () => void,
) => {
  clearMusicFade()
  if (durationMs <= 0) {
    audio.volume = clampVolume(endVolume)
    onDone()
    return
  }

  const from = clampVolume(startVolume)
  const to = clampVolume(endVolume)
  const totalSteps = Math.max(1, Math.floor(durationMs / 50))
  let step = 0
  audio.volume = from

  musicFadeTimer = window.setInterval(() => {
    step += 1
    const progress = Math.min(1, step / totalSteps)
    const nextVolume = from + (to - from) * progress
    audio.volume = clampVolume(nextVolume)
    if (progress >= 1) {
      clearMusicFade()
      onDone()
    }
  }, 50)
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })

const getEffectContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return null
  if (!effectContext) {
    effectContext = new AudioContextCtor()
  }
  return effectContext
}

const ensureEffectContextReady = async (context: AudioContext): Promise<boolean> => {
  try {
    if (context.state === 'suspended') {
      await context.resume()
    }
    return context.state === 'running'
  } catch {
    return false
  }
}

const playDrumrollFallback = async (durationMs = 2000): Promise<boolean> => {
  const context = getEffectContext()
  if (!context) return false
  const ready = await ensureEffectContextReady(context)
  if (!ready) return false

  const base = context.currentTime + 0.02
  let elapsedMs = 0
  let stepMs = 82

  while (elapsedMs < durationMs) {
    const start = base + elapsedMs / 1000
    const end = start + 0.07
    const osc = context.createOscillator()
    const gain = context.createGain()
    const filter = context.createBiquadFilter()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(95 + Math.random() * 45, start)
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(420 + Math.random() * 160, start)

    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.42, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(context.destination)

    osc.start(start)
    osc.stop(end + 0.01)

    elapsedMs += stepMs
    stepMs = Math.max(24, stepMs * 0.95)
  }

  await wait(durationMs + 100)
  return true
}

const createNoiseBuffer = (context: AudioContext, durationMs: number): AudioBuffer => {
  const frameCount = Math.max(1, Math.floor((context.sampleRate * durationMs) / 1000))
  const buffer = context.createBuffer(1, frameCount, context.sampleRate)
  const channel = buffer.getChannelData(0)
  for (let index = 0; index < frameCount; index += 1) {
    channel[index] = (Math.random() * 2 - 1) * (0.65 + Math.random() * 0.35)
  }
  return buffer
}

const playApplauseFallback = async (durationMs = 1300): Promise<boolean> => {
  const context = getEffectContext()
  if (!context) return false
  const ready = await ensureEffectContextReady(context)
  if (!ready) return false

  const base = context.currentTime + 0.02
  const burstBuffer = createNoiseBuffer(context, 85)
  const totalBursts = 18

  for (let index = 0; index < totalBursts; index += 1) {
    const start =
      base +
      (index / totalBursts) * (durationMs / 1000) +
      (Math.random() * 0.04 - 0.02)
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()

    source.buffer = burstBuffer
    filter.type = 'highpass'
    filter.frequency.setValueAtTime(900 + Math.random() * 2000, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.24 + Math.random() * 0.18, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(context.destination)

    source.start(start)
    source.stop(start + 0.09)
  }

  await wait(durationMs + 120)
  return true
}

export const stopSpeaking = () => {
  if (speechRequestController) {
    speechRequestController.abort()
    speechRequestController = null
  }
  if (speechAudio) {
    speechAudio.pause()
    speechAudio.currentTime = 0
    speechAudio = null
  }
  clearSpeechObjectUrl()
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
  }
}

export const isWinnerSoundFlowActive = (): boolean => winnerSoundFlowActiveCount > 0

export const speakText = async (
  inputText: string,
  voiceType: VoiceType = 'normal',
  style: SpeechPlaybackStyle = {},
): Promise<boolean> => {
  const text = String(inputText || '').trim()
  if (!text) return false
  if (typeof window === 'undefined') return false

  initGlobalAudioUnlock()
  stopSpeaking()

  const controller = new AbortController()
  speechRequestController = controller
  try {
    // If an ElevenLabs API key is provided via Vite env, use the ElevenLabs
    // text-to-speech API directly from the client and play the returned audio.
    // This path is preferred for production when the deploy provides the key.
    const env = (import.meta.env as SpeechEnv) || {}
    const elevenKey = env.VITE_ELEVENLABS_API_KEY || env.VITE_ELEVEN_API_KEY || ''
    const elevenVoiceId =
      env.VITE_ELEVENLABS_VOICE_ID || env.VITE_ELEVEN_VOICE_ID || 'alloy'

    if (elevenKey) {
      try {
        const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
          elevenVoiceId,
        )}/stream`

        const response = await fetch(elevenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': elevenKey,
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        })

        if (response.ok) {
          const blob = await response.blob()
          if (blob.size && speechRequestController === controller) {
            const objectUrl = URL.createObjectURL(blob)
            speechObjectUrl = objectUrl

            const audio = new Audio(objectUrl)
            audio.playbackRate = resolveAudioPlaybackRate(style)
            speechAudio = audio

            const finalize = () => {
              if (speechAudio === audio) {
                speechAudio = null
              }
              clearSpeechObjectUrl()
            }

            audio.onended = finalize
            audio.onerror = finalize

            const played = await playAudioElementSafely(audio)
            if (played) {
              return true
            }
            finalize()
          }
        }
      } catch {
        // Continue to backend/web-speech fallback.
      }
    }

    // No ElevenLabs key configured — attempt backend TTS endpoint.
    // If unavailable, gracefully fall back to browser speech synthesis.
    try {
      const response = await fetch(buildVoiceUrl(text, voiceType), {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      })
      if (response.ok) {
        const blob = await response.blob()
        if (blob.size && speechRequestController === controller) {
          const objectUrl = URL.createObjectURL(blob)
          speechObjectUrl = objectUrl

          const audio = new Audio(objectUrl)
          audio.playbackRate = resolveAudioPlaybackRate(style)
          speechAudio = audio

          const finalize = () => {
            if (speechAudio === audio) {
              speechAudio = null
            }
            clearSpeechObjectUrl()
          }

          audio.onended = finalize
          audio.onerror = finalize

          const played = await playAudioElementSafely(audio)
          if (!played) {
            finalize()
            return false
          }
          return true
        }
      }
    } catch {
      // fallback below
    }

    if (speechRequestController !== controller) return false
    const fallbackPlayed = await speakWithWebSpeech(text, voiceType, style)
    return fallbackPlayed
  } finally {
    if (speechRequestController === controller) {
      speechRequestController = null
    }
  }
}

export const queueSpeakText = (
  text: string,
  voiceType: VoiceType = 'normal',
  style: SpeechPlaybackStyle = {},
) => {
  speakQueue = speakQueue.catch(() => false).then(() => speakText(text, voiceType, style))
  return speakQueue
}

export const playMusic = async (
  source = '/sounds/intro_music.mp3',
  options: MusicOptions = {},
): Promise<boolean> => {
  if (typeof window === 'undefined') return false
  initGlobalAudioUnlock()

  const loop = options.loop ?? true
  const targetVolume = clampVolume(options.volume ?? 0.25)
  const fadeInMs = Math.max(0, Math.floor(options.fadeInMs ?? 500))

  if (musicAudio) {
    musicAudio.pause()
    musicAudio.currentTime = 0
    musicAudio = null
  }
  clearMusicFade()

  const audio = new Audio(source)
  audio.loop = loop
  audio.preload = 'auto'
  audio.volume = fadeInMs > 0 ? 0 : targetVolume

  try {
    const played = await playAudioElementSafely(audio)
    if (!played) return false
    musicAudio = audio
    if (fadeInMs > 0) {
      fadeAudioVolume(audio, 0, targetVolume, fadeInMs, () => {})
    }
    return true
  } catch {
    if (musicAudio === audio) {
      musicAudio = null
    }
    return false
  }
}

export const stopMusic = async (options: StopMusicOptions = {}): Promise<void> => {
  if (!musicAudio) return
  const audio = musicAudio
  const fadeOutMs = Math.max(0, Math.floor(options.fadeOutMs ?? 1000))

  const finish = () => {
    audio.pause()
    audio.currentTime = 0
    if (musicAudio === audio) {
      musicAudio = null
    }
  }

  if (fadeOutMs <= 0) {
    finish()
    return
  }

  fadeAudioVolume(audio, audio.volume, 0, fadeOutMs, finish)
}

export const playEffect = async (
  source: string,
  options: EffectOptions = {},
): Promise<boolean> => {
  if (typeof window === 'undefined') return false
  initGlobalAudioUnlock()
  const interrupt = options.interrupt ?? true

  if (interrupt && effectAudio) {
    effectAudio.pause()
    effectAudio.currentTime = 0
    effectAudio = null
  }

  const audio = new Audio(source)
  audio.preload = 'auto'
  audio.volume = clampVolume(options.volume ?? 1)

  try {
    const played = await playAudioElementSafely(audio)
    if (!played) return false
    effectAudio = audio
    audio.onended = () => {
      if (effectAudio === audio) {
        effectAudio = null
      }
    }
    audio.onerror = () => {
      if (effectAudio === audio) {
        effectAudio = null
      }
    }
    return true
  } catch {
    if (effectAudio === audio) {
      effectAudio = null
    }
    return false
  }
}

export const playWinnerSoundFlow = (
  winnerAnnouncementText: string,
  voiceType: VoiceType = 'dramatic',
): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve()

  const run = async () => {
    winnerSoundFlowActiveCount += 1
    try {
      const drumrollPlayed = await playEffect('/sounds/drumroll.mp3', { volume: 1, interrupt: true })
      if (!drumrollPlayed) {
        await playDrumrollFallback(2000)
      }
      await wait(2000)

      // Ensure any playing effects or music are stopped so the TTS is audible
      try {
        if (effectAudio) {
          effectAudio.pause()
          effectAudio.currentTime = 0
          effectAudio = null
        }
      } catch {
        /* ignore */
      }
      try {
        if (musicAudio) {
          musicAudio.pause()
          musicAudio.currentTime = 0
          musicAudio = null
        }
      } catch {
        /* ignore */
      }

      await speakText(winnerAnnouncementText, voiceType)

      const applausePlayed = await playEffect('/sounds/applause.mp3', { volume: 1, interrupt: true })
      if (!applausePlayed) {
        await playApplauseFallback(1300)
      }
    } finally {
      winnerSoundFlowActiveCount = Math.max(0, winnerSoundFlowActiveCount - 1)
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('winner-soundflow-ended'))
        }
      } catch {
        /* ignore */
      }
    }
  }

  winnerSoundFlowQueue = winnerSoundFlowQueue.catch(() => undefined).then(run)
  return winnerSoundFlowQueue
}
