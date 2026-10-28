const TOKEN_KEY = 'bramble.token'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    super(typeof body === 'string' ? body : `Request failed (${status})`)
    this.status = status
    this.body = body
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* storage unavailable: session-only */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  },
}

type Query = Record<string, string | number | boolean | undefined | null>

export function buildQuery(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { query?: Query; token?: string | null } = {},
): Promise<T> {
  const { query, token = tokenStore.get(), ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('Accept', 'application/json')
  if (rest.body && !(rest.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Token ${token}`)
  // 'omit': never send the Django session cookie to the API, otherwise DRF picks session auth and demands a CSRF token.
  const res = await fetch(`${path}${buildQuery(query)}`, { ...rest, headers, credentials: 'omit' })
  const body = await parseBody(res)
  if (!res.ok) throw new ApiError(res.status, body)
  // A JSON endpoint answering with HTML means we hit the SPA fallback (service not deployed) — treat as an error.
  if (typeof body === 'string' && body.trimStart().startsWith('<')) throw new ApiError(502, 'Unexpected HTML response')
  return body as T
}

/** Baby Buddy answers 403 for both a bad token and a real permission problem; only the former means "sign in again". */
function isAuthFailure(body: unknown): boolean {
  const detail = body && typeof body === 'object' ? String((body as { detail?: unknown }).detail ?? '') : typeof body === 'string' ? body : ''
  return /invalid token|not provided|credentials|authentication/i.test(detail) || detail === ''
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || (err.status === 403 && isAuthFailure(err.body))) return 'Your session expired. Please sign in again.'
    if (err.status === 403) return 'Baby Buddy refused this action for your account (permission denied).'
    if (err.body && typeof err.body === 'object') {
      const entries = Object.entries(err.body as Record<string, unknown>)
      const first = entries[0]
      if (first) {
        const [field, msgs] = first
        const msg = stripHtml(Array.isArray(msgs) ? msgs.join(' ') : String(msgs))
        // Baby Buddy's unique-period rule, in words a tired parent can act on.
        if (/intersects the specified time period/i.test(msg)) return 'These times overlap another entry of the same kind. Adjust Started or Finished (or edit that entry instead).'
        return field === 'non_field_errors' || field === 'detail' ? msg : `${field}: ${msg}`
      }
    }
    return `Something went wrong (${err.status}).`
  }
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.'
  return err instanceof Error ? err.message : 'Something went wrong.'
}
