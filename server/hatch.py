"""Hatch Grow scale weights -> Baby Buddy weight entries.

The owner signs in to their Hatch account once from Settings. This module then pulls weights from
Hatch's cloud on a timer and writes each new one to Baby Buddy as a weight entry for the mapped child.

  * Hatch's routes and field names live in hatch_api.py and nowhere else.
  * `hatch_weights` is the ledger, keyed on the Hatch record id: a record is written to Baby Buddy at
    most once, across re-syncs, restarts, and a disconnect followed by a new sign-in.
  * Hand-typed weights are never doubled up. The first import (the backlog) leaves any day that already
    has a weight in Baby Buddy alone. After that a new Hatch weighing is skipped only when the same
    value (within MATCH_TOLERANCE_G) was already typed for that day.
  * Hatch reports grams. Baby Buddy stores a bare number in the child's storage unit, which the app
    recorded once in this service's own `settings` table (`storageUnits.weight`); it is read from there.
  * Secrets (the Hatch token, and the Baby Buddy token of the caregiver who connected, which the
    background sync needs to write entries) sit in `<data dir>/hatch.json`, mode 0600. The Hatch
    password is used once for the sign-in and never stored. No endpoint returns either token.
  * Every Hatch call leaves a line in `hatch_log` (route, HTTP status, key names of the answer, never
    values or tokens). `status()["report"]` renders it so one copy-paste settles a wrong mapping.

Standard library only, like the rest of the server.
"""
from __future__ import annotations

import http.client
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

import hatch_api as api
from hatch_api import HatchProblem

log = logging.getLogger("bramble.hatch")

POLL_MINUTES = max(5, int(os.environ.get("BRAMBLE_HATCH_POLL_MIN", "15") or 15))
FIRST_POLL_SECONDS = 20
RATE_BACKOFF = timedelta(minutes=60)
PAGE_DAYS = 7  # the app walks history one week per request
MAX_PAGES = 160  # three years of weeks; a hard stop if Hatch never names an earliest entry
SWEEP_EVERY = timedelta(hours=24)  # how often the last week is re-read as a safety net behind the "since" route
SOFT = ("missing", "shape", "refused")  # failures of one route that are worth trying the other route for
CURSOR_OVERLAP_MS = 10 * 60 * 1000
MATCH_TOLERANCE_G = 30.0  # about one ounce: a hand-typed copy of the same weighing
# A typed weight whose note carries a clock more than this far from the scale's weighing is another weighing (the
# hospital's or the doctor's scale the same day), never a copy of it, whatever its value.
MATCH_WINDOW_MIN = 60
GRAMS_PER = {"kg": 1000.0, "lb": 453.59237}
STORED_DECIMALS = 6  # same precision the app uses when it converts to storage units
LOG_KEEP = 30
CONNECT_LIMIT, CONNECT_WINDOW = 5, 600  # sign-in attempts per ten minutes, to stay clear of Hatch's own lockout
NOTE_SCALE, NOTE_APP = "Hatch Grow scale", "Hatch app"
# Baby Buddy keeps only a date for a weight, so the clock of the weighing rides in the note as one " · "
# segment ("8:38 AM": 12-hour, two-digit minutes, AM/PM), after the source word: "Hatch Grow scale · 8:38 AM".
# The app (src/lib/growth-note.ts) reads that segment from any position and writes it back where it found it.
TIME_SEGMENT = re.compile(r"^(1[0-2]|[1-9]):[0-5]\d [AP]M$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS hatch_account (
  id INTEGER PRIMARY KEY CHECK (id = 1), email TEXT NOT NULL DEFAULT '', connected_at TEXT, connected_by INTEGER,
  needs_login INTEGER NOT NULL DEFAULT 0, session_expires TEXT, timezone TEXT,
  last_attempt TEXT, last_success TEXT, problem TEXT);
CREATE TABLE IF NOT EXISTS hatch_babies (
  hatch_id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', birth_date TEXT,
  child INTEGER, backfilled INTEGER NOT NULL DEFAULT 0, cursor INTEGER, source TEXT, swept_at TEXT);
