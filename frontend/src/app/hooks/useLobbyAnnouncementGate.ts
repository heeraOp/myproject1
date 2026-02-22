import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import {
  acceptLobbyAnnouncement,
  fetchLobbyAnnouncement,
  type LobbyAnnouncementResponse,
} from '@/api/rest/lobbyAnnouncement'

type LobbyAnnouncementGateState = {
  open: boolean
  announcement: LobbyAnnouncementResponse | null
  loading: boolean
  accepting: boolean
  errorMessage: string
  accept: () => Promise<void>
  refresh: () => Promise<void>
}

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof AxiosError) {
    const detail = error.response?.data
    if (typeof detail === 'string' && detail.trim()) {
      return detail.trim()
    }
    if (detail && typeof detail === 'object') {
      const direct = (detail as { detail?: unknown }).detail
      if (typeof direct === 'string' && direct.trim()) {
        return direct.trim()
      }
    }
  }
  return fallback
}

const isAuthFailure = (error: unknown): boolean => {
  if (!(error instanceof AxiosError)) return false
  const status = Number(error.response?.status ?? 0)
  return status === 401 || status === 403
}

export const useLobbyAnnouncementGate = (
  lobbyId: string | null | undefined,
): LobbyAnnouncementGateState => {
  const [announcement, setAnnouncement] = useState<LobbyAnnouncementResponse | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const activeRequestRef = useRef(0)

  const loadAnnouncement = useCallback(async () => {
    const normalizedLobbyId = String(lobbyId ?? '').trim()
    if (!normalizedLobbyId) {
      setAnnouncement(null)
      setOpen(false)
      setErrorMessage('')
      return
    }

    const requestId = activeRequestRef.current + 1
    activeRequestRef.current = requestId
    setLoading(true)
    setErrorMessage('')

    try {
      const payload = await fetchLobbyAnnouncement(normalizedLobbyId)
      if (activeRequestRef.current !== requestId) return

      if (!payload || payload.is_accepted) {
        setAnnouncement(payload)
        setOpen(false)
        return
      }

      setAnnouncement(payload)
      setOpen(true)
    } catch (error) {
      if (activeRequestRef.current !== requestId) return
      if (isAuthFailure(error)) {
        // Backend enforces auth. If user is not authenticated, do not block lobby UI.
        setAnnouncement(null)
        setOpen(false)
        return
      }
      setErrorMessage(toErrorMessage(error, 'Unable to load lobby announcement.'))
      setAnnouncement(null)
      setOpen(false)
    } finally {
      if (activeRequestRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [lobbyId])

  useEffect(() => {
    void loadAnnouncement()
  }, [loadAnnouncement])

  const accept = useCallback(async () => {
    const normalizedLobbyId = String(lobbyId ?? '').trim()
    if (!normalizedLobbyId || !announcement || accepting) return

    setAccepting(true)
    setErrorMessage('')
    try {
      await acceptLobbyAnnouncement(normalizedLobbyId, announcement.id)
      setAnnouncement((previous) => (
        previous
          ? {
              ...previous,
              is_accepted: true,
            }
          : previous
      ))
      setOpen(false)
    } catch (error) {
      if (isAuthFailure(error)) {
        setErrorMessage('Please sign in to accept this announcement.')
        return
      }
      setErrorMessage(toErrorMessage(error, 'Unable to accept announcement. Please try again.'))
    } finally {
      setAccepting(false)
    }
  }, [accepting, announcement, lobbyId])

  return useMemo(
    () => ({
      open,
      announcement,
      loading,
      accepting,
      errorMessage,
      accept,
      refresh: loadAnnouncement,
    }),
    [accept, accepting, announcement, errorMessage, loadAnnouncement, loading, open],
  )
}
