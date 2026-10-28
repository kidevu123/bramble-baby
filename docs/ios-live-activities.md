# iPhone Live Activities for Bramble — plan

Status: proposal; owner decision needed (section 3).

## 1. Why this was not built in the web app

Live Activities (the Lock Screen card and the Dynamic Island) are drawn by a WidgetKit extension inside a
native iOS app, driven by Apple's ActivityKit framework. Safari and Home Screen web apps have no API for
this; nothing in HTML, JavaScript or Web Push can create, update or end one. The only two ways to change one
are the app's own process and an Apple push (APNs) addressed to that activity.
So Bramble needs a small native app around it. The web app stays the product; the native part is a shell.

## 2. Architecture

**"Bramble for iPhone"**: a Swift app with two targets.

- *App target*: a full-screen `WKWebView` loading the existing site from the home server (same HTTPS URL,
  same Baby Buddy token in `localStorage`, same companion endpoints). No service worker: the shell reloads
  `index.html` on return to the foreground when `src/lib/update.ts` reports a new build, which removes the
  "relaunch to update" behaviour of iOS Home Screen apps.
- *Widget extension target*: views for three `ActivityAttributes` types: `TimerActivity` (sleep / nursing /
  pumping; child, start date, nursing side), `NapActivity` (predicted nap time, window), `MilkActivity`
  (bag code, volume, expiry). Elapsed and countdown text uses `Text(timerInterval:)`, which ticks on its own,
  so pushes are needed only on changes (start, side switch, stop, bag used).

**JS ↔ Swift bridge.** The shell installs a `WKScriptMessageHandler` named `bramble`; the web app sees
`window.webkit.messageHandlers.bramble` and routes through a new `src/lib/native.ts` (PWA path unchanged
when the handler is absent). JSON messages: JS → Swift
`registerPush`, `activity.start|update|end {kind, id, state}`, `share {dataUrl, filename}`
(`UIActivityViewController`), `download {dataUrl, filename}`; Swift → JS via `evaluateJavaScript`:
`pushToken`, `activityToken {kind, id, token}`, `pushToStartToken {kind, token}`, `openedFromNotification`.
The web app forwards every token to the companion. Sources of truth stay put: Baby Buddy timers
(`useTimers`), `predictNap`, `milk_bags`.

**Pushes.** Live Activity pushes need APNs over HTTP/2 with token-based auth: an APNs auth key (`.p8`, key ID,
team ID), an ES256 JWT re-minted every 50 minutes (Apple requires between 20 and 60), headers
`apns-push-type: liveactivity`, `apns-topic: <bundle id>.push-type.liveactivity`, `apns-priority` 10 for
start/end and 5 for cosmetic updates (5 is outside the hourly budget). Payload: `aps.timestamp`, `aps.event`
(`start` | `update` | `end`), `aps.content-state`, optional `stale-date` / `dismissal-date`, and for `start`
(push-to-start, iOS 17.2+) `attributes-type`, `attributes`, `alert`. Content is capped at 4 KB; an activity
lives at most 8 hours, then 4 more on the Lock Screen. Push-to-start is what makes the second phone matter:
when Dad starts a sleep timer, Mom's phone gets `start` and shows the same running timer; a stop ends both.

**Changes to `server/bramble_server.py`** (companion 1.3.0):

- New dependency `httpx[http2]` (the stdlib has no HTTP/2; `httpx` pulls `h2`). `cryptography`, already in the
  venv for VAPID, signs the JWT. Env: `BRAMBLE_APNS_KEY`, `_KEY_ID`, `_TEAM_ID`, `_BUNDLE_ID`, `_ENV` (debug
  builds use the APNs sandbox host, TestFlight/App Store the production host; tokens are stored with their
  environment).
- New tables: `apns_devices (token PK, user_id, child, env, created)` for plain alerts, and
  `activity_tokens (token PK, kind, subject, user_id, env, is_push_to_start, updated)`; `subject` is the Baby
  Buddy timer id, `nap:<child>` or `milk:<bag id>`. Routes: `/push/apns/{register, activity-token,
  start-token, unregister}`.
