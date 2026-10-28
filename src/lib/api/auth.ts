import { BUILD } from '../update'
import { startWhatsNewAt } from '../whats-new'
import { api, ApiError, tokenStore } from './client'
import type { Profile } from './types'

function extractCsrf(html: string): string | null {
  const match = html.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/)
  return match ? match[1] : null
}

/**
 * Logs in against Baby Buddy's session login form, then reads the API key
 * from the profile endpoint. The token is what the app uses afterwards.
 */
export async function login(username: string, password: string): Promise<Profile> {
  const loginPage = await fetch('/login/', { credentials: 'same-origin' })
  const csrf = extractCsrf(await loginPage.text())
  if (!csrf) throw new Error('Could not start a login session with the server.')

  const form = new URLSearchParams({ csrfmiddlewaretoken: csrf, username, password, next: '/api/profile' })
  const res = await fetch('/login/', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    redirect: 'follow',
    headers: { Referer: `${location.origin}/login/` },
  })
  // A failed login re-renders the form (HTML, 200). Success lands on the JSON profile.
  const text = await res.text()
  if (res.status === 403) throw new Error('The server refused the login (origin check). Open the app from its own address, not a proxy.')
  let profile: Profile
  try {
    profile = JSON.parse(text) as Profile
  } catch {
    throw new Error('Wrong username or password.')
  }
  if (!profile.api_key) throw new Error('Login succeeded but no API key was returned.')
  tokenStore.set(profile.api_key)
  // A phone signing in for the first time starts its release notes here: a new caregiver gets no history.
  startWhatsNewAt(BUILD.version)
  return profile
}

export async function fetchProfile(): Promise<Profile | null> {
  if (!tokenStore.get()) return null
  try {
    return await api<Profile>('/api/profile')
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      tokenStore.clear()
      return null
    }
    throw err
  }
}

export function logout() {
  tokenStore.clear()
  // Best effort: end the Django session too so the Baby Buddy admin UI is signed out.
  void fetch('/logout/', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
}
