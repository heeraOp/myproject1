import axios from 'axios'
import { REST_BASE_URL } from '@/config'

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')

const baseURL = `${normalizeBaseUrl(REST_BASE_URL)}/api`

const createClient = () =>
  axios.create({
    baseURL,
    withCredentials: true,
    xsrfCookieName: 'csrftoken',
    xsrfHeaderName: 'X-CSRFToken',
    headers: {
      'Content-Type': 'application/json',
    },
  })

export const apiClient = createClient()
export const adminApiClient = createClient()
