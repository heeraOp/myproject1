import type { VoiceProfile } from '@/voices/types'

export const femaleShoutVoiceProfile: VoiceProfile = {
  mode: 'FEMALE_SHOUT',
  preferredVoicePattern:
    /(samantha|zira|karen|hazel|aria|female|woman|google us english|google uk english female|en-us)/i,
  resolveSpeechText: (_number, baseText) => `Attention players. ${baseText}!`,
  resolveStyle: (number) => ({
    rate: Math.min(1.52, 1.24 + (number % 3) * 0.07),
    pitch: Math.min(1.42, 1.08 + (number % 2) * 0.12),
  }),
}
