import type { VoiceProfile } from '@/voices/types'

export const maleDeepVoiceProfile: VoiceProfile = {
  mode: 'MALE_DEEP',
  preferredVoicePattern:
    /(david|daniel|alex|fred|google uk english male|microsoft david|microsoft mark|male)/i,
  resolveSpeechText: (_number, baseText) => baseText,
  resolveStyle: () => ({
    rate: 0.96,
    pitch: 0.72,
  }),
}
