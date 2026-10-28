import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { login } from '../../lib/api/auth'
import { tokenStore } from '../../lib/api/client'
import { qk } from '../../lib/api/keys'
import './auth.css'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname: string } } }
  const qc = useQueryClient()
  // Signed out: forget the last person's data here, once the page they left has unmounted. Cleared any earlier
  // (Sign out used a timer), Settings could still be on screen while the router's navigation finished, and its
  // queries refetched with no token: five refused requests per sign-out (e2e/full-sweep.sh).
  useEffect(() => {
    if (!tokenStore.get()) qc.clear()
  }, [qc])

  // Not while a sign-in is in flight: the explicit navigate() back to where the user came from must win.
  if (tokenStore.get() && !busy) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const profile = await login(username.trim(), password)
      qc.setQueryData(qk.profile, profile)
      navigate(location.state?.from?.pathname ?? '/', { replace: true })
      // Stay "busy" on success: resetting it here re-rendered this page with a token present, and the
      // <Navigate to="/"> above replaced the deep link we just navigated to.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.')
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-hero">
        <Logo className="auth-logo" />
        <h1>Bramble</h1>
        <p className="muted">Your baby's day, in one shared space.</p>
      </div>
      <form className="auth-card card" onSubmit={onSubmit}>
        <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={busy}>
          Sign in
        </Button>
        <p className="xs muted auth-foot">Uses your Baby Buddy account. Every caregiver signs in with their own login and sees the same data instantly.</p>
      </form>
    </main>
  )
}