CREATE TABLE IF NOT EXISTS hatch_weights (
  hatch_id INTEGER PRIMARY KEY, baby INTEGER NOT NULL, child INTEGER, grams REAL NOT NULL, measured_at TEXT NOT NULL,
  manual INTEGER, note TEXT NOT NULL DEFAULT '', backlog INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', bb_id INTEGER, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hatch_weights_baby ON hatch_weights (baby, status);
CREATE TABLE IF NOT EXISTS hatch_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, entry TEXT NOT NULL);
"""

# Plain-language problem lines shown in Settings. `needs_login` is the only one the owner fixes by signing in.
MESSAGES = {
    "needs_login": "Hatch signed Bramble out. Sign in again to keep weights coming.",
    "rate_limited": "Hatch is limiting requests right now. Bramble will try again in about an hour.",
    "hatch_unreachable": "Bramble could not reach Hatch. It will keep trying.",
    "shape": "Hatch answered, but not in the form Bramble expects, so nothing was imported. Copy the report below and send it to whoever looks after Bramble.",
    "no_route": "Hatch no longer answers where Bramble asks for weights, so nothing was imported. Copy the report below and send it to whoever looks after Bramble.",
    "hatch_refused": "Hatch refused the request for this baby, so nothing was imported. Copy the report below and send it to whoever looks after Bramble.",
    "units": "Bramble has not recorded this household's weight unit yet. Open Bramble's Home screen once, then tap Sync now.",
    "babybuddy_auth": "Bramble's own sign-in to Baby Buddy needs refreshing. Tap Sync now.",
    "babybuddy": "Baby Buddy did not accept some weights. Bramble will try them again.",
}
PROBLEM_FOR = {"auth": "needs_login", "rate": "rate_limited", "unreachable": "hatch_unreachable", "shape": "shape", "missing": "no_route", "refused": "hatch_refused"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def typed_clock(notes: object) -> int | None:
    """Minutes after midnight of the clock segment in a weight's note ("10:15 AM" -> 615), or None without one."""
    for part in str(notes or "").split(" · "):
        part = part.strip()
        if TIME_SEGMENT.match(part):
            hm, half = part.split(" ")
            h, m = (int(x) for x in hm.split(":"))
            return (h % 12 + (12 if half == "PM" else 0)) * 60 + m
    return None


def near_in_time(typed: dict, measured_at: str) -> bool:
    """A typed weight with no clock may be the same weighing; one with a clock must be within MATCH_WINDOW_MIN."""
    clock = typed_clock(typed.get("notes"))
    if clock is None:
        return True
    when = datetime.fromisoformat(measured_at)
    return abs(clock - (when.hour * 60 + when.minute)) <= MATCH_WINDOW_MIN


def time_segment(when: datetime) -> str:
    """The note's clock segment for a local wall time: "12:05 AM", "8:38 AM", "12:00 PM", "7:10 PM". Locale-free."""
    return f"{when.hour % 12 or 12}:{when.minute:02d} {'AM' if when.hour < 12 else 'PM'}"


