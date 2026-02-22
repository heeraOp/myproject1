import type { VoiceMode } from '@/app/store/voiceMode.store'
import { femaleShoutVoiceProfile } from '@/voices/profiles/femaleShout'
import { getFunnyBingoSpeechText, getFunnyVoiceStyle } from '@/utils/bingoCalls'
import { funnyCartoonVoiceProfile } from '@/voices/profiles/funnyCartoon'
import { funnyCrazyVoiceProfile } from '@/voices/profiles/funnyCrazy'
import { maleDeepVoiceProfile } from '@/voices/profiles/maleDeep'
import { maleEnergeticVoiceProfile } from '@/voices/profiles/maleEnergetic'
import { royalCommanderVoiceProfile } from '@/voices/profiles/royalCommander'
import { sportsCommentatorVoiceProfile } from '@/voices/profiles/sportsCommentator'
import type { VoiceProfile } from '@/voices/types'

const defaultVoicePattern = /(fred|samantha|zira|david|daniel|karen|google uk english male)/i

const classicVoiceProfile: VoiceProfile = {
  mode: 'CLASSIC',
  preferredVoicePattern: defaultVoicePattern,
  resolveSpeechText: (_number, baseText) => baseText,
  resolveStyle: () => ({
    rate: 0.95,
    pitch: 1,
  }),
}

const funnyVoiceProfile: VoiceProfile = {
  mode: 'FUNNY',
  preferredVoicePattern: /(samantha|zira|karen|google us english|female)/i,
  resolveSpeechText: (number, baseText) => getFunnyBingoSpeechText(number) || baseText,
  resolveStyle: (number) => getFunnyVoiceStyle(number),
}

const crazyVoiceProfile: VoiceProfile = {
  mode: 'CRAZY',
  preferredVoicePattern: defaultVoicePattern,
  resolveSpeechText: (_number, baseText) => `Boom boom bingo! ${baseText}. Repeat! ${baseText}.`,
  resolveStyle: (number) => ({
    rate: 1.12 + (number % 3) * 0.08,
    pitch: 1.35 + (number % 4) * 0.1,
  }),
}

export const VOICE_PROFILE_REGISTRY: Record<VoiceMode, VoiceProfile> = {
  CLASSIC: classicVoiceProfile,
  FEMALE_SHOUT: femaleShoutVoiceProfile,
  FUNNY: funnyVoiceProfile,
  CRAZY: crazyVoiceProfile,
  MALE_DEEP: maleDeepVoiceProfile,
  MALE_ENERGETIC: maleEnergeticVoiceProfile,
  ROYAL_COMMANDER: royalCommanderVoiceProfile,
  SPORTS_COMMENTATOR: sportsCommentatorVoiceProfile,
  FUNNY_CARTOON: funnyCartoonVoiceProfile,
  FUNNY_COMEDIC: funnyCrazyVoiceProfile,
  FUNNY_CRAZY: funnyCrazyVoiceProfile,
}

export const getVoiceProfile = (mode: VoiceMode): VoiceProfile =>
  VOICE_PROFILE_REGISTRY[mode] ?? classicVoiceProfile

export const resolveSpeechConfig = (
  mode: VoiceMode,
  number: number,
  baseText: string,
): { speechText: string; rate: number; pitch: number } => {
  const profile = getVoiceProfile(mode)
  const speechText = profile.resolveSpeechText(number, baseText) || baseText
  const style = profile.resolveStyle(number)
  return {
    speechText,
    rate: style.rate,
    pitch: style.pitch,
  }
}

export const pickVoiceForMode = (
  voices: SpeechSynthesisVoice[],
  mode: VoiceMode,
  number: number,
): SpeechSynthesisVoice | undefined => {
  if (!voices.length) return undefined
  const profile = getVoiceProfile(mode)
  return voices.find((voice) => profile.preferredVoicePattern.test(voice.name)) ?? voices[number % voices.length]
}
