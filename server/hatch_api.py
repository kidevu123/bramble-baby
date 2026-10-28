"""Everything Bramble knows about Hatch's cloud, in one place.

Unofficial: Hatch publishes no API, and Bramble is not made by, affiliated with or endorsed by Hatch Baby,
Inc. Bramble signs in with the family's own Hatch account, as the Hatch app does, and only reads that family's
own weighings. The routes and field names below follow what community projects already document
(davemasse/hatchbabyapi, the `hatchbaby` npm package). When a real sign-in disagrees, this file is the only
one that should need editing: the routes in SOURCES, the list name in WEIGHT_LIST_KEYS and the field names in
FIELDS.

What the app does, and what this module copies:
  * POST /public/v1/login {email, password} -> always HTTP 200, {status: success|failure, token, payload:{babies:[...]}}
  * every later call carries the token in an X-HatchBaby-Auth header
  * there is no "list weights" route. Weights arrive inside the general sync calls, as payload.weights:
      GET /service/app/pagedRefresh/v1/fetch/{babyId}/{olderDay}/{newerDay}   history, a week at a time
      GET /service/app/refresh/v3/fetch/{babyId}/{sinceEpochMillis}           what changed since the last sync
  * a weight is {id, weight (grams), measurementTime "yyyy-MM-dd HH:mm:ss" (the member's wall clock),
    manualEntry, deleted, details, ...}
  * an unauthenticated call is answered 403 {"status":"failure","message":"not authenticated"} (checked
    without credentials on 2026-10-05); the app treats any 401/403 except errorCode 1007 as "signed out".

Standard library only. Nothing here logs or returns a token or a password.
"""
from __future__ import annotations

import base64
import http.client
import json
import re
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

DEFAULT_BASE = "https://data.hatchbaby.com"
LOGIN_PATH = "/public/v1/login"
AUTH_HEADER = "X-HatchBaby-Auth"
USER_AGENT = "bramble-companion (self-hosted Baby Buddy sync)"
TIMEOUT = 20

# Sync routes that carry weights, by the name the rest of the code uses for them.
SOURCES = {
    "paged": "/service/app/pagedRefresh/v1/fetch/{baby}/{start}/{end}",
    "refresh": "/service/app/refresh/v3/fetch/{baby}/{since}",
}
# Where the list of weights sits inside the payload, and what each field is called. First match wins.
WEIGHT_LIST_KEYS = ("weights",)
FIELDS = {
    "id": ("id",),
    "grams": ("weight",),
    "time": ("measurementTime", "createDateInMemberTimeZone", "createDate"),
    "deleted": ("deleted",),
    "manual": ("manualEntry",),
    "note": ("details",),
}
EARLIEST_KEYS = ("earliestEntry",)
ERROR_ACCESS_DENIED = 1007  # the app's EC_ACCESS_IS_DENIED: a real refusal, not an expired session
# A Hatch Grow tops out near 20 kg; anything outside this is not grams and must not be imported as such.
MIN_GRAMS, MAX_GRAMS = 200.0, 60000.0
TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S.%f")


class HatchProblem(Exception):
    """A Hatch call that did not produce usable data.

    code: auth | rate | missing | shape | refused | unreachable
    """

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


