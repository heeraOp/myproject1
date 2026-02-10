import { create } from 'zustand'

export type VoiceMode = 'CLASSIC' | 'FUNNY' | 'CRAZY'

type VoiceModeStore = {
  mode: VoiceMode
  setMode: (mode: VoiceMode) => void
}

const STORAGE_KEY = 'bingoVoiceMode'

const isVoiceMode = (value: string): value is VoiceMode =>
  value === 'CLASSIC' || value === 'FUNNY' || value === 'CRAZY'

const getInitialMode = (): VoiceMode => {
  if (typeof window === 'undefined') return 'FUNNY'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored && isVoiceMode(stored) ? stored : 'FUNNY'
}

export const useVoiceModeStore = create<VoiceModeStore>((set) => ({
  mode: getInitialMode(),
  setMode: (mode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, mode)
    }
    set({ mode })
  },
}))
