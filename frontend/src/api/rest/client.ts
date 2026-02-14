import axios, { AxiosHeaders } from 'axios'
import { REST_BASE_URL } from '@/config'

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')

const baseURL = `${normalizeBaseUrl(REST_BASE_URL)}/api`

const UNSAFE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Global axios defaults (safe fallback for any future axios usage).
axios.defaults.withCredentials = true
axios.defaults.xsrfCookieName = 'csrftoken'
axios.defaults.xsrfHeaderName = 'X-CSRFToken'

export const getCSRFToken = (): string => {
  if (typeof document === 'undefined' || !document.cookie) return ''

  const csrfCookie = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('csrftoken='))

  if (!csrfCookie) return ''
  return decodeURIComponent(csrfCookie.split('=').slice(1).join('='))
}

const createClient = () => {
  const client = axios.create({
    baseURL,
    withCredentials: true,
    xsrfCookieName: 'csrftoken',
    xsrfHeaderName: 'X-CSRFToken',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  client.interceptors.request.use((config) => {
    // Axios equivalent of fetch credentials: "include".
    config.withCredentials = true

    const method = String(config.method || 'GET').toUpperCase()
    if (UNSAFE_HTTP_METHODS.has(method)) {
      const csrfToken = getCSRFToken()
      if (csrfToken) {
        const headers = AxiosHeaders.from(config.headers)
        headers.set('X-CSRFToken', csrfToken)
        config.headers = headers
      }
    }

    return config
  })

  return client
}

export const apiClient = createClient()
export const adminApiClient = createClient()
