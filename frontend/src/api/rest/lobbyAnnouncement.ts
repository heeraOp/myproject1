import { apiClient } from '@/api/rest/client'

export type LobbyAnnouncementResponse = {
  id: number
  title: string
  content: string
  version: number
  is_accepted: boolean
}

export type LobbyAnnouncementAcceptResponse = {
  success: boolean
  announcement_id: number
  accepted: boolean
  already_accepted: boolean
}

export const fetchLobbyAnnouncement = async (
  lobbyId: string,
): Promise<LobbyAnnouncementResponse | null> => {
  const normalizedLobbyId = String(lobbyId || '').trim()
  if (!normalizedLobbyId) return null

  const response = await apiClient.get<LobbyAnnouncementResponse | null>(
    `/lobby/${normalizedLobbyId}/announcement/`,
  )
  if (!response.data) return null
  return response.data
}

export const acceptLobbyAnnouncement = async (
  lobbyId: string,
  announcementId: number,
): Promise<LobbyAnnouncementAcceptResponse> => {
  const normalizedLobbyId = String(lobbyId || '').trim()
  const response = await apiClient.post<LobbyAnnouncementAcceptResponse>(
    `/lobby/${normalizedLobbyId}/announcement/accept/`,
    { announcement_id: announcementId },
  )
  return response.data
}
