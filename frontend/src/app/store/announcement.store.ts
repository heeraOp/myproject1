import { create } from 'zustand'

export type AnnouncementItem = {
  id: number
  gameId: string
  message: string
  timestamp: string
}

type AnnouncementStore = {
  announcements: AnnouncementItem[]
  addAnnouncement: (item: AnnouncementItem) => void
  dismissAnnouncement: (id: number) => void
  clearForGame: (gameId: string) => void
}

const MAX_ANNOUNCEMENTS = 30

export const useAnnouncementStore = create<AnnouncementStore>((set) => ({
  announcements: [],
  addAnnouncement: (item) =>
    set((state) => {
      const next = [...state.announcements, item]
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
