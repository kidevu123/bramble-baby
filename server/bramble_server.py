#!/usr/bin/env python3
"""Bramble companion service.

Stores what Baby Buddy cannot (contractions, activities, milestones, shared
settings, reminders) and delivers Web Push notifications. Standard library
only; pywebpush / py_vapid / cryptography are optional and loaded lazily.
"""
from __future__ import annotations

import base64
import json
from contextlib import contextmanager
import logging
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

import milk as milk_mod
import hatch as hatch_mod
import nudges as nudges_mod
import people as people_mod
import zones as zones_mod
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

VERSION = "1.6.0"
PREFIX = "/bramble"
AUTH_CACHE_TTL = 600
AUTH_NEGATIVE_TTL = 30
AUTH_CACHE_MAX = 256
DELIVERY_INTERVAL = 15
STALE_AFTER = timedelta(hours=6)
# Sent reminders older than this are deleted (once a day, from the delivery loop). The longest look-back on
# sent rows is the supply nudge's three-day repeat; activity/feed/pump anchors are at most two days old.
SENT_KEEP = timedelta(days=30)
PRUNE_EVERY = timedelta(days=1)
PUSH_TIMEOUT = 10
# Push services require a contact in the VAPID JWT. Apple answers 403 BadJwtToken to a placeholder
# such as mailto:admin@bramble.local, so there is no default: set BRAMBLE_VAPID_SUB=mailto:you@example.com
# (or an https:// URL) on the host, or push sending is refused with a message that names the variable.
VAPID_SUB = os.environ.get("BRAMBLE_VAPID_SUB", "").strip() or None
VAPID_SUB_ENV = VAPID_SUB
VAPID_SUB_MISSING = "No push contact yet: an admin sets it in Settings › Notifications (or BRAMBLE_VAPID_SUB on the server); push services need a real email"


def set_vapid_sub(value: str | None) -> None:
    """The push contact from Settings (or back to BRAMBLE_VAPID_SUB from the host when cleared)."""
    global VAPID_SUB
    VAPID_SUB = (value or "").strip() or VAPID_SUB_ENV


def clean_contact(value) -> str | None:
    """An email, mailto: or https:// address as the push services want it; None for empty; ValueError otherwise."""
    text = str(value or "").strip()
    if not text:
        return None
    if text.startswith("https://") and len(text) > 10:
        return text
    mail = text[7:] if text.lower().startswith("mailto:") else text
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", mail):
        raise ValueError("bad contact")
    return f"mailto:{mail}"


def vapid_contact_problem() -> str | None:
    """Why the VAPID contact cannot be used, or None when it looks usable."""
    if not VAPID_SUB:
        return VAPID_SUB_MISSING
    if not (VAPID_SUB.startswith("mailto:") or VAPID_SUB.startswith("https://")):
        return f"The push contact must start with mailto: or https:// (got {VAPID_SUB!r})"
    return None

log = logging.getLogger("bramble")

# --------------------------------------------------------------------------- push


def _load_webpush():
    try:
        from pywebpush import WebPushException, webpush  # type: ignore

        return webpush, WebPushException
    except Exception:  # pragma: no cover - depends on host
        return None, None


class PushSendError(Exception):
    def __init__(self, status: int | None, message: str = ""):
        super().__init__(message or f"push failed ({status})")
        self.status = status


def send_push(subscription: dict, payload: dict, vapid: "Vapid") -> None:
    """Send one push message. Raises PushSendError(status) on any failure.

    Module-level so tests can monkeypatch it. Every failure (push-service rejection, network error,
    malformed keys) becomes a PushSendError so one bad subscription never aborts a delivery batch.
    """
    contact_problem = vapid_contact_problem()
    if contact_problem:
        raise PushSendError(None, contact_problem)
    webpush, WebPushException = _load_webpush()
    if webpush is None:
        raise PushSendError(None, "pywebpush is not installed on the server")
    if not vapid.enabled:
        raise PushSendError(None, "VAPID keys are not available on the server")
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=vapid.private_key_path,
            vapid_claims={"sub": VAPID_SUB},
            ttl=3600,
            timeout=PUSH_TIMEOUT,
            headers={"Urgency": "high"},
        )
    except WebPushException as exc:  # type: ignore[misc]
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
        detail = ""
        try:
            detail = (response.text or "")[:200] if response is not None else ""
        except Exception:
            detail = ""
        raise PushSendError(status, f"{exc} {detail}".strip()) from exc
    except Exception as exc:  # requests transport errors, key parsing errors, ...
        raise PushSendError(None, f"{type(exc).__name__}: {exc}") from exc


