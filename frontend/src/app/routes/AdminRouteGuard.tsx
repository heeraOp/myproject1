import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { fetchCurrentUser } from '@/api/rest/auth'

type GuardStatus = 'checking' | 'authorized' | 'unauthorized' | 'forbidden'

const AdminRouteGuard = () => {
  const location = useLocation()
  const [status, setStatus] = useState<GuardStatus>('checking')

  useEffect(() => {
    let cancelled = false

    const verifyAdminSession = async () => {
      setStatus('checking')
      try {
        const user = await fetchCurrentUser()
        if (cancelled) return
        setStatus(user.is_admin ? 'authorized' : 'forbidden')
      } catch (error) {
        if (cancelled) return
        const httpStatus = (
          error as {
            response?: {
              status?: number
            }
          }
        )?.response?.status
        if (httpStatus === 403) {
          setStatus('forbidden')
          return
        }
        setStatus('unauthorized')
      }
    }

    void verifyAdminSession()
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (status === 'checking') {
    return null
  }

  if (status === 'unauthorized') {
    return <Navigate to="/admin/login" replace state={{ from: location }} />
  }

  if (status === 'forbidden') {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export default AdminRouteGuard
