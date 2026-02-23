import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendHttpTarget = env.VITE_BACKEND_HTTP_TARGET || 'http://localhost:8000'
  const backendWsTarget = env.VITE_BACKEND_WS_TARGET || 'ws://localhost:8000'
  const vitePort = Number(env.VITE_PORT || 5173)

  return {
    plugins: [react(), tsconfigPaths()],
    server: {
      host: true,
      port: Number.isFinite(vitePort) ? vitePort : 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendHttpTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: backendWsTarget,
          changeOrigin: true,
          ws: true,
        },
        '/media': {
          target: backendHttpTarget,
          changeOrigin: true,
        },
        '/static': {
          target: backendHttpTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
