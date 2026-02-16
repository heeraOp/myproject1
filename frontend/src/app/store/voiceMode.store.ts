import { create } from 'zustand'

export type VoiceMode =
  | 'CLASSIC'
  | 'FUNNY'
  | 'CRAZY'
  | 'MALE_DEEP'
  | 'MALE_ENERGETIC'
  | 'FUNNY_CARTOON'
  | 'FUNNY_COMEDIC'
  | 'FUNNY_CRAZY'

export const VOICE_MODE_OPTIONS: ReadonlyArray<{ value: VoiceMode; label: string }> = [
  { value: 'CLASSIC', label: 'Classic (Female Mix)' },
  { value: 'FUNNY', label: 'Funny (Legacy)' },
  { value: 'CRAZY', label: 'Crazy (Legacy)' },
  { value: 'MALE_DEEP', label: 'Male Deep' },
  { value: 'MALE_ENERGETIC', label: 'Male Energetic' },
  { value: 'FUNNY_CARTOON', label: 'Funny Cartoon' },
  { value: 'FUNNY_COMEDIC', label: 'Funny Comedic' },
]

type VoiceModeStore = {
  mode: VoiceMode
  setMode: (mode: VoiceMode) => void
}

const STORAGE_KEY = 'bingoVoiceMode'

const isVoiceMode = (value: string): value is VoiceMode =>
  value === 'CLASSIC' ||
  value === 'FUNNY' ||
  value === 'CRAZY' ||
  value === 'MALE_DEEP' ||
  value === 'MALE_ENERGETIC' ||
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

export const useVoiceModeStore = create<VoiceModeStore>((set) => ({
  mode: getInitialMode(),
  setMode: (mode) => {
    const normalizedMode = normalizeVoiceMode(mode)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, normalizedMode)
    }
    set({ mode: normalizedMode })
  },
}))