class Vapid:
    """VAPID key pair on disk. Generated once; disabled when no crypto lib exists."""

    def __init__(self, directory: str):
        self.directory = directory
        self.private_key_path = os.path.join(directory, "private_key.pem")
        self.public_key_path = os.path.join(directory, "public_key.pem")
        self.public_key_b64: str | None = None
        self.enabled = False
        self.problem: str | None = None
        self._ensure()

    @property
    def has_keys(self) -> bool:
        return self.public_key_b64 is not None

    def _ensure(self) -> None:
        try:
            os.makedirs(self.directory, exist_ok=True)
            if os.path.exists(self.private_key_path):
                # Never regenerate while a private key exists: every phone's subscription is bound to
                # it, and a new key silently breaks them all (Apple/FCM answer 403 forever).
                if not os.path.exists(self.public_key_path) and not self._derive_public():
                    self.problem = "public_key.pem missing and could not be derived"
                    return
            elif not self._generate():
                self.problem = "cannot generate VAPID keys (py_vapid/cryptography missing)"
                return
            self.public_key_b64 = self._public_b64()
            if self.public_key_b64 is None:
                self.problem = "cannot read public_key.pem (cryptography missing or file corrupt)"
            elif _load_webpush()[0] is None:
                self.problem = "pywebpush is not installed"
            self.enabled = self.public_key_b64 is not None and _load_webpush()[0] is not None
        except Exception as exc:  # pragma: no cover
            log.warning("VAPID unavailable: %s", exc)
            self.problem = str(exc)
            self.enabled = False

    def _derive_public(self) -> bool:
        try:
            from cryptography.hazmat.primitives import serialization  # type: ignore

            with open(self.private_key_path, "rb") as fh:
                key = serialization.load_pem_private_key(fh.read(), password=None)
            with open(self.public_key_path, "wb") as fh:
                fh.write(key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
            return True
        except Exception as exc:
            log.warning("cannot derive VAPID public key: %s", exc)
            return False

    def _generate(self) -> bool:
        try:
            from py_vapid import Vapid01  # type: ignore

            v = Vapid01()
            v.generate_keys()
            v.save_key(self.private_key_path)
            v.save_public_key(self.public_key_path)
            os.chmod(self.private_key_path, 0o600)
            return True
        except Exception:
            pass
        try:
            from cryptography.hazmat.primitives import serialization  # type: ignore
            from cryptography.hazmat.primitives.asymmetric import ec  # type: ignore

            key = ec.generate_private_key(ec.SECP256R1())
            with open(self.private_key_path, "wb") as fh:
                fh.write(
                    key.private_bytes(
                        serialization.Encoding.PEM,
                        serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption(),
                    )
                )
            with open(self.public_key_path, "wb") as fh:
                fh.write(key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
            os.chmod(self.private_key_path, 0o600)
            return True
        except Exception as exc:
            log.warning("cannot generate VAPID keys (no py_vapid/cryptography): %s", exc)
            return False

    def _public_b64(self) -> str | None:
        try:
            from cryptography.hazmat.primitives import serialization  # type: ignore

            with open(self.public_key_path, "rb") as fh:
                pub = serialization.load_pem_public_key(fh.read())
            raw = pub.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
        except Exception:
            return None


# --------------------------------------------------------------------------- storage

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (child INTEGER PRIMARY KEY, blob TEXT NOT NULL);
-- The household's own setup, set from the app by an admin (the printer, the push contact); the host's
-- environment variables are the fallback, so an install that set them keeps working unchanged.
CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, child INTEGER NOT NULL, start TEXT NOT NULL,
  "end" TEXT, intensity INTEGER, notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT, child INTEGER NOT NULL, type TEXT NOT NULL,
  start TEXT NOT NULL, "end" TEXT, notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, child INTEGER NOT NULL, title TEXT NOT NULL,
  date TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, child INTEGER NOT NULL, at TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', tag TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual', sent INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (sent, at);
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, child INTEGER,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL);
"""

TABLES = {
    "contractions": (["child", "start", "end", "intensity", "notes"], ["child", "start"], "start DESC"),
    "activities": (["child", "type", "start", "end", "notes", "tags"], ["child", "type", "start"], "start DESC"),
    "milestones": (["child", "title", "date", "category", "notes"], ["child", "title", "date"], "date DESC, id DESC"),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_iso(value: str) -> datetime:
    d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def utc_iso(value: str) -> str:
    """Canonical UTC form ("2026-09-30T12:00:00+00:00") so timestamps compare correctly as strings."""
    return parse_iso(value).astimezone(timezone.utc).isoformat(timespec="seconds")


def _bounded(value, limit: float) -> float:
    """A storage window from the phone: a finite positive number no larger than `limit`."""
    if isinstance(value, bool):
        raise ValueError("bad windows")
    n = float(value)
    if not (0 < n <= limit):
        raise ValueError("bad windows")
    return n


def normalize_time(value):
    """UTC-canonical when it parses as a datetime, otherwise unchanged (date-only values, garbage)."""
    if not isinstance(value, str) or len(value) < 16:
        return value
    try:
        return utc_iso(value)
    except (ValueError, OverflowError):
        return value


class Store:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.path = path
        # Re-entrant so atomic() can hold it across several q()/x() calls from one request thread.
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        """Columns added to live tables after they shipped."""
        have = {r["name"] for r in self.q("PRAGMA table_info(activities)")}
        if "tags" not in have:
            # Who logged it, as on Baby Buddy entries ("caregiver:<username>"): a JSON list of strings.
            self.x("ALTER TABLE activities ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")

    def q(self, sql: str, params=()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def x(self, sql: str, params=()) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, params)

    @contextmanager
    def atomic(self):
        """One transaction, no interleaving from other request threads (each statement alone is locked,
        a delete-then-insert sequence is not)."""
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    # generic CRUD -----------------------------------------------------------
    def list_rows(self, table: str, child: int, since: str | None) -> list[dict]:
        cols, _, order = TABLES[table]
        time_col = "date" if table == "milestones" else "start"
        sql = f'SELECT * FROM {table} WHERE child=?'
        params: list = [child]
        if since:
            sql += f' AND "{time_col}" >= ?'
            params.append(normalize_time(since) if time_col != "date" else since)
        return [self._row(table, r) for r in self.q(sql + f" ORDER BY {order} LIMIT 500", params)]

    def get_row(self, table: str, row_id: int) -> dict | None:
        rows = self.q(f"SELECT * FROM {table} WHERE id=?", (row_id,))
        return self._row(table, rows[0]) if rows else None

    def insert(self, table: str, body: dict) -> dict:
        cols, required, _ = TABLES[table]
        missing = [c for c in required if body.get(c) in (None, "")]
        if missing:
            raise ValueError(f"missing: {', '.join(missing)}")
        values = [self._coerce(table, c, body.get(c)) for c in cols]
        quoted = ", ".join(f'"{c}"' for c in cols)
        cur = self.x(f"INSERT INTO {table} ({quoted}) VALUES ({', '.join('?' * len(cols))})", values)
        return self.get_row(table, cur.lastrowid)  # type: ignore[return-value]

    def patch(self, table: str, row_id: int, body: dict) -> dict | None:
        cols, _, _ = TABLES[table]
        updates = {c: self._coerce(table, c, body[c]) for c in cols if c in body}
        if not updates:
            return self.get_row(table, row_id)
        sets = ", ".join(f'"{c}"=?' for c in updates)
        cur = self.x(f"UPDATE {table} SET {sets} WHERE id=?", [*updates.values(), row_id])
        return self.get_row(table, row_id) if cur.rowcount else None

    def delete(self, table: str, row_id: int) -> bool:
        return self.x(f"DELETE FROM {table} WHERE id=?", (row_id,)).rowcount > 0

    @staticmethod
    def _coerce(table: str, col: str, value):
        if col == "child" or (table == "contractions" and col == "intensity"):
            return int(value) if value not in (None, "") else None
        if col in ("notes", "category", "type", "title"):
            return "" if value is None else str(value)
        if col == "tags":
            if value is None:
                return "[]"
            if not isinstance(value, list) or not all(isinstance(t, str) and len(t) <= 64 for t in value) or len(value) > 20:
                raise ValueError("missing: tags (a list of short strings)")
            return json.dumps(value)
        if col in ("start", "end") and value not in (None, ""):
            try:
                return utc_iso(str(value))
            except (ValueError, OverflowError):
                raise ValueError(f"missing: {col} (not a date and time)")
        if col == "date" and value not in (None, ""):
            try:
                date.fromisoformat(str(value)[:10])
            except ValueError:
                raise ValueError("missing: date (YYYY-MM-DD)")
            return str(value)[:10]
        return value

    @staticmethod
    def _row(table: str, r: dict) -> dict:
        if table == "activities":
            try:
                tags = json.loads(r.get("tags") or "[]")
            except ValueError:
                tags = []
            r["tags"] = tags if isinstance(tags, list) else []
        return r


# --------------------------------------------------------------------------- auth


class UpstreamError(Exception):
    """Baby Buddy could not answer the token check (down, restarting, wrong ALLOWED_HOSTS)."""


class Auth:
    def __init__(self, babybuddy_url: str, host_header: str | None = None):
        self.url = babybuddy_url.rstrip("/")
        # Django checks the Host header against ALLOWED_HOSTS; let the operator send the public name.
        self.host_header = host_header or os.environ.get("BABYBUDDY_HOST") or None
        self.cache: dict[str, tuple[float, dict | None]] = {}
        self.lock = threading.Lock()

    def user_id(self, token: str | None) -> int | None:
        user = self.user(token)
        return user["id"] if user else None

    def user(self, token: str | None) -> dict | None:
        """Who the token belongs to: {"id", "username", "is_staff"} from Baby Buddy's /api/profile, cached."""
        if not token:
            return None
        now = time.monotonic()
        with self.lock:
            hit = self.cache.get(token)
            if hit and hit[0] > now:
                return dict(hit[1]) if hit[1] else None
        headers = {"Authorization": f"Token {token}", "Accept": "application/json"}
        if self.host_header:
            headers["Host"] = self.host_header
        req = urllib.request.Request(f"{self.url}/api/profile", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                data = json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            exc.close()
            if exc.code in (401, 403):
                self._remember(token, now + AUTH_NEGATIVE_TTL, None)
                return None
            log.warning("auth upstream answered %s (check ALLOWED_HOSTS / BABYBUDDY_HOST)", exc.code)
            raise UpstreamError(f"Baby Buddy answered {exc.code}") from exc
        except (urllib.error.URLError, ValueError, OSError) as exc:
            log.warning("auth upstream unreachable: %s", exc)
            raise UpstreamError(str(exc)) from exc
        profile = data.get("user") if isinstance(data, dict) else None
        uid = profile.get("id") if isinstance(profile, dict) else None
        if uid is None:
            self._remember(token, now + AUTH_NEGATIVE_TTL, None)
            return None
        user = {"id": int(uid), "username": str(profile.get("username") or f"user{uid}"), "is_staff": bool(profile.get("is_staff"))}
        self._remember(token, now + AUTH_CACHE_TTL, user)
        return dict(user)

    def forget(self) -> None:
        """A person was added, changed or removed: every token is checked against Baby Buddy again."""
        with self.lock:
            self.cache.clear()

    def _remember(self, token: str, until: float, user: dict | None) -> None:
        with self.lock:
            if len(self.cache) >= AUTH_CACHE_MAX:
                self.cache.clear()
            self.cache[token] = (until, user)


# --------------------------------------------------------------------------- delivery


class Delivery:
    def __init__(self, store: Store, vapid: Vapid):
        self.store = store
        self.vapid = vapid
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._loop, name="bramble-delivery", daemon=True)
        self.last_error: str | None = None
        self.last_error_at: str | None = None
        # Set by App: rem -> (url the tap opens, user_id or None for every phone, skip). See nudges.Nudges.route.
        self.router = None
        self._pruned_at: datetime | None = None

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(DELIVERY_INTERVAL):
            try:
                self.run_once()
            except Exception:  # pragma: no cover
                log.exception("delivery loop failed")

    def run_once(self, now: datetime | None = None) -> int:
        """Deliver due reminders. Returns number of reminders processed."""
        now = now or datetime.now(timezone.utc)
        self.prune(now)
        due = self.store.q("SELECT * FROM reminders WHERE sent=0 AND at <= ? ORDER BY at", (now.isoformat(timespec="seconds"),))
        claimed = 0
        for rem in due:
            # Claim it before sending. /push/schedule (and a milk-bag change) replace the *unsent* reminders of
            # their kind; one arriving mid-send would otherwise delete this row and re-insert the same alert as
            # unsent, and the phone would get it twice. A claimed row survives the replace and the re-insert is
            # recognised as already sent.
            if not self.store.x("UPDATE reminders SET sent=1 WHERE id=? AND sent=0", (rem["id"],)).rowcount:
                continue
            claimed += 1
            try:
                if parse_iso(rem["at"]) < now - STALE_AFTER:
                    log.info("reminder %s stale, skipping", rem["id"])
                else:
                    self._deliver(rem)
            except Exception:  # never let one reminder take the loop down
                log.exception("delivering reminder %s failed", rem["id"])
        return claimed

    def prune(self, now: datetime) -> int:
        """Delete sent reminders older than SENT_KEEP, at most once per PRUNE_EVERY. Returns rows deleted."""
        if self._pruned_at is not None and now - self._pruned_at < PRUNE_EVERY:
            return 0
        self._pruned_at = now
        cutoff = (now - SENT_KEEP).astimezone(timezone.utc).isoformat(timespec="seconds")
        n = self.store.x("DELETE FROM reminders WHERE sent=1 AND at < ?", (cutoff,)).rowcount
        if n:
            log.info("pruned %d sent reminders older than %d days", n, SENT_KEEP.days)
        return n

    def _deliver(self, rem: dict) -> None:
        url, user_id, skip = self.router(rem) if self.router else ("/", None, False)
        if skip:
            return
        # The phone keeps one notification per tag: a ping per entry (several can land together after a gap), and one
        # per child for the rest, so a second child's "usually eats about now" never silently replaces the first's.
        tag = rem["tag"] or "bramble"
        if tag == "nudge:activity" and rem.get("anchor"):
            tag = f"{tag}:{rem['anchor']}"
        elif rem.get("child") is not None:
            tag = f"{tag}:{rem['child']}"
        payload = {"title": rem["title"], "body": rem["body"], "tag": tag, "url": url, "child": rem["child"]}
        # Every caregiver's phone gets every reminder (Baby Buddy is one household); the payload
        # carries the child so the app can route it. Binding to one child silently dropped alerts
        # for the other child after switching profiles. A nudge meant for one person (pumping) goes to
        # that person's phones, or to everyone when none of theirs is registered. An activity ping is the
        # exception: it exists only for its target ("Mom logged pumping" must never reach Mom), so it is
        # dropped when the target has no phone left.
        subs = self.store.q("SELECT * FROM subscriptions")
        mine = [s for s in subs if user_id is not None and s["user_id"] == user_id]
        strict = (rem.get("tag") or "") == "nudge:activity"
        for sub in mine if (mine or strict) else subs:
            self.send_to(sub, payload)

    def send_to(self, sub: dict, payload: dict) -> bool:
        ok, _ = self.try_send(sub, payload)
        return ok

    def try_send(self, sub: dict, payload: dict) -> tuple[bool, str | None]:
        """Send to one subscription; returns (ok, error). 404/410 drop the subscription."""
        info = {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
        try:
            send_push(info, payload, self.vapid)
            return True, None
        except PushSendError as exc:
            self.last_error = f"{exc.status or 'error'}: {exc}"[:300]
            self.last_error_at = now_iso()
            if exc.status in (404, 410):
                self.store.x("DELETE FROM subscriptions WHERE endpoint=?", (sub["endpoint"],))
                log.info("removed dead subscription %s", sub["endpoint"][:60])
                return False, f"subscription expired ({exc.status}); removed"
            if exc.status in (401, 403):
                # Almost always a VAPID key mismatch: the phone subscribed with a different server key.
                log.error("push rejected for %s (%s): %s — the app re-subscribes on next open", sub["endpoint"][:60], exc.status, exc)
            else:
                log.warning("push failed for %s: %s", sub["endpoint"][:60], exc)
            return False, str(exc)


# --------------------------------------------------------------------------- http


def public_error(text: str | None) -> str | None:
    """A push error for the public /health: URLs and paths out (a transport error names the push endpoint)."""
    if not text:
        return text
    text = re.sub(r"https?://[^\s'\"()<>]+", "[url]", text)
    return re.sub(r"(?<=[\s:'\"(=])/[^\s'\"()<>]+", "[path]", text)


# Printers that can be set from the app. `file://` (writes PNGs to a folder, for tests) stays a host-only setting.
PRINTER_KINDS = ("zebra", "brother_ql", "bridge", "niimbot")


class App:
    def __init__(self, store: Store, auth: Auth, vapid: Vapid, delivery: Delivery, printer: "milk_mod.Printer | None" = None):
        self.store, self.auth, self.vapid, self.delivery = store, auth, vapid, delivery
        self.milk = milk_mod.MilkStore(store, parse_iso, utc_iso, now_iso)
        self.env_printer = os.environ.get("BRAMBLE_PRINTER") or None
        self.printer = printer or milk_mod.Printer(self._printer_spec())
        set_vapid_sub(self.config_get("push_contact"))
        # Hatch Grow scale weights -> Baby Buddy (hatch.py); its poll thread is started in main().
        self.hatch = hatch_mod.Hatch(store, auth.url, auth.host_header)
        # The household's people (roles, names) and the channel to Baby Buddy's Django for logins (people.py).
        self.people = people_mod.People(store, people_mod.Django(), now_iso)
        # Data-driven reminders (feed/pump due, no wet diaper, evening summary, Hatch weight) from nudges.py;
        # its poll thread is started in main(), the delivery thread asks it where a tap goes and who gets it.
        self.nudges = nudges_mod.Nudges(store, auth.url, auth.host_header)
        delivery.router = self.nudges.route
        self.hatch.on_weight = self.nudges.weight_imported

    # ---- the household's own setup (printer, push contact), editable from the app
    def config_get(self, key: str) -> str | None:
        rows = self.store.q("SELECT value FROM server_config WHERE key=?", (key,))
        return rows[0]["value"] if rows else None

    def config_set(self, key: str, value: str | None) -> None:
        if value is None:
            self.store.x("DELETE FROM server_config WHERE key=?", (key,))
        else:
            self.store.x("INSERT INTO server_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def _printer_spec(self) -> str | None:
        """The printer in use: set in the app ("none" there means no printer), else the host's BRAMBLE_PRINTER."""
        saved = self.config_get("printer")
        if saved == "none":
            return None
        return saved or self.env_printer

    @staticmethod
    def _mask(spec: str | None) -> str | None:
        """A printer address with any token hidden (a print bridge's token is a secret)."""
        return re.sub(r"(token=)[^&]+", r"\1••••", spec) if spec else spec

    def config_view(self, user: dict) -> dict:
        saved = self.config_get("printer")
        contact = self.config_get("push_contact")
        return {
            "admin": bool(user.get("is_staff")),
            "printer": {"spec": self._mask(self._printer_spec()), "source": "settings" if saved else "server" if self.env_printer else "none", "kinds": list(PRINTER_KINDS)},
            "pushContact": {"value": contact or VAPID_SUB_ENV, "source": "settings" if contact else "server" if VAPID_SUB_ENV else "none"},
            # The zone every clock in a notification is written in (zones.py): the household's, else the server's.
            "timeZone": {"value": zones_mod.zone_name(zones_mod.household_zone(self.store)), "source": "settings" if zones_mod.saved_zone_name(self.store) else "server", "server": zones_mod.zone_name(zones_mod.local_zone())},
        }

    def config_routes(self, method: str, data: dict, user: dict):
        if method == "GET":
            return 200, self.config_view(user)
        if method != "PUT":
            return 405, {"detail": "Method not allowed."}
        if not user.get("is_staff"):
            return 403, {"detail": "Only an admin of this Bramble can change its printer, push contact or time zone."}
        if "printer" in data:
            spec = str(data.get("printer") or "").strip() or None
            if spec and spec.lower() == "none":
                spec = "none"  # no printer, whatever the host set: labels go through the share sheet
            elif spec and "••••" in spec:
                # The masked token came back unchanged: keep the one saved.
                old = re.search(r"token=([^&]+)", self.config_get("printer") or self.env_printer or "")
                spec = spec.replace("••••", old.group(1)) if old else spec
            if spec and spec != "none":
                scheme = spec.split("://", 1)[0].lower() if "://" in spec else ""
                if scheme not in PRINTER_KINDS:
                    return 400, {"detail": f"Printer addresses start with {', '.join(k + '://' for k in PRINTER_KINDS)}."}
                candidate = milk_mod.Printer(spec)
                if candidate.kind == "zebra":
                    try:
                        candidate._zebra_addr()
                    except milk_mod.PrinterError as exc:
                        return 400, {"detail": str(exc)}
            self.config_set("printer", spec)
            self.printer = milk_mod.Printer(self._printer_spec())
        if "pushContact" in data:
            try:
                contact = clean_contact(data.get("pushContact"))
            except ValueError:
                return 400, {"detail": "Enter an email address (or an https:// address) for the push contact."}
            self.config_set("push_contact", contact)
            set_vapid_sub(contact)
        if "timeZone" in data:
            name = str(data.get("timeZone") or "").strip() or None
            if name and not zones_mod.zone_named(name):
                return 400, {"detail": "That is not a time zone name like America/New_York."}
            if name != zones_mod.saved_zone_name(self.store):
                self.config_set(zones_mod.KEY, name)
                # Planned nudges and milk reminders carry clocks in their words: write them again in the new zone.
                self.milk.resync_reminders()
                self.nudges.trigger()
        return 200, self.config_view(user)

    def handle(self, method: str, raw_path: str, headers, body: bytes):
        url = urlparse(raw_path)
        path = url.path
        if path.startswith(PREFIX + "/") or path == PREFIX:
            path = path[len(PREFIX):] or "/"
        path = path.rstrip("/") or "/"
        query = {k: v[-1] for k, v in parse_qs(url.query).items()}
        parts = [p for p in path.split("/") if p]

        if path == "/health":
            return 200, self.health()
        if path == "/push/vapid":
            if not self.vapid.public_key_b64:
                return 503, {"detail": f"Push is not configured on the server: {self.vapid.problem or 'no VAPID key'}."}
            return 200, {"publicKey": self.vapid.public_key_b64}

        token = None
        auth_header = headers.get("Authorization") or ""
        if auth_header.startswith("Token "):
            token = auth_header[6:].strip()
        try:
            user = self.auth.user(token)
        except UpstreamError as exc:
            return 503, {"detail": f"Baby Buddy is not reachable from the companion service ({exc})."}
        if user is None:
            return 401, {"detail": "Authentication credentials were not provided or are invalid."}
        user_id = user["id"]

        data: dict = {}
        if body:
            try:
                data = json.loads(body.decode() or "{}")
                if not isinstance(data, dict):
                    return 400, {"detail": "JSON object expected."}
            except ValueError:
                return 400, {"detail": "Invalid JSON."}

        try:
            if parts and parts[0] == "hatch":  # needs the caller's own token, which route() does not carry
                return self.hatch.http(method, parts, data, user_id, token)
            if parts and parts[0] == "people":  # needs the caller's username and staff flag
                # The app sends encodeURIComponent(username); decode here so "a%40b" is "a@b" with or without nginx.
                return self.people.http(method, [unquote(p) for p in parts], data, user, on_change=self.auth.forget, query=query)
            if parts == ["config"]:  # the printer and push contact; changing them needs an admin (Baby Buddy staff)
                return self.config_routes(method, data, user)
            if parts and parts[0] == "nudges":  # keeps the caller's token to read Baby Buddy on its poll
                return self.nudges.http(method, parts, data, user_id, token)
            return self.route(method, parts, query, data, user_id)
        except ValueError as exc:
            msg = str(exc)
            return 400, {"detail": msg if msg.startswith("missing") else "Invalid value."}
        except (TypeError, OverflowError):  # a number too big for sqlite or a date past year 9999
            return 400, {"detail": "Invalid value."}

    def health(self) -> dict:
        webpush_ok = _load_webpush()[0] is not None
        return {
            "ok": True,
            "push": self.vapid.enabled,
            "webpush": webpush_ok,
            "vapid": self.vapid.has_keys,
            "problem": self.vapid.problem or vapid_contact_problem(),
            "contact": vapid_contact_problem() is None,
            "subscriptions": self.store.q("SELECT COUNT(*) AS n FROM subscriptions")[0]["n"],
            "lastPushError": public_error(self.delivery.last_error),  # the full text is in the journal
            "lastPushErrorAt": self.delivery.last_error_at,
            # No target and no address here (that is for the authenticated /print/status), and a bridge is asked
            # at most once a minute from this unauthenticated endpoint.
            "printer": self.printer.public_status(),
            "people": self.people.django.status(),  # can Bramble create Baby Buddy logins on this host, and if not, why
            "nudges": {"armed": self.nudges.armed(), "lastRun": self.nudges.last_run, "problem": self.nudges.problem},
            "version": VERSION,
        }

    def route(self, method, parts, query, data, user_id):
        if not parts:
            return 404, {"detail": "Not found."}
        head = parts[0]

        if head == "settings" and len(parts) == 2:
            child = int(parts[1])
            if method == "GET":
                rows = self.store.q("SELECT blob FROM settings WHERE child=?", (child,))
                return 200, json.loads(rows[0]["blob"]) if rows else {}
            if method == "PUT":
                data = people_mod.People.strip_settings(data)  # caregiver names live in the people table now
                # Keys in the body replace, keys left out are kept: a phone saving its pump list must not erase
                # storageUnits (or anything else it did not send). A full-object PUT works as before.
                with self.store.atomic():
                    rows = self.store.q("SELECT blob FROM settings WHERE child=?", (child,))
                    try:
                        old = json.loads(rows[0]["blob"]) if rows else {}
                    except ValueError:
                        old = {}
                    old = old if isinstance(old, dict) else {}
                    if isinstance(old.get("storageUnits"), dict) and "storageUnits" in data:
                        # The units every stored number is in are recorded once and never change: a phone that
                        # missed the shared copy would otherwise re-label every bottle, weight and Hatch import.
                        data = {k: v for k, v in data.items() if k != "storageUnits"}
                    merged = {**old, **data}
                    self.store.x("INSERT INTO settings (child, blob) VALUES (?, ?) ON CONFLICT(child) DO UPDATE SET blob=excluded.blob", (child, json.dumps(merged)))
                return 200, merged
            return 405, {"detail": "Method not allowed."}

        if head in TABLES:
            return self.crud(head, method, parts, query, data)

        if head == "reminders":
            return self.reminders(method, parts, query, data)

        if head == "push":
            return self.push(method, parts, data, user_id)

        if head == "milk":
            return self.milk_routes(method, parts, query, data, user_id)

        if head == "print":
            return self.print_routes(method, parts, data)

        return 404, {"detail": "Not found."}

    # ---- milk stash (bags with QR codes, expiry reminders)
    def milk_routes(self, method, parts, query, data, user_id):
        windows = self._milk_windows(data.get("windows") if isinstance(data.get("windows"), dict) else None)
        if len(parts) == 1:
            if method == "GET":
                if "child" not in query:
                    return 400, {"detail": "child is required."}
                return 200, self.milk.list(int(query["child"]), query.get("status") or None)
            if method == "POST":
                try:
                    return 201, self.milk.create(data, user_id, windows)
                except milk_mod.MilkError as exc:
                    return 400, {"detail": str(exc)}
            return 405, {"detail": "Method not allowed."}
        if len(parts) == 2 and parts[1] == "bottles" and method == "POST":
            # Premade bottles made ahead from stash bags, one per numbered fridge spot.
            if data.get("child") in (None, ""):
                return 400, {"detail": "missing: child"}
            try:
                return 201, self.milk.make_bottles(int(data["child"]), data.get("bottles"), user_id, windows)
            except milk_mod.MilkError as exc:
                return 400, {"detail": str(exc)}
        if len(parts) == 2 and parts[1] == "nicu" and method == "POST":
            # Bags taken to the NICU in one trip: they leave the home stash whole.
            if data.get("child") in (None, ""):
                return 400, {"detail": "missing: child"}
            try:
                return 200, self.milk.to_nicu(int(data["child"]), data.get("bags"), user_id)
            except milk_mod.MilkError as exc:
                return 400, {"detail": str(exc)}
        if len(parts) == 2 and parts[1] == "travel":
            # Travel stickers: codes printed ahead (GET lists them, POST reserves a batch).
            if method == "GET":
                if "child" not in query:
                    return 400, {"detail": "child is required."}
                return 200, self.milk.travel_list(int(query["child"]))
            if method == "POST":
                if data.get("child") in (None, ""):
                    return 400, {"detail": "missing: child"}
                try:
                    return 201, self.milk.reserve_travel(int(data["child"]), data.get("count"), user_id, data.get("client_key"))
                except milk_mod.MilkError as exc:
                    return 400, {"detail": str(exc)}
            return 405, {"detail": "Method not allowed."}
        if len(parts) == 3 and parts[1] == "travel" and method == "GET":
            sticker = self.milk.travel_get(parts[2])
            return (200, sticker) if sticker else (404, {"detail": "Not a travel sticker."})
        if len(parts) == 3 and parts[1] == "code" and method == "GET":
            bag = self.milk.by_code(parts[2])
            if not bag:
                sticker = self.milk.travel_get(parts[2])
                if sticker and not sticker["bag_id"]:
                    return 404, {"detail": f"Travel sticker {sticker['code']} is not on any milk yet. Scan it in the pumping sheet when you log that session."}
            return (200, bag) if bag else (404, {"detail": "No bag with that code."})
        if len(parts) == 3 and parts[1] == "feeding" and method == "GET":
            # Which bags a bottle was poured from (editing or deleting that feeding adjusts its takes).
            return 200, self.milk.for_feeding(int(parts[2]))
        if len(parts) == 3 and parts[1] == "feeding" and method == "PUT":
            # One bottle from several bags: the feeding's whole allocation at once ([] gives everything back).
            takes = data.get("takes")
            if not isinstance(takes, list):
                return 400, {"detail": "missing: takes"}
            try:
                return 200, self.milk.set_takes(int(parts[2]), takes, user_id)
            except milk_mod.MilkError as exc:
                return 400, {"detail": str(exc)}
        if len(parts) == 3 and parts[2] == "spot" and method == "POST":
            # A premade bottle moved to another fridge spot; a bottle already there swaps into its old spot.
            try:
                bottles = self.milk.move_bottle(int(parts[1]), data.get("spot"))
            except milk_mod.MilkError as exc:
                return 400, {"detail": str(exc)}
            return (200, bottles) if bottles is not None else (404, {"detail": "Not found."})
        if len(parts) == 3 and parts[2] == "unmake" and method == "POST":
            # Undo a premade bottle: its milk goes back on the bags it was poured from, its spot is free.
            try:
                bags = self.milk.unmake_bottle(int(parts[1]))
            except milk_mod.MilkError as exc:
                return 400, {"detail": str(exc)}
            return (200, bags) if bags is not None else (404, {"detail": "Not found."})
        if len(parts) == 3 and parts[2] == "use" and method == "POST":
            # Scan out: this feeding took amount_ml from the bag; the rest stays in the stash.
            if "amount_ml" not in data:
                return 400, {"detail": "missing: amount_ml"}
            feeding_id = int(data["feeding_id"]) if data.get("feeding_id") not in (None, "") else None
            try:
                bag = self.milk.use(int(parts[1]), data["amount_ml"], feeding_id, user_id)
            except milk_mod.MilkError as exc:
                return 400, {"detail": str(exc)}
            return (200, bag) if bag else (404, {"detail": "Not found."})
        if len(parts) == 2:
            bag_id = int(parts[1])
            if method == "GET":
                bag = self.milk.get(bag_id)
                return (200, bag) if bag else (404, {"detail": "Not found."})
            if method == "PATCH":
                try:
                    bag = self.milk.patch(bag_id, data, user_id, windows)
                except milk_mod.MilkError as exc:  # plain language, same as on create
                    return 400, {"detail": str(exc)}
                except ValueError as exc:
                    if "refrozen" in str(exc):
                        return 400, {"detail": "Thawed milk cannot go back in the freezer."}
                    raise
                return (200, bag) if bag else (404, {"detail": "Not found."})
            if method == "DELETE":
                return (204, None) if self.milk.delete(bag_id) else (404, {"detail": "Not found."})
            return 405, {"detail": "Method not allowed."}
        return 404, {"detail": "Not found."}

    @staticmethod
    def _milk_windows(raw: dict | None) -> dict | None:
        """Household storage windows from the phone's label settings (hours / days / months) → timedeltas."""
        if not raw:
            return None
        out = {}
        try:
            if raw.get("roomHours"):
                out["room"] = timedelta(hours=_bounded(raw["roomHours"], 24 * 14))
            if raw.get("fridgeDays"):
                out["fridge"] = timedelta(days=_bounded(raw["fridgeDays"], 60))
            if raw.get("freezerMonths"):
                out["freezer"] = timedelta(days=30.4375 * _bounded(raw["freezerMonths"], 36))
        except (TypeError, ValueError, OverflowError):
            raise ValueError("bad windows")
        return out or None

    # ---- direct label printing from the server (no phone app)
    def print_routes(self, method, parts, data):
        if len(parts) == 2 and parts[1] == "status" and method == "GET":
            return 200, self.printer.status()
        if len(parts) == 2 and parts[1] == "label" and method == "POST":
            png = milk_mod.decode_png_field(data)
            try:
                return 200, self.printer.print_label(png, code=data.get("code"))
            except milk_mod.PrinterError as exc:
                return 503, {"detail": str(exc)}
        if len(parts) == 3 and parts[1] == "job" and method == "GET":
            # What became of one print request: the phone polls this for a few seconds after printing.
            job = self.printer.job(int(parts[2]))
            return (200, job) if job else (404, {"detail": "Not found."})
        return 404, {"detail": "Not found."}

    def crud(self, table, method, parts, query, data):
        if len(parts) == 1:
            if method == "GET":
                if "child" not in query:
                    return 400, {"detail": "child is required."}
                return 200, self.store.list_rows(table, int(query["child"]), query.get("since"))
            if method == "POST":
                return 201, self.store.insert(table, data)
            return 405, {"detail": "Method not allowed."}
        if len(parts) == 2:
            row_id = int(parts[1])
            if method == "GET":
                row = self.store.get_row(table, row_id)
                return (200, row) if row else (404, {"detail": "Not found."})
            if method in ("PATCH", "PUT"):
                row = self.store.patch(table, row_id, data)
                return (200, row) if row else (404, {"detail": "Not found."})
            if method == "DELETE":
                return (204, None) if self.store.delete(table, row_id) else (404, {"detail": "Not found."})
            return 405, {"detail": "Method not allowed."}
        return 404, {"detail": "Not found."}

    def reminders(self, method, parts, query, data):
        if len(parts) == 1:
            if method == "GET":
                if "child" not in query:
                    return 400, {"detail": "child is required."}
                cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")
                rows = self.store.q(
                    "SELECT id, child, at, title, body, tag, source, sent FROM reminders WHERE child=? AND (sent=0 OR at >= ?) ORDER BY at",
                    (int(query["child"]), cutoff),
                )
                for r in rows:
                    r["sent"] = bool(r["sent"])
                return 200, rows
            if method == "POST":
                return 201, self._insert_reminder(data, "manual")
            return 405, {"detail": "Method not allowed."}
        if len(parts) == 2 and method == "DELETE":
            return (204, None) if self.store.delete_reminder(int(parts[1])) else (404, {"detail": "Not found."})
        return 404, {"detail": "Not found."}

    def _insert_reminder(self, item: dict, source: str) -> dict:
        for key in ("child", "at", "title"):
            if item.get(key) in (None, ""):
                raise ValueError(f"missing: {key}")
        at = utc_iso(str(item["at"]))
        cur = self.store.x(
            "INSERT INTO reminders (child, at, title, body, tag, source, sent, created) VALUES (?,?,?,?,?,?,0,?)",
            (int(item["child"]), at, str(item["title"]), str(item.get("body") or ""), str(item.get("tag") or ""), source, now_iso()),
        )
        row = self.store.q("SELECT id, child, at, title, body, tag, source, sent FROM reminders WHERE id=?", (cur.lastrowid,))[0]
        row["sent"] = bool(row["sent"])
        return row

    def push(self, method, parts, data, user_id):
        action = parts[1] if len(parts) == 2 else None
        if method != "POST" or action is None:
            return 404, {"detail": "Not found."}
        endpoint = data.get("endpoint")
        if endpoint is not None and not isinstance(endpoint, str):
            return 400, {"detail": "endpoint must be a string."}
        if action == "subscribe":
            sub = data.get("subscription") or {}
            keys = sub.get("keys") if isinstance(sub, dict) else None
            if not isinstance(sub, dict) or not isinstance(keys, dict) or not all(isinstance(v, str) and v for v in (sub.get("endpoint"), keys.get("p256dh"), keys.get("auth"))):
                return 400, {"detail": "subscription with endpoint and keys is required."}
            child = data.get("child")
            self.store.x(
                "INSERT INTO subscriptions (endpoint, user_id, child, p256dh, auth, created) VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, child=excluded.child, p256dh=excluded.p256dh, auth=excluded.auth",
                (sub["endpoint"], user_id, int(child) if child not in (None, "") else None, keys["p256dh"], keys["auth"], now_iso()),
            )
            return 200, {"ok": True}
        if action == "unsubscribe":
            if not endpoint:
                return 400, {"detail": "endpoint is required."}
            self.store.x("DELETE FROM subscriptions WHERE endpoint=?", (endpoint,))
            return 200, {"ok": True}
        if action == "status":
            rows = self.store.q("SELECT child, created FROM subscriptions WHERE endpoint=?", (endpoint,)) if endpoint else []
            return 200, {
                "registered": bool(rows),
                "child": rows[0]["child"] if rows else None,
                "push": self.vapid.enabled,
                "problem": self.vapid.problem,
                "subscriptions": self.store.q("SELECT COUNT(*) AS n FROM subscriptions")[0]["n"],
            }
        if action == "test":
            if endpoint:
                subs = self.store.q("SELECT * FROM subscriptions WHERE endpoint=?", (endpoint,))
            else:
                subs = self.store.q("SELECT * FROM subscriptions WHERE user_id=?", (user_id,))
            payload = {"title": "Bramble is ready", "body": "Notifications are working on this device.", "tag": "test", "url": "/", "child": None}
            sent = 0
            errors: list[str] = []
            for s in subs:
                ok, err = self.delivery.try_send(s, payload)
                if ok:
                    sent += 1
                elif err:
                    errors.append(err)
            if not subs and endpoint:
                errors.append("This device is not registered on the server. Turn notifications off and on again.")
            if not self.vapid.enabled and not errors:
                errors.append(self.vapid.problem or "push is not configured on the server")
            return 200, {"sent": sent, "subscriptions": len(subs), "push": self.vapid.enabled, "errors": errors}
        if action == "schedule":
            if data.get("child") in (None, ""):
                return 400, {"detail": "child is required."}
            child = int(data["child"])
            items = data.get("items") or []
            if not isinstance(items, list):
                return 400, {"detail": "items must be a list."}
            created = []
            # Two phones recompute the nap window schedule at about the same time after a nap is logged;
            # without one transaction the second DELETE could wipe rows the first had just inserted.
            with self.store.atomic():
                self.store.x("DELETE FROM reminders WHERE child=? AND source='auto' AND sent=0", (child,))
                for item in items:
                    if not isinstance(item, dict):
                        raise ValueError("missing: at")
                    # An auto alert that already went out (same child/tag/time) must not fire again just
                    # because a caregiver reopened the app inside the window.
                    try:
                        at = utc_iso(str(item.get("at") or ""))
                    except ValueError:
                        raise ValueError("missing: at")
                    dup = self.store.q(
                        "SELECT 1 FROM reminders WHERE child=? AND tag=? AND at=? AND source='auto' AND sent=1 LIMIT 1",
                        (child, str(item.get("tag") or ""), at),
                    )
                    if dup:
                        continue
                    created.append(self._insert_reminder({**item, "child": child}, "auto"))
            return 200, {"scheduled": created}
        return 404, {"detail": "Not found."}


def _delete_reminder(self: Store, row_id: int) -> bool:
    return self.x("DELETE FROM reminders WHERE id=?", (row_id,)).rowcount > 0


Store.delete_reminder = _delete_reminder  # type: ignore[attr-defined]


class Handler(BaseHTTPRequestHandler):
    app: App
    server_version = f"bramble/{VERSION}"

    def _dispatch(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > 1_000_000:
            self.send_response(400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = self.rfile.read(length) if length else b""
        try:
            status, payload = self.app.handle(self.command, self.path, self.headers, body)
        except Exception:
            log.exception("unhandled error")
            status, payload = 500, {"detail": "Internal error."}
        self.send_response(status)
        if payload is None:
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        raw = json.dumps(payload).encode()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _dispatch

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):  # quieter default logging
        log.debug("%s " + fmt, self.address_string(), *args)


def build(db_path: str, vapid_dir: str, babybuddy_url: str) -> tuple[App, Delivery]:
    store = Store(db_path)
    vapid = Vapid(vapid_dir)
    delivery = Delivery(store, vapid)
    app = App(store, Auth(babybuddy_url), vapid, delivery)
    return app, delivery


def serve(host: str, port: int, app: App) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"app": app})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def main() -> None:
    logging.basicConfig(level=os.environ.get("BRAMBLE_LOG", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    port = int(os.environ.get("BRAMBLE_PORT", "8100"))
    app, delivery = build(
        os.environ.get("BRAMBLE_DB", "/opt/bramble-server/data/bramble.db"),
        os.environ.get("BRAMBLE_VAPID_DIR", "/opt/bramble-server/data"),
        os.environ.get("BABYBUDDY_URL", "http://127.0.0.1"),
    )
    delivery.start()
    app.hatch.start()
    app.nudges.start()
    app.people.django.warm()
    server = serve("127.0.0.1", port, app)
    log.info("bramble server %s on 127.0.0.1:%s push=%s%s", VERSION, port, app.vapid.enabled, f" ({app.vapid.problem})" if app.vapid.problem else "")
    try:
        server.serve_forever()
    except KeyboardInterrupt:  # pragma: no cover
        pass
    finally:
        delivery.stop()
        app.hatch.stop()
        app.nudges.stop()
        server.server_close()


if __name__ == "__main__":
    main()
