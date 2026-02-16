import type { VoiceProfile } from '@/voices/types'

export const maleEnergeticVoiceProfile: VoiceProfile = {
  mode: 'MALE_ENERGETIC',
  preferredVoicePattern:
    /(david|daniel|alex|fred|google uk english male|microsoft david|microsoft mark|male)/i,
  resolveSpeechText: (_number, baseText) => `Let us go. ${baseText}. Keep dabbing.`,
  resolveStyle: (number) => ({
    rate: Math.min(1.35, 1.08 + (number % 3) * 0.08),
    pitch: Math.min(1.15, 0.92 + (number % 3) * 0.06),
  }),
}
