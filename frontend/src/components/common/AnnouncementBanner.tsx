import { useEffect, useMemo, useRef, useState } from 'react'
import { type AnnouncementType, useAnnouncementStore } from '@/app/store/announcement.store'
import { initGlobalAudioUnlock, playAudioElementSafely } from '@/utils/audioEngine'
import './AnnouncementBanner.css'

type AnnouncementBannerProps = {
  gameId?: string
  autoHideMs?: number
  enableSound?: boolean
}

const EXIT_MS = 320

const ICON_MAP: Record<AnnouncementType, string> = {
  info: '🎉',
  success: '✅',
  warning: '⚠️',
  danger: '🔥',
}

const SOUND_MAP: Record<AnnouncementType, string | null> = {
  info: '/sounds/announcement-info.mp3',
  success: '/sounds/announcement-success.mp3',
  warning: '/sounds/announcement-warning.mp3',
  danger: '/sounds/announcement-danger.mp3',
}

const detectTypeFromMessage = (message: string, fallback?: AnnouncementType): AnnouncementType => {
  if (fallback) return fallback
  const normalized = message.trim().toLowerCase()
  if (normalized.startsWith('[danger]') || normalized.startsWith('danger:') || normalized.includes('urgent')) {
    return 'danger'
  }
  if (normalized.startsWith('[warning]') || normalized.startsWith('warning:') || normalized.includes('warning')) {
    return 'warning'
  }
  if (normalized.startsWith('[success]') || normalized.startsWith('success:') || normalized.includes('success')) {
    return 'success'
  }
  return 'info'
}

const stripTypePrefix = (message: string): string =>
  message.replace(/^\s*\[(info|success|warning|danger)\]\s*/i, '').replace(/^\s*(info|success|warning|danger)\s*:\s*/i, '')

const AnnouncementBanner = ({
  gameId,
  autoHideMs = 4000,
  enableSound = true,
}: AnnouncementBannerProps) => {
  const announcements = useAnnouncementStore((state) => state.announcements)
  const dismissAnnouncement = useAnnouncementStore((state) => state.dismissAnnouncement)
  const [isVisible, setIsVisible] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const dismissTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const audioCacheRef = useRef<Record<AnnouncementType, HTMLAudioElement | null>>({
    info: null,
    success: null,
    warning: null,
    danger: null,
  })
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)

  const latestAnnouncement = useMemo(() => {
    const scoped = gameId
      ? announcements.filter((announcement) => announcement.gameId === gameId)
      : announcements
    return scoped.length ? scoped[scoped.length - 1] : null
  }, [announcements, gameId])

  const announcementType = detectTypeFromMessage(
    latestAnnouncement?.message ?? '',
    latestAnnouncement?.type,
  )
  const announcementMessage = stripTypePrefix(latestAnnouncement?.message ?? '')
  const icon = ICON_MAP[announcementType]

  useEffect(() => {
    initGlobalAudioUnlock()
  }, [])

  useEffect(() => {
    if (!latestAnnouncement) {
      setIsVisible(false)
      return
    }

    setIsVisible(true)

    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current)
    }
    if (dismissTimeoutRef.current) {
      window.clearTimeout(dismissTimeoutRef.current)
    }

    hideTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false)
    }, autoHideMs)

    dismissTimeoutRef.current = window.setTimeout(() => {
      dismissAnnouncement(latestAnnouncement.id)
    }, autoHideMs + EXIT_MS)

    if (enableSound) {
      const soundSrc = SOUND_MAP[announcementType]
      if (soundSrc) {
        if (activeAudioRef.current) {
          activeAudioRef.current.pause()
          activeAudioRef.current.currentTime = 0
        }
        const cachedAudio = audioCacheRef.current[announcementType]
        const nextAudio = cachedAudio ?? new Audio(soundSrc)
        nextAudio.preload = 'auto'
        audioCacheRef.current[announcementType] = nextAudio
        activeAudioRef.current = nextAudio
        nextAudio.pause()
        nextAudio.currentTime = 0
        void playAudioElementSafely(nextAudio)
      }
    }
  }, [latestAnnouncement?.id, latestAnnouncement, announcementType, autoHideMs, dismissAnnouncement, enableSound])

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
      if (dismissTimeoutRef.current) {
        window.clearTimeout(dismissTimeoutRef.current)
        dismissTimeoutRef.current = null
      }
      if (activeAudioRef.current) {
        activeAudioRef.current.pause()
        activeAudioRef.current.currentTime = 0
      }
    }
  }, [])

  if (!latestAnnouncement) return null

  return (
    <aside
      className={`announcement-banner announcement-banner--${announcementType} ${
        isVisible ? 'announcement-banner--visible' : 'announcement-banner--hidden'
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="announcement-banner__icon" aria-hidden>
        {icon}
      </span>
      <div className="announcement-banner__content">
        <strong className="announcement-banner__title">{announcementType.toUpperCase()}</strong>
        <p className="announcement-banner__message">{announcementMessage}</p>
      </div>
    </aside>
  )
}

export default AnnouncementBanner
