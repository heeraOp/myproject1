import type { VoiceMode } from '@/app/store/voiceMode.store'

export type VoiceStyle = {
  rate: number
  pitch: number
}

export type VoiceProfile = {
  mode: VoiceMode
  preferredVoicePattern: RegExp
  resolveSpeechText: (number: number, baseText: string) => string
  resolveStyle: (number: number) => VoiceStyle
}