def request(base: str, method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, object]:
    """One HTTP call. Returns (status, parsed JSON or None). Network failures raise HatchProblem('unreachable')."""
    req = urllib.request.Request(base.rstrip("/") + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", USER_AGENT)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header(AUTH_HEADER, token)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read()
        exc.close()
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as exc:
        raise HatchProblem("unreachable", type(getattr(exc, "reason", exc)).__name__) from None
    try:
        return status, json.loads(raw.decode("utf-8", "replace")) if raw else None
    except ValueError:
        return status, None


def _first(obj: dict, keys: tuple) -> object:
    for k in keys:
        if k in obj and obj[k] is not None:
            return obj[k]
    return None


def redact(text: object) -> str:
    """Hatch's own messages can quote the login email ("Login failed for [a@b.c]"); never keep that."""
    s = re.sub(r"\[[^\]]*\]", "[…]", str(text or ""))
    return re.sub(r"[\w.+-]+@[\w.-]+", "…", s)[:200]


def pattern(value: object) -> object:
    """The shape of a value without the value: digits become 9, letters a ("9999-99-99 99:99:99", "9999.9")."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (dict, list)):
        return f"{type(value).__name__}[{len(value)}]"
    kind = "number " if isinstance(value, (int, float)) else ""
    return kind + re.sub(r"[^\W\d_]", "a", re.sub(r"\d", "9", str(value)))[:40]


def describe(body: object) -> dict:
    """Key names and shapes of a response, for the report. Carries no values, so no data and no secrets."""
    out: dict = {"type": type(body).__name__}
    if not isinstance(body, dict):
        return out
    out["keys"] = sorted(map(str, body))[:40]
    out["status"] = redact(body.get("status"))
    if body.get("message"):
        out["message"] = redact(body.get("message"))
    if body.get("errorCode") is not None:
        out["errorCode"] = redact(body.get("errorCode"))
    payload = body.get("payload")
    if isinstance(payload, dict):
        out["payload"] = [f"{k}[{len(v)}]" if isinstance(v, list) else str(k) for k, v in sorted(payload.items())][:40]
        lists = {str(k): v[0] for k, v in payload.items() if isinstance(v, list) and v and isinstance(v[0], dict)}
        # Only the lists that could be the weights: the expected name, or anything that sounds like it.
        wanted = {k: v for k, v in lists.items() if k in WEIGHT_LIST_KEYS or "eigh" in k.lower() or "grow" in k.lower()}
        out["records"] = {k: {str(f): pattern(val) for f, val in sorted(first.items())} for k, first in list((wanted or lists).items())[:4]}
    elif payload is not None:
        out["payload"] = type(payload).__name__
    return out


def classify(status: int, body: object) -> None:
    """Raise HatchProblem unless this is a successful Hatch envelope."""
    code = body.get("errorCode") if isinstance(body, dict) else None
    if status in (401, 403):
        if str(code) == str(ERROR_ACCESS_DENIED):
            raise HatchProblem("refused", "Hatch refused access to this baby (error 1007)")
        raise HatchProblem("auth", f"HTTP {status}")
    if status == 429:
        raise HatchProblem("rate", "HTTP 429")
    if status == 404:
        raise HatchProblem("missing", "HTTP 404")
    if status >= 500:
        raise HatchProblem("unreachable", f"HTTP {status}")
    if status >= 400:
        raise HatchProblem("refused", f"HTTP {status}")
    if not isinstance(body, dict) or "status" not in body:
        raise HatchProblem("shape", "the answer is not a Hatch envelope")
    if body.get("status") != "success":
        raise HatchProblem("refused", redact(body.get("message")) or "Hatch reported a failure")


def parse_time(value: object, tz=None) -> datetime | None:
    """A Hatch timestamp as the member's wall-clock time (naive). Numbers are epoch milliseconds."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.fromtimestamp(value / 1000, tz or timezone.utc).astimezone(tz).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        for fmt in TIME_FORMATS:
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
    return None


def parse_day(value: object, tz=None) -> date | None:
    if isinstance(value, str) and len(value.strip()) <= 10:
        try:
            return date.fromisoformat(value.strip())
        except ValueError:
            return None
    when = parse_time(value, tz)
    return when.date() if when else None


def parse_record(raw: object, tz=None) -> dict | None:
    """One weight record -> {id, grams, measured, deleted, manual, note}, or None when it cannot be trusted."""
    if not isinstance(raw, dict):
        return None
    rid, grams = _first(raw, FIELDS["id"]), _first(raw, FIELDS["grams"])
    measured = next((t for t in (parse_time(raw.get(k), tz) for k in FIELDS["time"]) if t), None)
    try:
        rid, grams = int(rid), float(grams)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if isinstance(_first(raw, FIELDS["id"]), bool) or measured is None or not (MIN_GRAMS <= grams <= MAX_GRAMS):
        return None
    manual = _first(raw, FIELDS["manual"])
    return {
        "id": rid,
        "grams": round(grams, 1),
        "measured": measured,
        "deleted": _first(raw, FIELDS["deleted"]) is True,
        "manual": manual if isinstance(manual, bool) else None,
        "note": str(_first(raw, FIELDS["note"]) or "").strip()[:200],
    }


def parse_weights(body: object, tz=None) -> dict:
    """A successful sync answer -> {records, unreadable, sync, earliest}. Raises HatchProblem('shape')."""
    payload = body.get("payload") if isinstance(body, dict) else None
    rows = _first(payload, WEIGHT_LIST_KEYS) if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise HatchProblem("shape", f"no {' / '.join(WEIGHT_LIST_KEYS)} list in the answer")
    parsed = [parse_record(r, tz) for r in rows]
    records = [p for p in parsed if p]
    if rows and not records:
        raise HatchProblem("shape", "weight records are not in the expected form")
    sync = body.get("sync") if isinstance(body, dict) else None
    return {
        "records": records,
        "unreadable": len(rows) - len(records),
        "sync": int(sync) if isinstance(sync, (int, float)) and not isinstance(sync, bool) and sync > 0 else None,
        "earliest": parse_day(_first(payload, EARLIEST_KEYS), tz),
    }


def token_expiry(token: str) -> str | None:
    """Best effort: community samples show the token as base64("memberId:expiryMillis:signature").

    Returns the expiry as an ISO date-time when the token really has that shape, else None. Only ever
    used to tell the owner how long the session should last; nothing depends on it.
    """
    try:
        parts = base64.b64decode(token + "=" * (-len(token) % 4)).decode("ascii").split(":")
        millis = int(parts[1])
    except (ValueError, IndexError, UnicodeDecodeError):
        return None
    if len(parts) != 3 or not (1_500_000_000_000 < millis < 4_100_000_000_000):
        return None
    return datetime.fromtimestamp(millis / 1000, timezone.utc).isoformat(timespec="seconds")