- `Delivery._deliver` fans out to `subscriptions` (Web Push, unchanged) and `apns_devices`.
- New `ActivityPush` on the same 15 s loop: polls Baby Buddy `/api/timers/` with a service token, diffs
  snapshots, sends `start`/`update`/`end`; starts a milk activity when the "expiring soon" reminder fires and
  ends it when the bag leaves the stash; takes the nap window window from an extended `POST /push/schedule`,
  one countdown per child.
- `/health` gains `apns: {configured, env, problem}`; `Unregistered`/`BadDeviceToken` remove rows like
  today's 410s.

## 3. What the owner must provide or decide

1. **Apple Developer account, yes or no ($99/year).** Without it the app signs with a free Personal Team:
   the install expires after **7 days** and must be reinstalled from Xcode on this Mac, per phone, every week
   (max 3 such apps per device); and, decisively, a Personal Team has **no `aps-environment` entitlement**, so
   there are no push tokens. Live Activities still work with `pushType: nil`, but reflect only that phone's
   own app: the other caregiver's phone never updates, and a timer stopped elsewhere keeps counting on the
   Lock Screen until the app is reopened. With the account: TestFlight builds last
   **90 days**, up to 100 internal testers install from the TestFlight app with no cable and no review.
2. **Bundle id** (reverse-DNS, owner-controlled; it becomes the `apns-topic`).
3. **Device UDIDs** only if ad hoc distribution is chosen instead of TestFlight.
4. **The server's HTTPS hostname.** App Transport Security applies to `WKWebView`, and the QR scanner
   (`getUserMedia`) needs a secure context, so the shell loads the HTTPS name the PWA already uses; a
   plain-HTTP LAN address would need `NSAllowsLocalNetworking` and break the scanner. Keep it out of the repo
   (CLAUDE.md).

## 4. Phases (working hours, one engineer, this Mac)

| Phase | Scope | Hours |
|---|---|---|
| 1 Shell + native push | Xcode project, `WKWebView` with safe areas and persistent data store, camera permission delegate, external links in `SFSafariViewController`, share/download bridges, APNs registration, `native.ts`, companion `apns_devices` + alert fan-out, foreground reload | 20–28 |
| 2 Timer activity | Attributes, Lock Screen + Dynamic Island views, bridge calls, `activity_tokens`, APNs HTTP/2 client, timer poller, push-to-start for the second phone, >8 h sleep rollover | 24–32 |
| 3 nap window + milk | Two more attribute types and views, `/push/schedule` extension, milk reminder hook, end rules (sleep timer starts, bag used) | 12–16 |
| 4 TestFlight | App Store Connect record, icons, privacy manifest, internal group for both caregivers, deploy notes in CLAUDE.md | 4–6 |

Total 60–82 hours. An App Store release adds 10–20 hours and review risk (guideline 4.2, "web view
wrapper"); TestFlight internal testing needs no review.

**Risks**

- Inside `WKWebView`: camera works (iOS 14.3+, HTTPS, Info.plist key); `navigator.share` is absent
  (`labels.ts` already detects this; the bridge supplies it); blob downloads (`csv.ts`, "Save label") need
  `WKDownloadDelegate` or the bridge; Web Push, `PushManager` and `Notification` do not exist (Phase 1 fix).
- One codebase: every native capability goes through `native.ts` with a PWA fallback; no business logic in
  Swift.
- The companion needs a Baby Buddy service token to poll timers.
- APNs hourly budget: events are rare, but `update` pushes stay at priority 5 unless user-visible.

## 5. Recommendation

**Go, conditional on the $99 account. Without it, no-go.** For a two-caregiver household the value is the
shared, glanceable timer: Mom sees on her Lock Screen that the sleep Dad started is at 1 h 12 m, and it
disappears when he stops it. That needs APNs, which only a paid membership unlocks; the free version is a
single-phone novelty that breaks every seven days. If the account is bought, do Phase 1 first:
native push is more reliable than iOS Web Push and the foreground reload fixes the update annoyance, so it
pays off even if Phases 2 and 3 never start. Then Phase 2; defer Phase 3 until the timer card has been in
daily use for a few weeks and more Lock Screen cards are still wanted.
