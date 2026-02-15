import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Lobby from '@/screens/lobby/Lobby'
import LiveGame from '@/screens/live-game/LiveGame'
import GameFinished from '@/screens/game-finished/GameFinished'
import AdminDashboard from '@/screens/admin-dashboard/AdminDashboard'
import AdminTicketView from '@/screens/admin-ticket-view/AdminTicketView'
import AdminLogin from '@/screens/admin-login/AdminLogin'
import AdminRouteGuard from '@/app/routes/AdminRouteGuard'
import ThemeOverlayProvider from '@/theme/ThemeProvider'
import { ThemeProvider } from '@/theme/ThemeContext'
import ThemeToggle from '@/theme/ThemeToggle'

function App() {
  const location = useLocation()
  const showThemeToggle = location.pathname.startsWith('/admin')

  return (
    <ThemeProvider>
      <ThemeOverlayProvider>
        {showThemeToggle ? <ThemeToggle /> : null}
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/live" element={<LiveGame />} />
          <Route path="/finished" element={<GameFinished />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminRouteGuard />}>
            <Route index element={<AdminDashboard />} />
            <Route path="run" element={<AdminDashboard />} />
            <Route path="book" element={<AdminDashboard />} />
            <Route path="list" element={<AdminDashboard />} />
            <Route path="prizes" element={<AdminDashboard />} />
            <Route path="poster" element={<AdminDashboard />} />
            <Route path="tickets" element={<AdminTicketView />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
          <Route path="/api/*" element={<Navigate to="/admin/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ThemeOverlayProvider>
    </ThemeProvider>
  )
}

export default App
