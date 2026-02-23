const normalize = (value = '') => {
  const output = value.trim()
  return output.endsWith('/') ? output.slice(0, -1) : output
}

const isBrowser = typeof window !== 'undefined'
const host = isBrowser ? window.location.host : ''
const wsProtocol = isBrowser && window.location.protocol === 'https:' ? 'wss' : 'ws'

const defaultRestBase = ''
const defaultWsBase = host ? `${wsProtocol}://${host}` : ''

export const REST_BASE_URL = normalize(import.meta.env.VITE_API_BASE_URL || defaultRestBase)
export const WS_BASE_URL = normalize(import.meta.env.VITE_WS_BASE_URL || defaultWsBase)
