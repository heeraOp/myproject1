import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { fetchCurrentPublicGame } from '@/api/rest/games'
import './index.css'
import App from './App.tsx'
import { initGlobalAudioUnlock } from './utils/audioEngine'
import { initTheme, setAdminTheme } from './utils/theme'

initTheme()
initGlobalAudioUnlock()
void (async () => {
  try {
    const currentGame = await fetchCurrentPublicGame()
    if (currentGame?.active_theme) {
      setAdminTheme(currentGame.active_theme)
    }
  } catch {
    // Keep local/default theme if admin theme is unavailable.
  }
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
