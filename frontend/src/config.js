const normalize = (value, fallback) => {
  const output = (value || fallback || '').trim()
  return output.endsWith('/') ? output.slice(0, -1) : output
}

const defaultHost =
  typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const defaultHttpProtocol =
  typeof window !== 'undefined' ? window.location.protocol : 'http:'
const defaultWsProtocol =
  defaultHttpProtocol === 'https:' ? 'wss:' : 'ws:'

export const REST_BASE_URL = normalize(
  import.meta.env.VITE_API_BASE_URL,
  `${defaultHttpProtocol}//${defaultHost}:8000`,
)
export const WS_BASE_URL = normalize(
  import.meta.env.VITE_WS_BASE_URL,
  `${defaultWsProtocol}//${defaultHost}:8000`,
)
