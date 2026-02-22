import type { VoiceProfile } from '@/voices/types'

export const royalCommanderVoiceProfile: VoiceProfile = {
  mode: 'ROYAL_COMMANDER',
  preferredVoicePattern:
    /(david|mark|google uk english male|microsoft david|male|narrator|en-gb)/i,
  resolveSpeechText: (_number, baseText) => `Royal call. ${baseText}. Mark your ticket with pride.`,
  resolveStyle: () => ({
    rate: 0.9,
    pitch: 0.82,
  }),
}
