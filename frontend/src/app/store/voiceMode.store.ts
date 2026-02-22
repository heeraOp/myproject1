import { create } from 'zustand'

export type VoiceMode =
  | 'CLASSIC'
  | 'FEMALE_SHOUT'
  | 'FUNNY'
  | 'CRAZY'
  | 'MALE_DEEP'
  | 'MALE_ENERGETIC'
  | 'ROYAL_COMMANDER'
  | 'SPORTS_COMMENTATOR'
  | 'FUNNY_CARTOON'
  | 'FUNNY_COMEDIC'
  | 'FUNNY_CRAZY'

export const VOICE_MODE_OPTIONS: ReadonlyArray<{ value: VoiceMode; label: string }> = [
  { value: 'CLASSIC', label: 'Classic (Female Mix)' },
  { value: 'FEMALE_SHOUT', label: 'Female Shout' },
  { value: 'FUNNY', label: 'Funny (Legacy)' },
  { value: 'CRAZY', label: 'Crazy (Legacy)' },
  { value: 'MALE_DEEP', label: 'Male Deep' },
  { value: 'MALE_ENERGETIC', label: 'Male Energetic' },
  { value: 'ROYAL_COMMANDER', label: 'Royal Commander' },
  { value: 'SPORTS_COMMENTATOR', label: 'Sports Commentator' },
  { value: 'FUNNY_CARTOON', label: 'Funny Cartoon' },
  { value: 'FUNNY_COMEDIC', label: 'Funny Comedic' },
]

export const VOICE_SPEED_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.8, label: '0.8x' },
  { value: 0.9, label: '0.9x' },
  { value: 1.0, label: '1.0x' },
  { value: 1.1, label: '1.1x' },
  { value: 1.2, label: '1.2x' },
  { value: 1.3, label: '1.3x' },
  { value: 1.4, label: '1.4x' },
  { value: 1.5, label: '1.5x' },
]

const MIN_VOICE_SPEED = 0.8
const MAX_VOICE_SPEED = 1.5
const DEFAULT_VOICE_SPEED = 1

const normalizeVoiceSpeed = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_VOICE_SPEED
  const clamped = Math.min(MAX_VOICE_SPEED, Math.max(MIN_VOICE_SPEED, value))
  return Math.round(clamped * 100) / 100
}

type VoiceModeStore = {
  mode: VoiceMode
  speed: number
  setMode: (mode: VoiceMode) => void
  setSpeed: (speed: number) => void
}

const STORAGE_KEY = 'bingoVoiceMode'
const SPEED_STORAGE_KEY = 'bingoVoiceSpeed'

const isVoiceMode = (value: string): value is VoiceMode =>
  value === 'CLASSIC' ||
  value === 'FEMALE_SHOUT' ||
  value === 'FUNNY' ||
  value === 'CRAZY' ||
  value === 'MALE_DEEP' ||
  value === 'MALE_ENERGETIC' ||
  value === 'ROYAL_COMMANDER' ||
  value === 'SPORTS_COMMENTATOR' ||
  value === 'FUNNY_CARTOON' ||
  value === 'FUNNY_COMEDIC' ||
  value === 'FUNNY_CRAZY'

const normalizeVoiceMode = (mode: VoiceMode): VoiceMode =>
  mode === 'FUNNY_CRAZY' ? 'FUNNY_COMEDIC' : mode

const getInitialMode = (): VoiceMode => {
  if (typeof window === 'undefined') return 'FUNNY'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (!stored || !isVoiceMode(stored)) return 'FUNNY'
  return normalizeVoiceMode(stored)
}

const getInitialSpeed = (): number => {
  if (typeof window === 'undefined') return DEFAULT_VOICE_SPEED
  const stored = window.localStorage.getItem(SPEED_STORAGE_KEY)
  if (!stored) return DEFAULT_VOICE_SPEED
  const parsed = Number.parseFloat(stored)
  return normalizeVoiceSpeed(parsed)
}

export const useVoiceModeStore = create<VoiceModeStore>((set) => ({
  mode: getInitialMode(),
  speed: getInitialSpeed(),
  setMode: (mode) => {
    const normalizedMode = normalizeVoiceMode(mode)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, normalizedMode)
    }
    set({ mode: normalizedMode })
  },
  setSpeed: (speed) => {
    const normalizedSpeed = normalizeVoiceSpeed(speed)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SPEED_STORAGE_KEY, String(normalizedSpeed))
    }
    set({ speed: normalizedSpeed })
  },
}))
