import { Navigate, Outlet } from 'react-router-dom'

const ADMIN_LOGGED_IN_KEY = 'adminLoggedIn'

const AdminRouteGuard = () => {
  const isLoggedIn = localStorage.getItem(ADMIN_LOGGED_IN_KEY) === 'true'

  if (!isLoggedIn) {
    return <Navigate to="/admin/login" replace />
  }

  return <Outlet />
}

export default AdminRouteGuard