class Halt(Exception):
    """Stops the current sync with a problem code from MESSAGES."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code, self.detail = code, detail


class Secrets:
    """The tokens, in one owner-only file next to the database. Never logged, never returned."""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()

    def read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def update(self, **changes: str | None) -> None:
        with self.lock:
            data = {k: v for k, v in {**self.read(), **changes}.items() if v}
            tmp = self.path + ".tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)

    def clear(self) -> None:
        with self.lock:
            try:
                os.remove(self.path)
            except FileNotFoundError:
                pass


class BabyBuddy:
    """The few Baby Buddy calls the importer needs, with the stored caregiver token."""

    def __init__(self, url: str, host_header: str | None):
        self.url, self.host_header = url.rstrip("/"), host_header

    def call(self, token: str, method: str, path: str, body: dict | None = None) -> object:
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None, method=method)
        req.add_header("Authorization", f"Token {token}")
        req.add_header("Accept", "application/json")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if self.host_header:
            req.add_header("Host", self.host_header)
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                raw = res.read()
            return json.loads(raw.decode() or "null") if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:200]
            exc.close()
            if exc.code in (401, 403):
                raise Halt("babybuddy_auth", f"Baby Buddy answered {exc.code}") from None
            raise Halt("babybuddy", f"Baby Buddy answered {exc.code} to {method} {path.split('?')[0]}: {detail}") from None
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as exc:
            raise Halt("babybuddy", f"Baby Buddy is not reachable ({type(exc).__name__})") from None

    def list(self, token: str, path: str, **query) -> list[dict]:
        rows: list[dict] = []
        while True:
            page = self.call(token, "GET", f"{path}?{urlencode({**query, 'limit': 100, 'offset': len(rows)})}")
            results = page.get("results") if isinstance(page, dict) else None
            if not isinstance(results, list):
                raise Halt("babybuddy", f"Baby Buddy's {path} list is not in the expected form")
            rows.extend(r for r in results if isinstance(r, dict))
            if len(results) < 100 or len(rows) >= int(page.get("count") or 0) or len(rows) >= 5000:
                return rows


class Hatch:
    def __init__(self, store, babybuddy_url: str, host_header: str | None = None, data_dir: str | None = None):
        self.store = store
        store.conn.executescript(SCHEMA)
        self.base = os.environ.get("BRAMBLE_HATCH_URL", api.DEFAULT_BASE)
        self.secrets = Secrets(os.path.join(data_dir or os.path.dirname(os.path.abspath(store.path)), "hatch.json"))
        self.bb = BabyBuddy(babybuddy_url, host_header)
        self.page_pause = 0.2  # seconds between history pages; tests set 0
        self.syncing = False
        self._sync_lock = threading.Lock()
        self._state_lock = threading.Lock()  # account row + secrets file change together
        self._epoch = 0  # bumped by disconnect; a run started under an older epoch stops writing
        self._run_epoch = 0
        self._wake, self._stop = threading.Event(), threading.Event()
        self._thread = threading.Thread(target=self._loop, name="bramble-hatch", daemon=True)
        self._attempts: list[float] = []
        self._backoff_until: datetime | None = None
        self._sweep = False  # set by Sync now: also re-read the last week
        # Set by App: called with (child, hatch_id, grams, measured_at, backlog) after a weighing is written
        # to Baby Buddy, so a push can say "new weight from the Hatch" (nudges.py). Never for matched rows.
        self.on_weight = None

    # ---- background poll
    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def _loop(self) -> None:
        wait = FIRST_POLL_SECONDS
        while not self._stop.is_set():
            self._wake.wait(wait)
            self._wake.clear()
            wait = POLL_MINUTES * 60
            if self._stop.is_set():
                break
            try:
                self.run_once()
            except Exception:  # pragma: no cover - never let the poll thread die
                log.exception("hatch sync failed")

    def trigger(self) -> None:
        """Sync now: wake the poll thread, or run inline when it is not running (tests, one-off scripts)."""
        self._backoff_until = None
        self._sweep = True
        if self._thread.is_alive():
            self.syncing = True
            self._wake.set()
        else:
            self.run_once()

    # ---- state
    def account(self) -> dict | None:
        rows = self.store.q("SELECT * FROM hatch_account WHERE id=1")
        return rows[0] if rows and rows[0]["connected_at"] else None

    def babies(self) -> list[dict]:
        return self.store.q("SELECT * FROM hatch_babies ORDER BY hatch_id")

    def _set(self, **cols) -> None:
        sets = ", ".join(f"{k}=?" for k in cols)
        self.store.x(f"UPDATE hatch_account SET {sets} WHERE id=1", list(cols.values()))

    def _problem(self, code: str | None, detail: str = "") -> None:
        if code:
            log.warning("hatch: %s%s", code, f" ({detail})" if detail else "")
        self._set(problem=json.dumps({"code": code, "message": MESSAGES[code], "detail": detail, "at": _now()}) if code else None)

    def _log(self, entry: dict, always: bool = False) -> None:
        # A sync that was disconnected under it must not keep writing; a sign-in (always=True) is not a sync
        # and is logged even right after a disconnect, when no run has caught up with the new epoch yet.
        if not always and not self._live():
            return
        self.store.x("INSERT INTO hatch_log (at, entry) VALUES (?, ?)", (_now(), json.dumps(entry)))
        self.store.x("DELETE FROM hatch_log WHERE id <= (SELECT MAX(id) FROM hatch_log) - ?", (LOG_KEEP,))

    def _today(self, acct: dict | None) -> date:
        """Today on the member's calendar (the server may sit in another timezone)."""
        return datetime.now(self._tz(acct)).date()

    def _tz(self, acct: dict | None):
        try:
            from zoneinfo import ZoneInfo

            return ZoneInfo(acct["timezone"]) if acct and acct.get("timezone") else None
        except Exception:
            return None

    def status(self) -> dict:
        acct = self.account()
        counts = {(r["baby"], r["status"]): r["n"] for r in self.store.q("SELECT baby, status, COUNT(*) AS n FROM hatch_weights GROUP BY baby, status")}
        babies = [
            {"id": b["hatch_id"], "name": b["name"], "child": b["child"], "imported": counts.get((b["hatch_id"], "imported"), 0), "matched": counts.get((b["hatch_id"], "matched"), 0), "pending": counts.get((b["hatch_id"], "pending"), 0)}
            for b in (self.babies() if acct else [])
        ]
        problem = json.loads(acct["problem"]) if acct and acct["problem"] else None
        return {
            "connected": bool(acct),
            "email": acct["email"] if acct else None,
            "needsLogin": bool(acct and acct["needs_login"]),
            "syncing": self.syncing,
            "babies": babies,
            "imported": sum(b["imported"] for b in babies),
            "matched": sum(b["matched"] for b in babies),
            "pending": sum(b["pending"] for b in babies),
            "lastSync": acct["last_attempt"] if acct else None,
            "lastSuccess": acct["last_success"] if acct else None,
            "sessionExpires": acct["session_expires"] if acct else None,
            "pollMinutes": POLL_MINUTES,
            "problem": {k: problem[k] for k in ("code", "message", "at")} if problem else None,
            "report": self.report(acct, babies, problem) if acct else None,
        }

    def report(self, acct: dict, babies: list[dict], problem: dict | None) -> str:
        """Plain text the owner can copy out of Settings. Routes, status codes and key names only."""
        lines = [
            "Bramble / Hatch report",
            f"state: {'needs sign-in' if acct['needs_login'] else 'connected'} since {acct['connected_at']}, last try {acct['last_attempt']}, last success {acct['last_success']}",
            f"session: {acct['session_expires'] or 'expiry not readable from the token'}; timezone {acct['timezone'] or 'unknown'}",
            "babies: " + ("; ".join(f"hatch {b['id']} -> child {b['child']} (imported {b['imported']}, already in Bramble {b['matched']}, waiting {b['pending']})" for b in babies) or "none"),
            f"problem: {problem['code']} - {problem.get('detail') or problem['message']}" if problem else "problem: none",
            "latest weighings from Hatch (as Hatch sent them), newest first:",
        ]
        where = {"imported": "in Bramble", "updating": "changed in Hatch, updating Bramble", "pending": "waiting", "matched": "a weight the family typed that day", "removing": "deleted in Hatch, removing", "removed": "deleted in Hatch"}
        for w in self.store.q("SELECT grams, measured_at, status FROM hatch_weights ORDER BY measured_at DESC, hatch_id DESC LIMIT 6"):
            when = datetime.fromisoformat(w["measured_at"])
            lb_total = float(w["grams"]) / GRAMS_PER["lb"]
            lb, oz = int(lb_total), (lb_total - int(lb_total)) * 16
            lines.append(f"- {when:%Y-%m-%d} {time_segment(when)} {float(w['grams']):.0f} g ({lb} lb {oz:.1f} oz) {where.get(w['status'], w['status'])}")
        lines.append("recent Hatch requests, newest first:")
        for row in self.store.q("SELECT at, entry FROM hatch_log ORDER BY id DESC LIMIT 8"):
            e = json.loads(row["entry"])
            lines.append(f"- {row['at']} {e.get('method', 'GET')} {e.get('path')} -> {e.get('http')} {e.get('outcome')}" + (f" ({e['detail']})" if e.get("detail") else ""))
            shape = e.get("shape") or {}
            for key in ("keys", "message", "errorCode", "payload", "records"):
                if shape.get(key) not in (None, [], {}):
                    lines.append(f"    {key}: {json.dumps(shape[key], ensure_ascii=False)}")
            if e.get("count") is not None:
                lines.append(f"    weights read: {e['count']}, unreadable: {e.get('unreadable', 0)}")
        return "\n".join(lines)

    # ---- http surface (the caller is already a signed-in Bramble user)
    def http(self, method: str, parts: list[str], data: dict, user_id: int, token: str | None):
        action = parts[1] if len(parts) == 2 else None
        if len(parts) > 2:
            return 404, {"detail": "Not found."}
        # Any caregiver opening the sheet refreshes the Baby Buddy token the background sync writes with.
        # Checked and written under the state lock so a concurrent disconnect cannot leave the token behind.
        with self._state_lock:
            connected = bool(self.account())
            if connected and token and self.secrets.read().get("bb_token") != token:
                self.secrets.update(bb_token=token)
        if action is None:
            return (200, self.status()) if method == "GET" else (405, {"detail": "Method not allowed."})
        if action == "connect" and method == "POST":
            return self.connect(data, user_id, token)
        if not connected:
            return 409, {"detail": "Hatch is not connected."}
        if action == "disconnect" and method == "POST":
            return 200, self.disconnect()
        if action == "sync" and method == "POST":
            self.trigger()
            return 200, self.status()
        if action == "babies" and method == "PUT":
            return self.map_babies(data, token)
        return 404, {"detail": "Not found."}

    def connect(self, data: dict, user_id: int, bb_token: str | None):
        email, password = str(data.get("email") or "").strip().lower(), str(data.get("password") or "")
        if "@" not in email or not password or len(email) > 254 or len(password) > 256:
            return 400, {"detail": "Enter the email and password of your Hatch account."}
        now = time.monotonic()
        self._attempts = [t for t in self._attempts if t > now - CONNECT_WINDOW]
        if len(self._attempts) >= CONNECT_LIMIT:
            return 429, {"detail": "Too many sign-in attempts. Wait ten minutes and try again."}
        self._attempts.append(now)
        entry: dict = {"method": "POST", "path": api.LOGIN_PATH, "source": "login"}
        try:
            status, body = api.request(self.base, "POST", api.LOGIN_PATH, body={"email": email, "password": password})
        except HatchProblem:
            self._log({**entry, "http": None, "outcome": "unreachable"}, always=True)
            return 503, {"detail": "Bramble could not reach Hatch. Check the server's internet connection and try again."}
        # The login answer carries the token and the profile: only its key names are kept.
        entry.update(http=status, shape={k: v for k, v in api.describe(body).items() if k != "records"})
        if status == 429:
            self._log({**entry, "outcome": "rate"}, always=True)
            return 429, {"detail": "Hatch is limiting sign-ins right now. Wait a few minutes and try again."}
        ok = status == 200 and isinstance(body, dict) and body.get("status") == "success"
        token = body.get("token") if ok else None
        if ok and not (isinstance(token, str) and token and isinstance(body.get("payload"), dict)):
            self._log({**entry, "outcome": "shape"}, always=True)
            return 502, {"detail": "Hatch accepted the sign-in but answered in a form Bramble does not expect. Nothing was saved."}
        if not ok:
            self._log({**entry, "outcome": "refused" if status == 200 else "error"}, always=True)
            if status == 200 and isinstance(body, dict) and body.get("status") == "failure":
                return 400, {"detail": "Hatch did not accept that email and password."}
            return 502, {"detail": f"Hatch answered the sign-in with an error ({status}). Try again in a few minutes."}
        self._log({**entry, "outcome": "ok"}, always=True)
        payload = body["payload"]
        with self._state_lock:
            self._write_account(email, user_id, token, bb_token, payload)
        self._automap(bb_token)
        log.info("hatch: connected (%d babies)", len(payload.get("babies") or []))
        self.trigger()
        return 200, self.status()

    def _write_account(self, email: str, user_id: int, token: str, bb_token: str | None, payload: dict) -> None:
        self.secrets.update(hatch_token=token, bb_token=bb_token)
        with self.store.atomic():
            self.store.x(
                "INSERT INTO hatch_account (id, email, connected_at, connected_by, needs_login, session_expires, timezone, problem) VALUES (1,?,?,?,0,?,?,NULL) "
                "ON CONFLICT(id) DO UPDATE SET email=excluded.email, connected_at=excluded.connected_at, connected_by=excluded.connected_by, needs_login=0, session_expires=excluded.session_expires, timezone=excluded.timezone, problem=NULL",
                (email, _now(), user_id, api.token_expiry(token), str(payload.get("timezone") or "") or None),
            )
            seen = []
            for b in payload.get("babies") if isinstance(payload.get("babies"), list) else []:
                if not isinstance(b, dict) or not isinstance(b.get("id"), int) or isinstance(b.get("id"), bool):
                    continue
                seen.append(b["id"])
                day = api.parse_day(b.get("birthDate"))
                self.store.x(
                    "INSERT INTO hatch_babies (hatch_id, name, birth_date) VALUES (?,?,?) ON CONFLICT(hatch_id) DO UPDATE SET name=excluded.name, birth_date=excluded.birth_date",
                    (b["id"], str(b.get("name") or "")[:80], day.isoformat() if day else None),
                )
            self.store.x(f"DELETE FROM hatch_babies WHERE hatch_id NOT IN ({','.join('?' * len(seen))})" if seen else "DELETE FROM hatch_babies", seen)

    def _automap(self, bb_token: str | None) -> None:
        """One Hatch baby and one Bramble child: no question to ask."""
        babies = self.babies()
        if len(babies) != 1 or babies[0]["child"] is not None or not bb_token:
            return
        try:
            children = self.bb.list(bb_token, "/api/children/")
        except Halt:
            return
        if len(children) == 1 and isinstance(children[0].get("id"), int):
            self.store.x("UPDATE hatch_babies SET child=? WHERE hatch_id=?", (children[0]["id"], babies[0]["hatch_id"]))

    def map_babies(self, data: dict, bb_token: str | None):
        """{babies: [{id, child}]}: child is a Baby Buddy child id, or 0 for "do not import this baby"."""
        wanted = data.get("babies")
        if not isinstance(wanted, list):
            return 400, {"detail": "babies must be a list."}
        known = {b["hatch_id"] for b in self.babies()}
        try:
            children = {c.get("id") for c in self.bb.list(bb_token or "", "/api/children/")}
        except Halt:
            children = None  # Baby Buddy unreachable right now: the import itself will report it
        # Check every row before writing any: a refused request changes nothing and starts no import.
        mapping: list[tuple[int, int]] = []
        for item in wanted:
            if not isinstance(item, dict) or item.get("id") not in known:
                return 400, {"detail": "Unknown Hatch baby."}
            try:
                child = int(item.get("child") or 0)
            except (TypeError, ValueError):
                return 400, {"detail": "Unknown child."}
            if child and children is not None and child not in children:
                return 400, {"detail": "Unknown child."}
            mapping.append((child, item["id"]))
        with self.store.atomic():
            for child, hatch_id in mapping:
                self.store.x("UPDATE hatch_babies SET child=? WHERE hatch_id=?", (child, hatch_id))
        self.trigger()
        return 200, self.status()

    def disconnect(self) -> dict:
        """Forget the account and both tokens. The ledger stays, so signing in again never re-imports."""
        with self._state_lock:
            self._epoch += 1  # a sync already running stops writing at its next check
            with self.store.atomic():
                self.store.x("DELETE FROM hatch_account")
                self.store.x("DELETE FROM hatch_babies")
                self.store.x("DELETE FROM hatch_log")
            self.secrets.clear()
        log.info("hatch: disconnected")
        return self.status()

    # ---- sync
    def run_once(self) -> dict:
        with self._sync_lock:
            self.syncing = True
            try:
                self._run()
            finally:
                self.syncing = False
        return self.status()

    def _live(self) -> bool:
        """False once the owner disconnected under the run that is still going."""
        return self._epoch == self._run_epoch

    def _run(self) -> None:
        self._run_epoch = self._epoch
        acct = self.account()
        if not acct or acct["needs_login"]:
            return
        if self._backoff_until and datetime.now(timezone.utc) < self._backoff_until:
            return
        secrets = self.secrets.read()
        token, bb_token = secrets.get("hatch_token"), secrets.get("bb_token")
        if not token:
            self._set(needs_login=1)
            return self._problem("needs_login", "no stored session")
        mapped = [b for b in self.babies() if b["child"]]
        if not mapped:
            return  # waiting for the owner to pick a child; the sheet asks
        self._set(last_attempt=_now())
        sweep, self._sweep = self._sweep, False
        # One baby's trouble must not hold back the next; the first problem is the one reported.
        first: HatchProblem | Halt | None = None
        for baby in mapped:
            if not self._live():
                return
            try:
                self._sync_baby(acct, baby, token, bb_token, sweep)
            except HatchProblem as exc:
                first = first or exc
                if exc.code == "auth":
                    break  # the session is gone for every baby
            except Halt as exc:
                first = first or exc
        if not self._live():
            return
        if isinstance(first, HatchProblem):
            if first.code == "auth":
                self.secrets.update(hatch_token=None)
                self._set(needs_login=1)
            if first.code == "rate":
                self._backoff_until = datetime.now(timezone.utc) + RATE_BACKOFF
            return self._problem(PROBLEM_FOR[first.code], first.detail)
        if first:
            return self._problem(first.code, first.detail)
        self._set(last_success=_now())
        self._problem(None)

    def _fetch(self, acct: dict, baby: dict, source: str, token: str, **params) -> dict:
        """One sync request, parsed. Always leaves a log line; raises HatchProblem when unusable."""
        path = api.SOURCES[source].format(baby=baby["hatch_id"], **params)
        entry: dict = {"method": "GET", "path": path, "source": source, "http": None}
        try:
            status, body = api.request(self.base, "GET", path, token=token)
            entry["http"] = status
            entry["shape"] = api.describe(body)
            api.classify(status, body)
            result = api.parse_weights(body, self._tz(acct))
        except HatchProblem as exc:
            self._log({**entry, "outcome": exc.code, "detail": exc.detail})
            raise
        entry["shape"].pop("message", None)
        self._log({**entry, "outcome": "ok", "count": len(result["records"]), "unreadable": result["unreadable"]})
        return result

    def _history(self, acct: dict, baby: dict, token: str) -> tuple[list[dict], int | None]:
        """Everything Hatch has for this baby, the way the app loads it: week-sized pages, newest first."""
        today = self._today(acct)
        floor = api.parse_day(baby["birth_date"]) or today - timedelta(days=365)
        records: dict[int, dict] = {}
        sync, end = None, today
        for page in range(MAX_PAGES):
            start = end - timedelta(days=PAGE_DAYS)
            result = self._fetch(acct, baby, "paged", token, start=start.isoformat(), end=end.isoformat())
            records.update({r["id"]: r for r in result["records"]})
            sync = sync or result["sync"]
            if page == 0 and result["earliest"]:
                floor = result["earliest"]
            if start <= floor:
                break
            end = start
            if self.page_pause:
                time.sleep(self.page_pause)
        return list(records.values()), sync

    def _recent(self, acct: dict, baby: dict, token: str) -> dict:
        """The last week from the history route. Whether Hatch takes tomorrow as the newer day is not known
        (the app never asks), so today is the second try; today's own weighings also come by the "since" route."""
        today = self._today(acct)
        start = (today - timedelta(days=PAGE_DAYS - 1)).isoformat()
        try:
            return self._fetch(acct, baby, "paged", token, start=start, end=(today + timedelta(days=1)).isoformat())
        except HatchProblem as exc:
            if exc.code != "refused":
                raise
            return self._fetch(acct, baby, "paged", token, start=start, end=today.isoformat())

    def _sync_baby(self, acct: dict, baby: dict, token: str, bb_token: str | None, sweep: bool) -> None:
        first_import = not baby["backfilled"]
        if first_import:
            try:
                records, _ = self._history(acct, baby, token)
            except HatchProblem as exc:
                if exc.code not in SOFT:
                    raise
                # The paged route is gone or changed: ask the "since" route for everything instead.
                try:
                    records = self._fetch(acct, baby, "refresh", token, since=0)["records"]
                except HatchProblem as second:
                    raise (second if second.code in ("auth", "rate") else exc) from None
            self._ledger(baby, records, backlog=True)
            # History pages stop at today's date; the first "since" call starts a day earlier to cover today.
            cursor = int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp() * 1000)
            self.store.x("UPDATE hatch_babies SET backfilled=1, cursor=?, swept_at=? WHERE hatch_id=?", (cursor, _now(), baby["hatch_id"]))
            baby = {**baby, "backfilled": 1, "cursor": cursor, "swept_at": _now()}
            sweep = False
        problem: HatchProblem | None = None
        try:
            # On the first import this call only tops up today's weighings, so they count as backlog too.
            self._changes(acct, baby, token, sweep, backlog=first_import)
        except HatchProblem as exc:
            problem = exc
        # Whatever is already in the ledger goes to Baby Buddy even when the call above failed.
        self._import(baby, bb_token)
        if problem:
            raise problem

    def _changes(self, acct: dict, baby: dict, token: str, sweep: bool, backlog: bool = False) -> None:
        """What changed since the last sync. Two routes carry it; the one that worked last is tried first."""
        started = int(time.time() * 1000)
        used = None
        first: HatchProblem | None = None
        for source in ["paged", "refresh"] if baby["source"] == "paged" else ["refresh", "paged"]:
            try:
                if source == "refresh":
                    result = self._fetch(acct, baby, "refresh", token, since=max(0, int(baby["cursor"] or 0) - CURSOR_OVERLAP_MS))
                else:
                    result = self._recent(acct, baby, token)
            except HatchProblem as exc:
                if exc.code not in SOFT:
                    raise
                first = first or exc
                continue
            self._ledger(baby, result["records"], backlog=backlog)
            self.store.x("UPDATE hatch_babies SET cursor=?, source=? WHERE hatch_id=?", (result["sync"] or started, source, baby["hatch_id"]))
            used = source
            break
        if used is None:
            raise first  # type: ignore[misc]
        # Safety net: what "since" means on Hatch's side is inferred, not known. Once a day, and on every
        # Sync now, the last week is also read from the history route so a missed weighing cannot stay missed.
        due = sweep or not baby["swept_at"] or baby["swept_at"] < (datetime.now(timezone.utc) - SWEEP_EVERY).isoformat(timespec="seconds")
        if used == "refresh" and due:
            try:
                self._ledger(baby, self._recent(acct, baby, token)["records"], backlog=False)
            except HatchProblem as exc:
                if exc.code not in SOFT:
                    raise
            self.store.x("UPDATE hatch_babies SET swept_at=? WHERE hatch_id=?", (_now(), baby["hatch_id"]))

    def _ledger(self, baby: dict, records: list[dict], backlog: bool) -> None:
        """Note every record Hatch showed us. New ones wait as 'pending'; nothing is written to Baby Buddy here.

        A record Hatch shows again with a different weight, time or note was changed there (edited in the Hatch app,
        or revised by Hatch): a waiting one takes the new values, an imported one is marked 'updating' so the next
        write corrects Bramble's copy in place. Before 2026-10-12 a known record was never read again, so a changed
        weighing stayed old in Bramble for good (5 lb 5.75 oz there, 5 lb 7.5 oz in Hatch). A weighing the family had
        typed themselves ('matched') is theirs and is left alone."""
        if not self._live():
            return
        for r in records:
            known = self.store.q("SELECT status, bb_id, grams, measured_at, note FROM hatch_weights WHERE hatch_id=?", (r["id"],))
            measured = r["measured"].isoformat(timespec="seconds")
            if known and not r["deleted"] and known[0]["status"] in ("pending", "imported", "updating"):
                k = known[0]
                if abs(float(k["grams"]) - r["grams"]) >= 0.5 or k["measured_at"] != measured or (k["note"] or "") != r["note"]:
                    status = "pending" if k["status"] == "pending" else "updating"
                    self.store.x("UPDATE hatch_weights SET grams=?, measured_at=?, note=?, status=? WHERE hatch_id=?", (r["grams"], measured, r["note"], status, r["id"]))
                    self._log({"outcome": "changed in Hatch", "path": f"weight {r['id']}", "detail": f"{float(k['grams']):.0f} g -> {r['grams']:.0f} g"})
                continue
            if not known and not r["deleted"]:
                self.store.x(
                    "INSERT INTO hatch_weights (hatch_id, baby, child, grams, measured_at, manual, note, backlog, status, created) VALUES (?,?,?,?,?,?,?,?,'pending',?)",
                    (r["id"], baby["hatch_id"], baby["child"], r["grams"], r["measured"].isoformat(timespec="seconds"), None if r["manual"] is None else int(r["manual"]), r["note"], int(backlog), _now()),
                )
            elif known and r["deleted"] and known[0]["status"] == "pending":
                self.store.x("DELETE FROM hatch_weights WHERE hatch_id=?", (r["id"],))
            elif known and r["deleted"] and known[0]["status"] in ("imported", "updating"):
                self.store.x("UPDATE hatch_weights SET status='removing' WHERE hatch_id=?", (r["id"],))

    def _unit(self, child: int) -> str:
        rows = self.store.q("SELECT blob FROM settings WHERE child=?", (child,))
        try:
            unit = json.loads(rows[0]["blob"])["storageUnits"]["weight"] if rows else None
        except (ValueError, KeyError, TypeError):
            unit = None
        if unit not in GRAMS_PER:
            raise Halt("units", f"no storageUnits.weight recorded for child {child}")
        return unit

    def _import(self, baby: dict, bb_token: str | None) -> None:
        """Write what is waiting in the ledger for this baby to Baby Buddy, honouring the no-duplicates rules."""
        child = baby["child"]
        waiting = self.store.q("SELECT * FROM hatch_weights WHERE baby=? AND status IN ('pending','removing','updating') ORDER BY measured_at, hatch_id", (baby["hatch_id"],))
        if not waiting:
            return
        if not bb_token:
            raise Halt("babybuddy_auth", "no stored Baby Buddy token")
        unit = self._unit(child)
        # Bramble's own copies and the typed weights already matched to a weighing are not candidates: one typed
        # weight stands for one weighing, never for two.
        ours = {r["bb_id"] for r in self.store.q("SELECT bb_id FROM hatch_weights WHERE status IN ('imported','updating','matched') AND bb_id IS NOT NULL")}
        typed = [w for w in self.bb.list(bb_token, "/api/weight/", child=child) if w.get("id") not in ours]
        failed: Halt | None = None
        for row in waiting:
            if not self._live():
                return
            try:
                if row["status"] == "removing":
                    self._remove(bb_token, row)
                    continue
                if row["status"] == "updating" and self._update(bb_token, row, unit):
                    continue
                day = row["measured_at"][:10]
                same_day = [w for w in typed if str(w.get("date")) == day]
                if row["backlog"]:
                    match = same_day[0] if same_day else None
                else:
                    match = next((w for w in same_day if isinstance(w.get("weight"), (int, float)) and abs(w["weight"] * GRAMS_PER[unit] - row["grams"]) <= MATCH_TOLERANCE_G and near_in_time(w, row["measured_at"])), None)
                if match:
                    if not row["backlog"]:
                        typed.remove(match)  # after the first import, one typed weight stands for one weighing
                    self.store.x("UPDATE hatch_weights SET status='matched', bb_id=?, child=? WHERE hatch_id=?", (match.get("id"), child, row["hatch_id"]))
                    continue
                created = self.bb.call(bb_token, "POST", "/api/weight/", {"child": child, "weight": round(row["grams"] / GRAMS_PER[unit], STORED_DECIMALS), "date": day, "notes": self._note(row)})
                bb_id = created.get("id") if isinstance(created, dict) else None
                self.store.x("UPDATE hatch_weights SET status='imported', bb_id=?, child=? WHERE hatch_id=?", (bb_id, child, row["hatch_id"]))
                if self.on_weight:
                    self.on_weight(child, row["hatch_id"], row["grams"], row["measured_at"], bool(row["backlog"]))
            except Halt as exc:
                if exc.code == "babybuddy_auth":
                    raise
                failed = failed or exc  # keep going: one refused entry must not hold back the rest
        if failed:
            raise failed

    def _update(self, bb_token: str, row: dict, unit: str) -> bool:
        """Correct Bramble's copy of a weighing that changed in Hatch: weight, date and the note's clock, in place.
        Words the family added to the note stay. False when the copy is gone from Baby Buddy (it is written anew)."""
        if row["bb_id"] is None:
            return False
        path = f"/api/weight/{int(row['bb_id'])}/"
        try:
            current = self.bb.call(bb_token, "GET", path)
        except Halt as exc:
            if "answered 404" in exc.detail:
                return False
            raise
        old_notes = str(current.get("notes") or "") if isinstance(current, dict) else ""
        clock = time_segment(datetime.fromisoformat(row["measured_at"]))
        parts = [p.strip() for p in old_notes.split(" · ")] if old_notes else []
        if any(TIME_SEGMENT.match(p) for p in parts):
            notes = " · ".join(clock if TIME_SEGMENT.match(p) else p for p in parts)
        else:
            notes = self._note(row)
        self.bb.call(bb_token, "PATCH", path, {"weight": round(row["grams"] / GRAMS_PER[unit], STORED_DECIMALS), "date": row["measured_at"][:10], "notes": notes})
        self.store.x("UPDATE hatch_weights SET status='imported' WHERE hatch_id=?", (row["hatch_id"],))
        return True

    def _remove(self, bb_token: str, row: dict) -> None:
        """The weighing was deleted in Hatch after it was imported: take the copy out of Baby Buddy too."""
        try:
            if row["bb_id"] is not None:
                self.bb.call(bb_token, "DELETE", f"/api/weight/{int(row['bb_id'])}/")
        except Halt as exc:
            if "answered 404" not in exc.detail:
                raise
        self.store.x("UPDATE hatch_weights SET status='removed' WHERE hatch_id=?", (row["hatch_id"],))

    @staticmethod
    def _note(row: dict) -> str:
        """`<source> · <clock>[ · <Hatch note>]`; the clock is the member's local wall time (see TIME_SEGMENT)."""
        when = time_segment(datetime.fromisoformat(row["measured_at"]))
        return " · ".join(p for p in (NOTE_APP if row["manual"] else NOTE_SCALE, when, row["note"]) if p)
