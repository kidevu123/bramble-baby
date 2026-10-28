/**
 * Minimal in-memory stand-in for the Baby Buddy API so end-to-end tests never touch real data.
 * Implements: session login → API key, /api/profile, children (by slug), timers (+timer-based
 * creation), and CRUD + child/date filters for every event endpoint Bramble uses.
 * Usage: [BB_USERS_FILE=/path/to/users.json] node e2e/mock-babybuddy.mjs [port=8000]
 */
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'

const PORT = Number(process.argv[2] ?? 8000)
const TOKEN = 'mocktoken0000000000000000000000000000000'
/**
 * Logins. With BB_USERS_FILE set to the users.json that server/testdata/fake_manage.py keeps, people created
 * from Settings › People through the companion can sign in here too (one household, one file). Without it,
 * there is only admin / admin.
 */
const USERS_FILE = process.env.BB_USERS_FILE
const DEFAULT_USERS = [{ id: 1, username: 'admin', first_name: '', is_staff: true, is_active: true, password: 'admin', token: TOKEN }]
const users = () => {
  if (USERS_FILE && existsSync(USERS_FILE)) {
    try { return JSON.parse(readFileSync(USERS_FILE, 'utf8')).users } catch { /* mid-write: fall through */ }
  }
  return DEFAULT_USERS
}
const userByToken = (token) => users().find((u) => u.token === token && u.is_active !== false) ?? null
const store = { children: [], timers: [] }
const collections = ['sleep', 'feedings', 'changes', 'pumping', 'tummy-times', 'temperature', 'medication', 'notes', 'weight', 'height', 'head-circumference']
for (const c of collections) store[c] = []
let nextId = 1
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const durationOf = (start, end) => {
  const secs = Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000))
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)) }
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)) })
const authed = (req) => {
  const header = req.headers.authorization ?? ''
  if (header.startsWith('Token ')) return userByToken(header.slice(6).trim())
  const cookie = (req.headers.cookie ?? '').match(/sessionid=([^;]+)/)
  return cookie ? userByToken(cookie[1]) : null
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  const raw = await readBody(req)
  let body = {}
  if (raw) { try { body = JSON.parse(raw) } catch { body = Object.fromEntries(new URLSearchParams(raw)) } }

  if (path === '/login/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<form><input type="hidden" name="csrfmiddlewaretoken" value="csrf123"></form>') }
  if (path === '/login/' && req.method === 'POST') {
    const user = users().find((u) => u.username.toLowerCase() === String(body.username ?? '').toLowerCase() && u.password === body.password && u.is_active !== false)
    if (!user) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<form>bad</form>') }
    res.writeHead(302, { Location: body.next || '/', 'Set-Cookie': `sessionid=${user.token}; Path=/` }); return res.end()
  }
  if (path === '/logout/') return json(res, 200, {})
  const me = authed(req)
  if (path === '/api/profile') return me ? json(res, 200, { user: { id: me.id, username: me.username, first_name: me.first_name ?? '', last_name: '', email: '', is_staff: Boolean(me.is_staff) }, language: 'en-US', timezone: 'UTC', api_key: me.token }) : json(res, 403, { detail: 'nope' })
  if (!path.startsWith('/api/')) return json(res, 404, { detail: 'not found' })
  if (!me) return json(res, 403, { detail: 'Authentication credentials were not provided.' })

  const parts = path.replace(/^\/api\//, '').replace(/\/$/, '').split('/')
  const [name, key] = parts
  const page = (items) => json(res, 200, { count: items.length, next: null, previous: null, results: items })

  if (name === 'children') {
    if (req.method === 'GET' && !key) return page(store.children)
    if (req.method === 'POST') { const c = { id: nextId++, picture: null, birth_time: null, last_name: '', ...body, slug: slugify(`${body.first_name} ${body.last_name ?? ''}`) || `child-${nextId}` }; store.children.push(c); return json(res, 201, c) }
    const c = store.children.find((x) => x.slug === key)
    if (!c) return json(res, 404, { detail: 'not found' })
    if (req.method === 'PATCH') { Object.assign(c, body); return json(res, 200, c) }
    if (req.method === 'DELETE') { store.children = store.children.filter((x) => x !== c); for (const col of collections) store[col] = store[col].filter((e) => e.child !== c.id); return json(res, 204) }
    return json(res, 200, c)
  }

  if (name === 'timers') {
    if (req.method === 'GET' && !key) return page(store.timers.map((t) => ({ ...t, duration: durationOf(t.start, new Date().toISOString()) })))
    if (req.method === 'POST') { const t = { id: nextId++, user: me.id, start: new Date().toISOString(), name: null, child: null, ...body }; store.timers.push(t); return json(res, 201, t) }
    const t = store.timers.find((x) => x.id === Number(key))
    if (!t) return json(res, 404, { detail: 'not found' })
    if (req.method === 'PATCH') { Object.assign(t, body); return json(res, 200, t) }
    if (req.method === 'DELETE') { store.timers = store.timers.filter((x) => x !== t); return json(res, 204) }
    return json(res, 200, t)
  }

  if (!collections.includes(name)) return json(res, 404, { detail: 'not found' })
  const col = store[name]
  const hasRange = ['sleep', 'feedings', 'pumping', 'tummy-times'].includes(name)
  if (req.method === 'GET' && !key) {
    let items = col
    const q = url.searchParams
    if (q.get('child')) items = items.filter((e) => e.child === Number(q.get('child')))
    const at = (e) => e.start ?? e.time ?? e.date
    if (q.get('start_min') || q.get('date_min')) items = items.filter((e) => new Date(at(e)) >= new Date(q.get('start_min') ?? q.get('date_min')))
    if (q.get('start_max') || q.get('date_max')) items = items.filter((e) => new Date(at(e)) <= new Date(q.get('start_max') ?? q.get('date_max')))
    return page(items)
  }
  if (req.method === 'POST') {
    const e = { id: nextId++, notes: '', tags: [], ...body }
    let consumed = null
    if (body.timer) {
      const t = store.timers.find((x) => x.id === Number(body.timer))
      if (!t) return json(res, 400, { timer: ['Timer not found'] })
      e.start = t.start; e.end = new Date().toISOString(); e.child = e.child ?? t.child
      consumed = t
      delete e.timer
    }
    // Real Baby Buddy: Pumping.amount is a non-nullable FloatField.
    if (name === 'pumping' && (e.amount === null || e.amount === undefined || e.amount === '')) return json(res, 400, { amount: ['This field may not be null.'] })
    if (hasRange) {
      if (new Date(e.end) <= new Date(e.start) && name !== 'feedings') return json(res, 400, { non_field_errors: ['End time must be after start time.'] })
      e.duration = durationOf(e.start, e.end)
      // Real Baby Buddy validates unique periods for sleep, feedings, pumping and tummy time alike.
      if (col.some((s) => s.child === e.child && new Date(s.start) < new Date(e.end) && new Date(s.end) > new Date(e.start) && new Date(e.end) > new Date(e.start))) return json(res, 400, { non_field_errors: ['Another entry intersects the specified time period.'] })
    }
    // Like the real serializer, the timer is stopped only after a successful save.
    if (consumed) store.timers = store.timers.filter((x) => x !== consumed)
    col.push(e); return json(res, 201, e)
  }
  const e = col.find((x) => x.id === Number(key))
  if (!e) return json(res, 404, { detail: 'not found' })
  if (req.method === 'PATCH') { Object.assign(e, body); if (hasRange) e.duration = durationOf(e.start, e.end); return json(res, 200, e) }
  if (req.method === 'DELETE') { store[name] = col.filter((x) => x !== e); return json(res, 204) }
  return json(res, 200, e)
}).listen(PORT, '127.0.0.1', () => console.log(`mock babybuddy on http://127.0.0.1:${PORT}`))
