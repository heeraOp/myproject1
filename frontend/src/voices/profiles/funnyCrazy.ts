import type { VoiceProfile } from '@/voices/types'

export const funnyComedicVoiceProfile: VoiceProfile = {
  mode: 'FUNNY_COMEDIC',
  preferredVoicePattern: /(fred|samantha|zira|google uk english male|google us english|male|female)/i,
  resolveSpeechText: (_number, baseText) => `Boom boom bingo. ${baseText}. Repeat. ${baseText}.`,
  resolveStyle: (number) => ({
    rate: Math.min(1.45, 1.12 + (number % 4) * 0.08),
    pitch: Math.min(1.98, 1.3 + (number % 4) * 0.12),
  }),
}

// Backward-compatible alias for older FUNNY_CRAZY references.
export const funnyCrazyVoiceProfile = funnyComedicVoiceProfile
