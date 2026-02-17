const normalize = (value = '') => {
  const output = value.trim()
  return output.endsWith('/') ? output.slice(0, -1) : output
}

const isBrowser = typeof window !== 'undefined'
const hostname = isBrowser ? window.location.hostname : ''
const host = isBrowser ? window.location.host : ''
const isLocalDev = hostname === 'localhost'
const wsProtocol = isBrowser && window.location.protocol === 'https:' ? 'wss' : 'ws'

const defaultRestBase = isLocalDev ? 'http://localhost:8000' : ''
const defaultWsBase = isLocalDev ? 'ws://localhost:8000' : host ? `${wsProtocol}://${host}` : ''

export const REST_BASE_URL = normalize(import.meta.env.VITE_API_BASE_URL || defaultRestBase)
export const WS_BASE_URL = normalize(import.meta.env.VITE_WS_BASE_URL || defaultWsBase)
