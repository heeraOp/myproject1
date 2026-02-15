import { useEffect, useMemo, useState } from 'react'
import { useAnnouncementStore } from '@/app/store/announcement.store'
import './AnnouncementBanner.css'

type AnnouncementBannerProps = {
  gameId?: string
  autoHideMs?: number
}

const AnnouncementBanner = ({ gameId, autoHideMs = 6000 }: AnnouncementBannerProps) => {
  const announcements = useAnnouncementStore((state) => state.announcements)
  const dismissAnnouncement = useAnnouncementStore((state) => state.dismissAnnouncement)
  const [visibleId, setVisibleId] = useState<number | null>(null)

  const latestAnnouncement = useMemo(() => {
    const scoped = gameId
      ? announcements.filter((announcement) => announcement.gameId === gameId)
      : announcements
    return scoped.length ? scoped[scoped.length - 1] : null
  }, [announcements, gameId])

  useEffect(() => {
    if (!latestAnnouncement) {
      setVisibleId(null)
      return
    }

    setVisibleId(latestAnnouncement.id)
    const timer = window.setTimeout(() => {
      dismissAnnouncement(latestAnnouncement.id)
      setVisibleId((current) => (current === latestAnnouncement.id ? null : current))
    }, autoHideMs)

    return () => window.clearTimeout(timer)
  }, [latestAnnouncement, autoHideMs, dismissAnnouncement])

  if (!latestAnnouncement || visibleId !== latestAnnouncement.id) return null

  return (
    <aside className="announcement-banner" role="status" aria-live="polite">
      <strong className="announcement-banner__title">Announcement</strong>
      <p className="announcement-banner__message">{latestAnnouncement.message}</p>
    </aside>
  )
}

export default AnnouncementBanner
