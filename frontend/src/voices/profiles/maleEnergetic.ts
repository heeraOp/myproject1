import type { VoiceProfile } from '@/voices/types'

export const maleEnergeticVoiceProfile: VoiceProfile = {
  mode: 'MALE_ENERGETIC',
  preferredVoicePattern:
    /(david|daniel|alex|fred|google uk english male|microsoft david|microsoft mark|male)/i,
  resolveSpeechText: (_number, baseText) => `Let's go ${baseText} Keep dabbing.`,
  resolveStyle: (number) => ({
    rate: Math.min(1.5, 1.2 + (number % 3) * 0.1),
    pitch: Math.min(1.2, 0.96 + (number % 3) * 0.06),
  }),
}
