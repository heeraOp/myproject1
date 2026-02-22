export const VOICE_ANNOUNCEMENT_PREFIX = '[voice]'

const VOICE_PREFIX_PATTERN = /^\s*\[voice\]\s*/i

export const isVoiceAnnouncement = (message: string): boolean => {
  return VOICE_PREFIX_PATTERN.test(String(message ?? ''))
}

export const stripVoiceAnnouncementPrefix = (message: string): string => {
  return String(message ?? '').replace(VOICE_PREFIX_PATTERN, '').trim()
}

export const encodeVoiceAnnouncement = (message: string): string => {
  const trimmed = String(message ?? '').trim()
  if (!trimmed) return ''
  if (isVoiceAnnouncement(trimmed)) return trimmed
  return `${VOICE_ANNOUNCEMENT_PREFIX} ${trimmed}`
}
