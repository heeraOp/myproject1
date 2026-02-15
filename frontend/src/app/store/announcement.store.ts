import { create } from 'zustand'

export type AnnouncementType = 'info' | 'success' | 'warning' | 'danger'

export type AnnouncementItem = {
  id: number
  gameId: string
  message: string
  timestamp: string
  type?: AnnouncementType
}

type AnnouncementStore = {
  announcements: AnnouncementItem[]
  addAnnouncement: (item: AnnouncementItem) => void
  dismissAnnouncement: (id: number) => void
  clearForGame: (gameId: string) => void
}

const MAX_ANNOUNCEMENTS = 30

const inferAnnouncementType = (value: string): AnnouncementType => {
  const message = value.trim().toLowerCase()
  if (message.startsWith('[danger]') || message.startsWith('danger:') || message.includes('urgent')) {
    return 'danger'
  }
  if (message.startsWith('[warning]') || message.startsWith('warning:') || message.includes('warning')) {
    return 'warning'
  }
  if (message.startsWith('[success]') || message.startsWith('success:') || message.includes('success')) {
    return 'success'
  }
  return 'info'
}

export const useAnnouncementStore = create<AnnouncementStore>((set) => ({
  announcements: [],
  addAnnouncement: (item) =>
    set((state) => {
      const normalized: AnnouncementItem = {
        ...item,
        type: item.type ?? inferAnnouncementType(item.message),
      }
      const next = [...state.announcements, normalized]
      return {
        announcements: next.slice(Math.max(0, next.length - MAX_ANNOUNCEMENTS)),
      }
    }),
  dismissAnnouncement: (id) =>
    set((state) => ({
      announcements: state.announcements.filter((item) => item.id !== id),
    })),
  clearForGame: (gameId) =>
    set((state) => ({
      announcements: state.announcements.filter((item) => item.gameId !== gameId),
    })),
}))
