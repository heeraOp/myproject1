import { getFunnyBingoSpeechText, getFunnyVoiceStyle } from '@/utils/bingoCalls'
import type { VoiceProfile } from '@/voices/types'

export const funnyCartoonVoiceProfile: VoiceProfile = {
  mode: 'FUNNY_CARTOON',
  preferredVoicePattern:
    /(samantha|zira|karen|hazel|google us english|google uk english female|female|child)/i,
  resolveSpeechText: (number, baseText) => getFunnyBingoSpeechText(number) || baseText,
  resolveStyle: (number) => {
    const style = getFunnyVoiceStyle(number)
    return {
      rate: Math.min(1.3, style.rate + 0.08),
      pitch: Math.min(1.95, style.pitch + 0.24),
    }
  },
}
