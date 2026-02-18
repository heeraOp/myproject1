import { adminApiClient } from '@/api/rest/client'

export type CurrentUserResponse = {
  id: number
  username: string
  role: string | null
  is_staff: boolean
  is_superuser: boolean
  is_admin: boolean
  authenticated: boolean
}

export const fetchCurrentUser = async (): Promise<CurrentUserResponse> => {
  const response = await adminApiClient.get<CurrentUserResponse>('/users/me/')
  return response.data
}

export const logoutCurrentUser = async (): Promise<void> => {
  try {
    await adminApiClient.get('/users/csrf/')
  } catch {
    // Ignore CSRF bootstrap failures and let backend validation respond.
  }
  await adminApiClient.post('/users/logout/')
}
