import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCurrentUser } from '@/api/rest/auth'
import { adminApiClient } from '@/api/rest/client'
import './AdminLogin.css'

const AdminLogin = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const ensureCsrf = async () => {
    try {
      await adminApiClient.get('/users/csrf/')
    } catch {
      // Ignore CSRF bootstrap failures and let backend validation respond.
    }
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await ensureCsrf()
      const response = await adminApiClient.post('/users/login/', { username, password })

      if (response?.data?.success) {
        const currentUser = await fetchCurrentUser()
        if (!currentUser.is_admin) {
          setError('You are logged in but do not have admin access.')
          return
        }
        navigate('/admin', { replace: true })
      } else {
        setError('Invalid credentials')
      }
    } catch (loginError) {
      let message = 'Invalid credentials'
      if (loginError && typeof loginError === 'object') {
        const typedError = loginError as {
          message?: string
          response?: { data?: { detail?: string } }
        }
        if (typedError.response?.data?.detail) {
          message = typedError.response.data.detail
        } else if (typeof typedError.message === 'string' && typedError.message) {
          message = typedError.message
        }
      }
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-panel">
        <div className="admin-login-hero">
          <p className="admin-login-kicker">Tambola Control Room</p>
          <h1>
            Run the
            <span> Live Game </span>
            with confidence.
          </h1>
          <p className="admin-login-subtitle">
            Configure games, manage tickets, and monitor winners in real time.
          </p>
          <div className="admin-login-badges">
            <span>Live Calling</span>
            <span>Prize Monitor</span>
            <span>Instant Reports</span>
          </div>
        </div>
        <form onSubmit={handleLogin} className="admin-login-form">
          <div className="admin-login-form-head">
            <h2>Admin Login</h2>
            <p>Use your admin credentials to continue.</p>
          </div>
          <label className="admin-login-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter username"
              autoComplete="username"
            />
          </label>
          <label className="admin-login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="admin-login-submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
          {error ? <div className="admin-login-error">{error}</div> : null}
        </form>
      </section>
    </main>
  )
}

export default AdminLogin
