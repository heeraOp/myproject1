import type { VoiceProfile } from '@/voices/types'

export const sportsCommentatorVoiceProfile: VoiceProfile = {
  mode: 'SPORTS_COMMENTATOR',
  preferredVoicePattern:
    /(alex|david|google us english|microsoft mark|male|female|en-us)/i,
  resolveSpeechText: (_number, baseText) => `Live update. ${baseText}. Crowd is on the edge of their seats.`,
  resolveStyle: (number) => ({
    rate: Math.min(1.45, 1.1 + (number % 4) * 0.07),
    pitch: Math.min(1.25, 0.94 + (number % 3) * 0.08),
  }),
}
