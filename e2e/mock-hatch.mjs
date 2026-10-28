/**
 * Minimal stand-in for Hatch's cloud (data.hatchbaby.com) for local runs of the Hatch Grow import.
 * Like mock-babybuddy.mjs it is not the real thing: it speaks what the Hatch Grow Android app expects
 * (see server/hatch_api.py), which is all the companion relies on.
 *
 *   node e2e/mock-hatch.mjs 8231
 *   BRAMBLE_HATCH_URL=http://127.0.0.1:8231 ... python3 server/bramble_server.py
 *
 * Sign in with owner@example.com / hatch. Steer it from a test with POST /__mock:
 *   {"reset": true}            back to one baby with three weeks of weighings
 *   {"babies": 2}              a second baby in the account
 *   {"weigh": 3120}            a new weighing right now (grams)
 *   {"listKey": "weightList"}  rename the list in the answers (an "unrecognised response")
 *   {"expire": true}           revoke the session: every data call answers 403 until the next login
 */
import http from 'node:http'

const PORT = Number(process.argv[2] ?? 8231)
const EMAIL = 'owner@example.com'
const PASSWORD = 'hatch'
const pad = (n) => String(n).padStart(2, '0')
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const daysAgo = (n, h = 9, m = 30) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d }

let state
function reset() {
  let id = 9000
  const weigh = (grams, when) => ({ id: ++id, weight: grams, rawWeight: grams, measurementTime: stamp(when), createDate: stamp(when), updateDate: stamp(when), deleted: false, manualEntry: false, details: null, category: 'SCP', lockStatus: 'W1', uniqueKey: null, uploaded: when.getTime() })
  state = {
    token: null,
    serial: 0,
    listKey: 'weights',
    babies: [{ id: 501, name: 'Oscar', birthDate: stamp(daysAgo(24)).slice(0, 10), birthWeight: 2420 }],
    weights: { 501: [weigh(2460, daysAgo(21, 10, 5)), weigh(2580, daysAgo(16, 8, 40)), weigh(2700, daysAgo(12, 14, 5)), weigh(2850, daysAgo(8, 9, 15)), weigh(2990, daysAgo(4, 19, 50)), weigh(3120, daysAgo(1, 7, 45))], 502: [weigh(3300, daysAgo(3, 11, 0))] },
    nextId: () => ++id,
    weigh,
  }
}
reset()

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(d ? JSON.parse(d) : {}) } catch { r({}) } }) })
const answer = (rows, extra = {}) => ({ status: 'success', message: 'ok', payload: { [state.listKey]: rows.map(({ uploaded, ...r }) => r), feedings: [], diapers: [], lengths: [], sleeps: [], ...extra }, sync: Date.now() })

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  const body = await readBody(req)

  if (path === '/__mock' && req.method === 'POST') {
    if (body.reset) reset()
    if (body.babies === 2 && state.babies.length === 1) state.babies.push({ id: 502, name: 'Nico', birthDate: state.babies[0].birthDate, birthWeight: 2600 })
    if (body.weigh) state.weights[501].push(state.weigh(Number(body.weigh), new Date()))
    if (body.listKey) state.listKey = String(body.listKey)
    if (body.expire) state.token = null
    return json(res, 200, { ok: true })
  }

  if (path === '/public/v1/login' && req.method === 'POST') {
    if (body.email !== EMAIL || body.password !== PASSWORD) return json(res, 200, { status: 'failure', message: `Login failed for [${body.email}]`, payload: null, sync: null, errorCode: '1001' })
    // Same shape as the community samples: base64("memberId:expiryMillis:signature").
    state.token = Buffer.from(`4321:${Date.now() + 365 * 86400000}:${String(++state.serial).padStart(32, '0')}`).toString('base64')
    return json(res, 200, { status: 'success', message: 'Successful login', payload: { id: 4321, email: EMAIL, firstName: 'Owner', babies: state.babies, defaultUnitOfMeasure: 'imperial', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, sync: Date.now(), token: state.token })
  }

  if (!path.startsWith('/service/')) return json(res, 404, { status: 404, error: 'Not Found', path })
  if (!state.token || req.headers['x-hatchbaby-auth'] !== state.token) return json(res, 403, { status: 'failure', message: 'not authenticated' })

  const parts = path.split('/').filter(Boolean)
  const all = state.weights[Number(parts[5])] ?? []
  if (parts[2] === 'pagedRefresh' && parts.length === 8) {
    const [start, end] = [parts[6], parts[7]]
    const earliest = all.map((w) => w.measurementTime).sort()[0] ?? null
    return json(res, 200, answer(all.filter((w) => w.measurementTime.slice(0, 10) >= start && w.measurementTime.slice(0, 10) <= end), { earliestEntry: earliest }))
  }
  if (parts[2] === 'refresh' && parts.length === 7) return json(res, 200, answer(all.filter((w) => w.uploaded >= Number(parts[6]))))
  return json(res, 404, { status: 404, error: 'Not Found', path })
}).listen(PORT, '127.0.0.1', () => console.log(`mock hatch on http://127.0.0.1:${PORT}`))
