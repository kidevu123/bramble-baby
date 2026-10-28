"""Tests for the Hatch Grow import (hatch.py, hatch_api.py) against a fake Hatch cloud and a fake Baby Buddy.

Run on their own (`python3 -m unittest server/test_hatch.py`) or with the rest through test_server.py.
The fake Hatch speaks what the Android app expects: the login envelope, X-HatchBaby-Auth, and weights
inside the pagedRefresh / refresh sync answers.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import stat
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bramble_server as bs  # noqa: E402
import hatch as hatch_mod  # noqa: E402
import hatch_api  # noqa: E402

EMAIL, PASSWORD = "owner@example.com", "correct-horse-battery"
# Shaped like the community samples: base64("memberId:expiryMillis:signature").
HATCH_TOKEN = base64.b64encode(b"4321:1900000000000:0123456789abcdef0123456789abcdef").decode()
BB_TOKEN = "good"
SECRETS = (PASSWORD, HATCH_TOKEN)


def stamp(days_ago: int, clock: str = "09:30:00") -> str:
    return f"{(date.today() - timedelta(days=days_ago)).isoformat()} {clock}"


def day(days_ago: int) -> str:
    return (date.today() - timedelta(days=days_ago)).isoformat()


def account_day(days_ago: int) -> str:
    """A day in the Hatch account's zone (the fake account is in New York): the fetch window is asked for in it,
    so between midnight and 4 AM UTC it is still yesterday there."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return (datetime.now(ZoneInfo("America/New_York")).date() - timedelta(days=days_ago)).isoformat()


class World:
    """Shared, resettable state of the two fake services."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.babies = [{"id": 501, "name": "Ada", "birthDate": day(20), "birthWeight": 2400}]
        self.weights: dict[int, list[dict]] = {501: []}
        self.valid_tokens = {HATCH_TOKEN}
        self.login_status = 200
        self.list_key = "weights"  # rename to simulate Hatch changing its answer
        self.weight_key = "weight"
        self.missing: set[str] = set()  # "paged" / "refresh" answer 404
        self.paged_excludes_newer_day = False  # the history route treating its newer day as exclusive
        self.rate_limited = False
        self.requests: list[tuple[str, str]] = []
        self.next_hatch_id = 9000
        self.children = [{"id": 3, "first_name": "Ada", "last_name": "L"}]
        self.bb_weights: list[dict] = []
        self.bb_next = 100
        self.bb_reject_dates: set[str] = set()
        self.bb_tokens = {"good", "good2"}

    def weigh(self, baby: int, grams: float, days_ago: int, clock: str = "09:30:00", **extra) -> dict:
        self.next_hatch_id += 1
        # "_uploaded" is when the record reached Hatch's server, which is what the "since" route compares against.
        rec = {"id": self.next_hatch_id, "weight": grams, "rawWeight": grams, "measurementTime": stamp(days_ago, clock), "createDate": stamp(days_ago, clock), "updateDate": stamp(days_ago, clock), "deleted": False, "manualEntry": False, "details": None, "category": "SCP", "lockStatus": "W1", "uniqueKey": None, "_uploaded": time.time() * 1000, **extra}
        self.weights.setdefault(baby, []).append(rec)
        return rec

    def typed(self, child: int, value: float, days_ago: int, notes: str = "") -> dict:
        self.bb_next += 1
        row = {"id": self.bb_next, "child": child, "weight": value, "date": day(days_ago), "notes": notes, "tags": []}
        self.bb_weights.append(row)
        return row


W = World()


def _send(handler: BaseHTTPRequestHandler, status: int, body) -> None:
    raw = json.dumps(body).encode() if body is not None else b""
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


class FakeHatch(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_POST(self):
        W.requests.append(("POST", self.path))
        if self.path != "/public/v1/login":
            return _send(self, 404, {"status": 404})
        body = self._body()
        if W.login_status != 200:
            return _send(self, W.login_status, {"status": "failure", "message": "slow down"})
        if body.get("email") != EMAIL or body.get("password") != PASSWORD:
            return _send(self, 200, {"status": "failure", "message": f"Login failed for [{body.get('email')}]", "payload": None, "sync": None, "errorCode": "1001"})
        payload = {"id": 4321, "email": EMAIL, "babies": W.babies, "defaultUnitOfMeasure": "imperial", "timezone": "America/New_York", "firstName": "Owner"}
        _send(self, 200, {"status": "success", "message": "Successful login", "payload": payload, "sync": 1790000000000, "token": HATCH_TOKEN})

    def do_GET(self):
        W.requests.append(("GET", self.path))
        if self.headers.get("X-HatchBaby-Auth") not in W.valid_tokens:
            return _send(self, 403, {"status": "failure", "message": "not authenticated"})
        if W.rate_limited:
            return _send(self, 429, {"status": "failure", "message": "too many requests"})
        parts = self.path.strip("/").split("/")
        kind = parts[2] if len(parts) > 2 else ""
        if kind == "pagedRefresh" and "paged" not in W.missing and len(parts) == 8:
            baby, start, end = int(parts[5]), parts[6], parts[7]
            rows = [w for w in W.weights.get(baby, []) if start <= w["measurementTime"][:10] <= end and not (W.paged_excludes_newer_day and w["measurementTime"][:10] == end)]
            times = sorted(w["measurementTime"] for w in W.weights.get(baby, []))
            return _send(self, 200, self._answer(rows, earliestEntry=times[0] if times else None))
        if kind == "refresh" and "refresh" not in W.missing and len(parts) == 7:
            baby, since = int(parts[5]), int(parts[6])
            rows = [w for w in W.weights.get(baby, []) if w["_uploaded"] >= since]
            return _send(self, 200, self._answer(rows))
        _send(self, 404, {"timestamp": "now", "status": 404, "error": "Not Found", "path": self.path})

    @staticmethod
    def _answer(rows: list[dict], **extra) -> dict:
        rows = [{(W.weight_key if k == "weight" else k): v for k, v in r.items() if not k.startswith("_")} for r in rows]
        payload = {W.list_key: rows, "feedings": [], "diapers": [{"id": 1, "diaperType": "Wet"}], "lengths": [], **extra}
        return {"status": "success", "message": "ok", "payload": payload, "sync": int(datetime.now().timestamp() * 1000)}


class FakeBabyBuddy(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _token(self) -> str:
        return (self.headers.get("Authorization") or "").replace("Token ", "")

    def _route(self, method: str):
        url = urlparse(self.path)
        query = {k: v[-1] for k, v in parse_qs(url.query).items()}
        if self._token() not in W.bb_tokens:
            return _send(self, 403, {"detail": "Invalid token."})
        if url.path == "/api/profile":
            return _send(self, 200, {"user": {"id": 7, "username": "admin"}})
        if url.path == "/api/children/" and method == "GET":
            return _send(self, 200, {"count": len(W.children), "next": None, "previous": None, "results": W.children})
        if url.path == "/api/weight/" and method == "GET":
            rows = [w for w in W.bb_weights if str(w["child"]) == query.get("child", str(w["child"]))]
            offset, limit = int(query.get("offset", 0)), int(query.get("limit", 100))
            return _send(self, 200, {"count": len(rows), "next": None, "previous": None, "results": rows[offset : offset + limit]})
        if url.path == "/api/weight/" and method == "POST":
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            # Baby Buddy's Weight: child (pk), weight (float, required), date (a date, not in the future), notes.
            if body.get("child") not in {c["id"] for c in W.children}:
                return _send(self, 400, {"child": ["Invalid pk - object does not exist."]})
            if not isinstance(body.get("weight"), (int, float)) or len(str(body.get("date"))) != 10:
                return _send(self, 400, {"weight": ["A valid number is required."]})
            if body["date"] in W.bb_reject_dates or body["date"] > date.today().isoformat():
                return _send(self, 400, {"date": ["Date can not be in the future."]})
            W.bb_next += 1
            row = {"id": W.bb_next, "child": body["child"], "weight": body["weight"], "date": body["date"], "notes": body.get("notes") or "", "tags": []}
            W.bb_weights.append(row)
            return _send(self, 201, row)
        if url.path.startswith("/api/weight/") and method in ("GET", "PATCH"):
            wid = int(url.path.strip("/").split("/")[-1])
            row = next((w for w in W.bb_weights if w["id"] == wid), None)
            if row is None:
                return _send(self, 404, {"detail": "Not found."})
            if method == "PATCH":
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                row.update({k: body[k] for k in ("weight", "date", "notes") if k in body})
            return _send(self, 200, row)
        if url.path.startswith("/api/weight/") and method == "DELETE":
            wid = int(url.path.strip("/").split("/")[-1])
            if not any(w["id"] == wid for w in W.bb_weights):
                return _send(self, 404, {"detail": "Not found."})
            W.bb_weights[:] = [w for w in W.bb_weights if w["id"] != wid]
            return _send(self, 204, None)
        _send(self, 404, {"detail": "Not found."})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")

    def do_PATCH(self):
        self._route("PATCH")


class HatchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hatch_srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeHatch)
        cls.bb_srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeBabyBuddy)
        for srv in (cls.hatch_srv, cls.bb_srv):
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        cls.logs = io.StringIO()
        cls.log_handler = logging.StreamHandler(cls.logs)
        cls.log_level = logging.getLogger("bramble").level
        logging.getLogger("bramble").addHandler(cls.log_handler)
        logging.getLogger("bramble").setLevel(logging.DEBUG)

    @classmethod
    def tearDownClass(cls):
        logging.getLogger("bramble").removeHandler(cls.log_handler)
        logging.getLogger("bramble").setLevel(cls.log_level)
        for srv in (cls.hatch_srv, cls.bb_srv):
            srv.shutdown()
            srv.server_close()

    def setUp(self):
        W.reset()
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "t.db")
        self.boot()
        self.set_unit(3, "lb")

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.app.store.conn.close()
        self.tmp.cleanup()

    def boot(self):
        """Start (or restart) the companion on the same database, like a service restart."""
        if getattr(self, "srv", None):
            self.srv.shutdown()
            self.srv.server_close()
            self.app.store.conn.close()
        self.app, _ = bs.build(self.db, os.path.join(self.tmp.name, "vapid"), f"http://127.0.0.1:{self.bb_srv.server_port}")
        self.app.hatch.base = f"http://127.0.0.1:{self.hatch_srv.server_port}"
        self.app.hatch.page_pause = 0
        self.srv = bs.serve("127.0.0.1", 0, self.app)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_port}"

    def call(self, method, path, body=None, token=BB_TOKEN):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, method=method)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Token {token}")
        try:
            with urllib.request.urlopen(req) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            e.close()
            return e.code, (json.loads(raw) if raw else None)

    def set_unit(self, child: int, weight: str | None):
        # Start from a household with no units recorded: a PUT cannot remove them (it merges keys), and once
        # recorded they never change, so a test choosing the unit starts over.
        self.app.store.x("DELETE FROM settings WHERE child=?", (child,))
        blob = {"dayStart": "08:00"} if weight is None else {"storageUnits": {"weight": weight, "volume": "ml", "temp": "f", "length": "in"}}
        self.assertEqual(self.call("PUT", f"/settings/{child}", blob)[0], 200)

    def connect(self, password=PASSWORD):
        return self.call("POST", "/hatch/connect", {"email": EMAIL, "password": password})

    def sync(self):
        status, body = self.call("POST", "/hatch/sync")
        self.assertEqual(status, 200)
        return body

    def imported(self) -> list[dict]:
        return sorted((w for w in W.bb_weights if w["notes"].startswith("Hatch")), key=lambda w: (w["date"], w["id"]))

    # ---- sign-in
    def test_every_hatch_route_needs_a_signed_in_bramble_user(self):
        for method, path, body in (("GET", "/hatch", None), ("POST", "/hatch/connect", {"email": EMAIL, "password": PASSWORD}), ("POST", "/hatch/sync", {}), ("POST", "/hatch/disconnect", {}), ("PUT", "/hatch/babies", {"babies": []})):
            self.assertEqual(self.call(method, path, body, token=None)[0], 401, path)
            self.assertEqual(self.call(method, path, body, token="wrong")[0], 401, path)
        self.assertEqual([r for r in W.requests if r[0] == "POST"], [])  # nothing reached Hatch

    def test_status_before_connecting(self):
        status, body = self.call("GET", "/hatch")
        self.assertEqual((status, body["connected"], body["needsLogin"], body["babies"], body["problem"]), (200, False, False, [], None))
        self.assertEqual(self.call("POST", "/hatch/sync")[0], 409)

    def test_wrong_password_is_a_plain_message_and_stores_nothing(self):
        status, body = self.connect(password="nope")
        self.assertEqual(status, 400)
        self.assertEqual(body["detail"], "Hatch did not accept that email and password.")
        self.assertFalse(os.path.exists(self.app.hatch.secrets.path))
        self.assertFalse(self.call("GET", "/hatch")[1]["connected"])

    def test_connect_rejects_blank_fields_without_calling_hatch(self):
        self.assertEqual(self.call("POST", "/hatch/connect", {"email": "not-an-email", "password": "x"})[0], 400)
        self.assertEqual(self.call("POST", "/hatch/connect", {"email": EMAIL, "password": ""})[0], 400)
        self.assertEqual(W.requests, [])

    def test_sign_in_attempts_are_limited(self):
        for _ in range(hatch_mod.CONNECT_LIMIT):
            self.assertEqual(self.connect(password="nope")[0], 400)
        status, body = self.connect()
        self.assertEqual(status, 429)
        self.assertIn("Too many", body["detail"])

    def test_hatch_login_rate_limit_and_outage_are_reported(self):
        W.login_status = 429
        status, body = self.connect()
        self.assertEqual(status, 429)
        self.assertIn("limiting sign-ins", body["detail"])
        self.app.hatch.base = "http://127.0.0.1:1"  # nothing listens here
        status, body = self.connect()
        self.assertEqual(status, 503)
        self.assertIn("could not reach Hatch", body["detail"])

    def test_connect_maps_the_only_baby_to_the_only_child_and_imports(self):
        W.weigh(501, 2580, 12, "14:05:00")
        W.weigh(501, 2710, 5)
        W.weigh(501, 2890, 0, "07:45:00")
        status, body = self.connect()
        self.assertEqual(status, 200)
        self.assertTrue(body["connected"])
        self.assertEqual(body["email"], EMAIL)
        self.assertEqual(body["babies"], [{"id": 501, "name": "Ada", "child": 3, "imported": 3, "matched": 0, "pending": 0}])
        self.assertEqual((body["imported"], body["problem"], body["needsLogin"]), (3, None, False))
        self.assertIsNotNone(body["lastSuccess"])
        self.assertEqual(body["sessionExpires"], "2030-03-17T17:46:40+00:00")
        rows = self.imported()
        self.assertEqual([r["child"] for r in rows], [3, 3, 3])
        self.assertEqual([r["date"] for r in rows], [day(12), day(5), day(0)])
        # grams -> pounds, the household's storage unit
        self.assertEqual([r["weight"] for r in rows], [round(2580 / 453.59237, 6), round(2710 / 453.59237, 6), round(2890 / 453.59237, 6)])
        self.assertAlmostEqual(rows[0]["weight"], 5.687926, places=5)
        self.assertEqual(rows[0]["notes"], "Hatch Grow scale · 2:05 PM")
        self.assertEqual(rows[2]["notes"], "Hatch Grow scale · 7:45 AM")
        # history was read the way the app does it: week-sized pages, then "what changed"
        paths = [p for m, p in W.requests if m == "GET"]
        self.assertTrue(paths[0].startswith(f"/service/app/pagedRefresh/v1/fetch/501/{account_day(7)}/{account_day(0)}"), paths[0])
        self.assertTrue(any(p.startswith("/service/app/refresh/v3/fetch/501/") for p in paths))

    def test_kilogram_households_get_kilograms(self):
        self.set_unit(3, "kg")
        W.weigh(501, 3456, 2, details="after bath")
        W.weigh(501, 3500, 1, manualEntry=True)
        self.connect()
        rows = self.imported()
        self.assertEqual([r["weight"] for r in rows], [3.456, 3.5])
        self.assertEqual(rows[0]["notes"], "Hatch Grow scale · 9:30 AM · after bath")
        self.assertEqual(rows[1]["notes"], "Hatch app · 9:30 AM")

    def test_the_note_carries_the_clock_segment_the_app_parses(self):
        """The app places the entry in its day from the note's " · " clock segment (src/lib/growth-note.ts)."""
        W.weigh(501, 2580, 3, "00:05:00")
        W.weigh(501, 2600, 2, "12:00:00")
        W.weigh(501, 2650, 1, "19:10:00", details="after bath")
        W.weigh(501, 2700, 0, "08:38:00", manualEntry=True)
        self.connect()
        notes = [r["notes"] for r in self.imported()]
        self.assertEqual(notes, ["Hatch Grow scale · 12:05 AM", "Hatch Grow scale · 12:00 PM", "Hatch Grow scale · 7:10 PM · after bath", "Hatch app · 8:38 AM"])
        for note in notes:
            segments = note.split(" · ")
            self.assertIn(segments[0], (hatch_mod.NOTE_SCALE, hatch_mod.NOTE_APP))
            self.assertRegex(segments[1], hatch_mod.TIME_SEGMENT)
            self.assertEqual(sum(1 for s in segments if hatch_mod.TIME_SEGMENT.match(s)), 1)

    def test_unknown_storage_unit_imports_nothing_until_the_app_records_it(self):
        self.set_unit(3, None)
        W.weigh(501, 2580, 3)
        body = self.connect()[1]
        self.assertEqual(body["problem"]["code"], "units")
        self.assertEqual((body["imported"], body["pending"]), (0, 1))
        self.assertEqual(W.bb_weights, [])
        self.set_unit(3, "lb")
        body = self.sync()
        self.assertEqual((body["problem"], body["imported"], body["pending"]), (None, 1, 0))

    # ---- no duplicates
    def test_resync_restart_and_reconnect_never_import_twice(self):
        W.weigh(501, 2580, 9)
        W.weigh(501, 2700, 2)
        self.connect()
        self.assertEqual(len(self.imported()), 2)
        for _ in range(3):
            self.sync()
        self.assertEqual(len(self.imported()), 2)
        self.boot()  # service restart on the same database
        self.app.hatch.run_once()
        self.assertEqual(len(self.imported()), 2)
        self.assertEqual(self.call("POST", "/hatch/disconnect")[0], 200)
        self.assertFalse(os.path.exists(self.app.hatch.secrets.path))
        self.assertFalse(self.call("GET", "/hatch")[1]["connected"])
        body = self.connect()[1]  # signs in again: history is re-read, the ledger holds
        self.assertEqual(len(self.imported()), 2)
        self.assertEqual(body["imported"], 2)

    def test_a_new_weighing_arrives_on_the_next_poll(self):
        W.weigh(501, 2580, 4)
        self.connect()
        W.weigh(501, 2750, 0, "06:10:00")
        self.app.hatch.run_once()  # what the poll thread calls
        self.assertEqual([r["date"] for r in self.imported()], [day(4), day(0)])
        self.assertEqual(self.app.store.q("SELECT source FROM hatch_babies")[0]["source"], "refresh")

    def test_a_weighing_the_since_route_missed_is_caught_by_sync_now_and_by_the_daily_sweep(self):
        self.connect()
        W.weigh(501, 2750, 1, _uploaded=1.0)  # Hatch's "since" answer never includes it
        self.app.hatch.run_once()
        self.assertEqual(self.imported(), [])
        self.sync()  # the owner taps Sync now: the last week is re-read from the history route
        self.assertEqual([r["date"] for r in self.imported()], [day(1)])
        W.weigh(501, 2800, 2, _uploaded=1.0)
        self.app.hatch.run_once()
        self.assertEqual(len(self.imported()), 1)
        self.app.store.x("UPDATE hatch_babies SET swept_at='2020-01-01T00:00:00+00:00'")  # a day has passed
        self.app.hatch.run_once()
        self.assertEqual(len(self.imported()), 2)

    def test_first_import_leaves_days_that_already_have_a_typed_weight_alone(self):
        typed = W.typed(3, 5.11, 9, "typed by hand")  # the same weighing, typed as "5 lb 11" style
        W.weigh(501, 2580, 9, "08:00:00")
        W.weigh(501, 2600, 9, "20:00:00")
        W.weigh(501, 2700, 6)
        body = self.connect()[1]
        self.assertEqual((body["imported"], body["matched"]), (1, 2))
        self.assertEqual([r["date"] for r in self.imported()], [day(6)])
        self.assertEqual([w for w in W.bb_weights if w["date"] == day(9)], [typed])  # untouched, no second entry
        ledger = {r["status"]: r["bb_id"] for r in self.app.store.q("SELECT status, bb_id FROM hatch_weights WHERE measured_at LIKE ?", (day(9) + "%",))}
        self.assertEqual(ledger, {"matched": typed["id"]})
        self.sync()
        self.assertEqual(len(W.bb_weights), 2)

    def test_todays_weighing_is_part_of_the_first_import_even_if_history_pages_stop_short_of_today(self):
        W.paged_excludes_newer_day = True
        typed = W.typed(3, 5.11, 0)  # typed this morning, in a form no tolerance would match
        W.weigh(501, 2580, 0, "08:00:00")
        W.weigh(501, 2500, 3)
        body = self.connect()[1]
        self.assertEqual((body["imported"], body["matched"], body["problem"]), (1, 1, None))
        self.assertEqual([w for w in W.bb_weights if w["date"] == day(0)], [typed])

    def test_after_connecting_only_a_typed_copy_of_the_same_value_is_skipped(self):
        self.connect()
        # typed by hand right after weighing, before the poll: 2800 g is 6.17 lb
        W.typed(3, 6.17, 0)
        W.weigh(501, 2800, 0, "10:00:00")
        body = self.sync()
        self.assertEqual((body["imported"], body["matched"]), (0, 1))
        # a different weighing later the same day is real data and is kept
        W.weigh(501, 2950, 0, "18:00:00")
        body = self.sync()
        self.assertEqual((body["imported"], body["matched"]), (1, 1))
        self.assertEqual(len(W.bb_weights), 2)

    def test_a_hospital_weight_typed_the_same_day_does_not_swallow_the_scale_weighing(self):
        # 2026-10-21: weights from the hospital are typed in lb + oz with their own time; a Hatch weighing that
        # day within an ounce of it is a different weighing and must still come in.
        self.connect()
        hospital = W.typed(3, 6.17, 0, "10:15 AM · Hospital")  # 2800 g at the hospital in the morning
        W.weigh(501, 2805, 0, "18:00:00")  # the Hatch at home in the evening
        body = self.sync()
        self.assertEqual((body["imported"], body["matched"]), (1, 0))
        self.assertEqual(len([w for w in W.bb_weights if w["date"] == day(0)]), 2)
        self.assertIn(hospital, W.bb_weights)  # theirs, untouched
        # a typed copy with a clock near the scale's own time is still the same weighing
        W.typed(3, 6.2, 0, "8:20 PM")
        W.weigh(501, 2812, 0, "20:05:00")
        body = self.sync()
        self.assertEqual((body["imported"], body["matched"]), (1, 1))

    def test_one_typed_weight_stands_for_one_weighing_only(self):
        # sweep 2026-10-21: a typed copy matched every scale weighing near it, hiding the second one
        self.connect()
        W.typed(3, 6.17, 0, "10:10 AM")
        W.weigh(501, 2800, 0, "10:00:00")
        W.weigh(501, 2810, 0, "10:20:00")
        body = self.sync()
        self.assertEqual((body["imported"], body["matched"]), (1, 1))
        self.assertEqual(len([w for w in W.bb_weights if w["date"] == day(0)]), 2)

    def test_a_weighing_edited_then_deleted_in_hatch_leaves_bramble(self):
        # sweep 2026-10-21: an edit Baby Buddy refused left the row 'updating'; a delete then found no branch and
        # the next import wrote the weighing back
        rec = W.weigh(501, 2431, 0, "08:00:00")
        self.connect()
        rec.update(weight=2481, _uploaded=time.time() * 1000)
        W.bb_tokens = set()  # Baby Buddy refuses this poll
        self.sync()
        W.bb_tokens = {"good", "good2"}
        rec.update(deleted=True, _uploaded=time.time() * 1000)
        self.sync()
        self.assertEqual(self.imported(), [])

    def test_two_scale_weighings_on_one_day_are_both_kept(self):
        self.connect()
        W.weigh(501, 2800, 0, "10:00:00")
        W.weigh(501, 2805, 0, "10:20:00")
        self.assertEqual(self.sync()["imported"], 2)

    def test_a_weighing_changed_in_hatch_is_changed_in_bramble(self):
        # 2026-10-12: Hatch showed 5 lb 7.5 oz (2481 g) where Bramble kept 5 lb 5.75 oz (2431 g). A record Bramble had
        # already seen was never read again, so a weighing changed in Hatch stayed old in Bramble for good.
        rec = W.weigh(501, 2431, 0, "18:13:00")
        self.connect()
        [first] = self.imported()
        self.assertAlmostEqual(first["weight"] * 453.59237, 2431, delta=0.5)
        # The family adds a word to the note in Bramble; it must survive the update.
        first["notes"] = first["notes"] + " · after bath"
        rec.update(weight=2481, measurementTime=stamp(0, "18:30:00"), _uploaded=time.time() * 1000)
        self.sync()
        [after] = self.imported()  # changed in place: no second entry
        self.assertEqual(after["id"], first["id"])
        self.assertAlmostEqual(after["weight"] * 453.59237, 2481, delta=0.5)
        self.assertEqual(after["notes"], "Hatch Grow scale · 6:30 PM · after bath")
        self.assertEqual(self.app.store.q("SELECT status, grams FROM hatch_weights WHERE hatch_id=?", (rec["id"],))[0], {"status": "imported", "grams": 2481.0})
        # Seen again unchanged: nothing written.
        writes = len(W.requests)
        self.sync()
        [same] = self.imported()
        self.assertEqual((same["weight"], same["notes"]), (after["weight"], after["notes"]))
        self.assertGreaterEqual(len(W.requests), writes)

    def test_a_change_to_a_weighing_the_family_typed_leaves_their_entry_alone(self):
        typed = W.typed(3, 6.17, 0)  # 2800 g typed by hand
        rec = W.weigh(501, 2800, 0, "10:00:00")
        self.connect()
        self.assertEqual(self.app.store.q("SELECT status FROM hatch_weights WHERE hatch_id=?", (rec["id"],))[0]["status"], "matched")
        rec.update(weight=2810, _uploaded=time.time() * 1000)
        self.sync()
        self.assertEqual([w for w in W.bb_weights if w["date"] == day(0)], [typed])  # theirs, untouched, no copy

    def test_the_report_lists_the_latest_weighings_as_hatch_sent_them(self):
        W.weigh(501, 2431, 0, "18:13:00")
        W.weigh(501, 2452, 1, "10:36:00")
        self.connect()
        report = self.call("GET", "/hatch")[1]["report"]
        self.assertIn("latest weighings from Hatch", report)
        self.assertIn("6:13 PM 2431 g (5 lb 5.8 oz) in Bramble", report)
        self.assertIn("10:36 AM 2452 g (5 lb 6.5 oz) in Bramble", report)

    def test_weighing_deleted_in_hatch_is_removed_or_never_imported(self):
        gone_early = W.weigh(501, 9999, 3, deleted=True)
        kept = W.weigh(501, 2580, 3)
        self.connect()
        self.assertEqual(len(self.imported()), 1)
        self.assertEqual(self.app.store.q("SELECT COUNT(*) AS n FROM hatch_weights WHERE hatch_id=?", (gone_early["id"],))[0]["n"], 0)
        kept["deleted"] = True
        kept["_uploaded"] = time.time() * 1000
        self.sync()
        self.assertEqual(self.imported(), [])
        self.assertEqual(self.app.store.q("SELECT status FROM hatch_weights WHERE hatch_id=?", (kept["id"],))[0]["status"], "removed")

    # ---- babies
    def test_several_babies_wait_for_the_owner_to_choose(self):
        W.babies.append({"id": 502, "name": "Nico", "birthDate": day(20)})
        W.children.append({"id": 4, "first_name": "Nico", "last_name": "L"})
        self.set_unit(4, "lb")
        W.weigh(501, 2580, 2)
        W.weigh(502, 3100, 2)
        body = self.connect()[1]
        self.assertEqual([(b["id"], b["child"]) for b in body["babies"]], [(501, None), (502, None)])
        self.assertEqual((body["problem"], W.bb_weights), (None, []))
        self.assertEqual([p for m, p in W.requests if m == "GET"], [])  # no data was fetched yet
        self.assertEqual(self.call("PUT", "/hatch/babies", {"babies": [{"id": 501, "child": 99}]})[0], 400)
        self.assertEqual(self.call("PUT", "/hatch/babies", {"babies": [{"id": 777, "child": 3}]})[0], 400)
        status, body = self.call("PUT", "/hatch/babies", {"babies": [{"id": 501, "child": 4}, {"id": 502, "child": 0}]})
        self.assertEqual(status, 200)
        self.assertEqual([(b["id"], b["child"], b["imported"]) for b in body["babies"]], [(501, 4, 1), (502, 0, 0)])
        self.assertEqual([(r["child"], r["weight"]) for r in self.imported()], [(4, round(2580 / 453.59237, 6))])

    def test_a_bad_mapping_changes_nothing(self):
        """One wrong row in the PUT must not leave the rows before it half-applied (and start an import for them)."""
        W.babies.append({"id": 502, "name": "Nico", "birthDate": day(20)})
        W.children.append({"id": 4, "first_name": "Nico", "last_name": "L"})
        W.weigh(501, 2580, 2)
        self.connect()
        W.requests.clear()
        for bad in ({"id": 777, "child": 3}, {"id": 502, "child": 99}, {"id": 502, "child": "x"}, "not a dict"):
            status, body = self.call("PUT", "/hatch/babies", {"babies": [{"id": 501, "child": 3}, bad]})
            self.assertEqual(status, 400, bad)
            self.assertEqual([(b["id"], b["child"]) for b in self.call("GET", "/hatch")[1]["babies"]], [(501, None), (502, None)], bad)
        self.assertEqual([p for m, p in W.requests if m == "GET"], [])  # no import started on a refused request
        self.assertEqual(W.bb_weights, [])

    def test_login_attempts_after_a_disconnect_still_appear_in_the_report(self):
        self.connect()
        self.assertEqual(self.call("POST", "/hatch/disconnect")[0], 200)
        self.assertEqual(self.connect(password="nope")[0], 400)  # a mistyped password on the way back in
        self.assertEqual(self.connect()[0], 200)
        report = self.call("GET", "/hatch")[1]["report"]
        self.assertEqual(report.count("POST /public/v1/login -> 200"), 2, report)
        self.assertIn("-> 200 refused", report)
        self.assertIn("-> 200 ok", report)

    def test_one_baby_in_trouble_does_not_hold_back_the_other(self):
        W.babies.append({"id": 502, "name": "Nico", "birthDate": day(20)})
        W.children.append({"id": 4, "first_name": "Nico", "last_name": "L"})
        W.weigh(501, 2580, 2)
        W.weigh(502, 3100, 2)
        self.connect()
        # Ada (first in order) maps to a child with no storage unit recorded, so her import halts; Nico's must still run.
        status, body = self.call("PUT", "/hatch/babies", {"babies": [{"id": 501, "child": 4}, {"id": 502, "child": 3}]})
        self.assertEqual(status, 200)
        self.assertEqual(body["problem"]["code"], "units")
        self.assertEqual([(r["child"], r["weight"]) for r in self.imported()], [(3, round(3100 / 453.59237, 6))])
        self.set_unit(4, "lb")
        body = self.sync()
        self.assertEqual((body["problem"], body["imported"]), (None, 2))

    def test_disconnect_during_a_sync_stops_it_writing(self):
        W.weigh(501, 2580, 3)
        W.weigh(501, 2700, 1)
        W.weigh(501, 2900, 0)
        hatch = self.app.hatch
        real_call = hatch.bb.call

        def call_then_disconnect(token, method, path, body=None):
            result = real_call(token, method, path, body)
            if method == "POST":
                hatch.disconnect()  # the owner taps Disconnect while the first weight is being written
            return result

        hatch.bb.call = call_then_disconnect
        self.connect()  # runs the first import inline
        # One weight went through before the disconnect; the run then stopped instead of writing the other two.
        self.assertEqual(len(self.imported()), 1)
        self.assertEqual(hatch.store.q("SELECT count(*) AS n FROM hatch_log")[0]["n"], 0)
        self.assertEqual(hatch.store.q("SELECT count(*) AS n FROM hatch_account WHERE connected_at IS NOT NULL")[0]["n"], 0)
        self.assertFalse(os.path.exists(hatch.secrets.path))
        body = self.call("GET", "/hatch")[1]
        self.assertEqual((body["connected"], body["problem"]), (False, None))

    # ---- when Hatch does not cooperate
    def test_expired_session_asks_to_sign_in_again_and_recovers(self):
        W.weigh(501, 2580, 3)
        self.connect()
        W.valid_tokens.clear()  # Hatch revoked the session
        W.weigh(501, 2700, 0)
        body = self.sync()
        self.assertTrue(body["needsLogin"])
        self.assertEqual(body["problem"]["code"], "needs_login")
        self.assertIn("Sign in again", body["problem"]["message"])
        self.assertTrue(body["connected"])  # still shown as the same account, waiting for a sign-in
        self.assertNotIn("hatch_token", self.app.hatch.secrets.read())
        before = len(W.requests)
        self.app.hatch.run_once()  # the poll does not hammer Hatch while signed out
        self.assertEqual(len(W.requests), before)
        W.valid_tokens.add(HATCH_TOKEN)
        body = self.connect()[1]
        self.assertEqual((body["needsLogin"], body["problem"], body["imported"]), (False, None, 2))
        self.assertEqual(len(self.imported()), 2)

    def test_unrecognised_answer_imports_nothing_and_reports_what_came_back(self):
        W.weigh(501, 2580, 3)
        W.list_key = "weightRecords"
        body = self.connect()[1]
        self.assertEqual(body["problem"]["code"], "shape")
        self.assertIn("not in the form Bramble expects", body["problem"]["message"])
        self.assertEqual((body["imported"], W.bb_weights), (0, []))
        report = body["report"]
        self.assertIn(f"/service/app/pagedRefresh/v1/fetch/501/{account_day(7)}/{account_day(0)} -> 200 shape", report)
        self.assertIn("/service/app/refresh/v3/fetch/501/0 -> 200 shape", report)  # the second route was tried too
        self.assertIn('"weightRecords[1]"', report)  # where the list really is
        self.assertIn('"measurementTime": "9999-99-99 99:99:99"', report)  # field names and value shapes, no values
        self.assertIn('"weight": "number 9999"', report)
        for secret in SECRETS + (EMAIL, "2580"):
            self.assertNotIn(secret, report)
        # corrected mapping (here: Hatch's answer goes back to normal) and one tap fixes it
        W.list_key = "weights"
        body = self.sync()
        self.assertEqual((body["problem"], body["imported"]), (None, 1))

    def test_renamed_weight_field_is_a_shape_problem_not_a_wrong_number(self):
        W.weigh(501, 2580, 3)
        W.weight_key = "weightInGrams"
        body = self.connect()[1]
        self.assertEqual(body["problem"]["code"], "shape")
        self.assertIn('"weightInGrams": "number 9999"', body["report"])
        self.assertEqual(W.bb_weights, [])

    def test_values_that_cannot_be_grams_are_not_imported(self):
        W.weigh(501, 5.69, 3)  # pounds, if Hatch ever changed the unit
        body = self.connect()[1]
        self.assertEqual(body["problem"]["code"], "shape")
        self.assertEqual(W.bb_weights, [])

    def test_missing_history_route_falls_back_and_the_working_route_is_remembered(self):
        W.missing = {"paged"}
        W.weigh(501, 2580, 6)
        W.weigh(501, 2700, 1)
        body = self.connect()[1]
        self.assertEqual((body["problem"], body["imported"]), (None, 2))
        self.assertIn("/service/app/refresh/v3/fetch/501/0", [p for _, p in W.requests])
        W.missing = {"refresh"}
        W.weigh(501, 2800, 0, "11:00:00")
        body = self.sync()
        self.assertEqual((body["problem"], body["imported"]), (None, 3))
        self.assertEqual(self.app.store.q("SELECT source FROM hatch_babies")[0]["source"], "paged")
        W.requests.clear()
        self.sync()
        self.assertIn("pagedRefresh", W.requests[0][1])  # tried first now

    def test_no_route_at_all_is_reported_with_both_paths(self):
        W.missing = {"paged", "refresh"}
        body = self.connect()[1]
        self.assertEqual(body["problem"]["code"], "no_route")
        self.assertIn("-> 404 missing", body["report"])
        self.assertIn("pagedRefresh", body["report"])
        self.assertIn("refresh/v3", body["report"])

    def test_rate_limit_backs_off_until_sync_now(self):
        self.connect()
        W.rate_limited = True
        self.assertEqual(self.sync()["problem"]["code"], "rate_limited")
        W.rate_limited = False
        before = len(W.requests)
        self.app.hatch.run_once()  # the poll waits out the back-off
        self.assertEqual(len(W.requests), before)
        self.assertIsNone(self.sync()["problem"])  # a tap overrides it

    def test_hatch_outage_keeps_the_session_and_recovers(self):
        self.connect()
        good = self.app.hatch.base
        self.app.hatch.base = "http://127.0.0.1:1"
        body = self.sync()
        self.assertEqual((body["problem"]["code"], body["needsLogin"]), ("hatch_unreachable", False))
        self.app.hatch.base = good
        self.assertIsNone(self.sync()["problem"])

    # ---- when Baby Buddy does not cooperate
    def test_entry_refused_by_baby_buddy_is_retried_and_does_not_block_the_rest(self):
        W.weigh(501, 2580, 4)
        W.weigh(501, 2700, 2)
        W.bb_reject_dates = {day(4)}
        body = self.connect()[1]
        self.assertEqual(body["problem"]["code"], "babybuddy")
        self.assertEqual((body["imported"], body["pending"]), (1, 1))
        W.bb_reject_dates = set()
        body = self.sync()
        self.assertEqual((body["problem"], body["imported"], body["pending"]), (None, 2, 0))
        self.assertEqual(len(self.imported()), 2)

    def test_stale_baby_buddy_token_is_refreshed_by_the_next_caregiver_who_opens_the_sheet(self):
        self.connect()
        W.bb_tokens = {"good2"}  # the connecting caregiver's API key was regenerated
        W.weigh(501, 2580, 0)
        self.app.hatch.run_once()
        self.assertEqual(self.app.hatch.status()["problem"]["code"], "babybuddy_auth")
        status, body = self.call("POST", "/hatch/sync", token="good2")
        self.assertEqual((status, body["problem"], body["imported"]), (200, None, 1))

    # ---- secrets
    def test_secrets_stay_in_an_owner_only_file_and_never_leave(self):
        W.weigh(501, 2580, 3)
        seen = [self.connect()[1], self.sync(), self.call("GET", "/hatch")[1], self.call("GET", "/health", token=None)[1], self.call("GET", "/settings/3")[1]]
        W.valid_tokens.clear()
        seen.append(self.sync())  # the signed-out state too
        W.valid_tokens.add(HATCH_TOKEN)
        seen.append(self.connect()[1])
        seen.append(self.call("PUT", "/hatch/babies", {"babies": [{"id": 501, "child": 3}]})[1])
        path = self.app.hatch.secrets.path
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertEqual(os.path.dirname(path), self.tmp.name)  # next to the database
        with open(path, encoding="utf-8") as fh:
            stored = json.load(fh)
        self.assertEqual(stored, {"hatch_token": HATCH_TOKEN, "bb_token": BB_TOKEN})  # no password, nothing else
        seen.append(self.call("POST", "/hatch/disconnect")[1])
        self.app.store.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        with open(self.db, "rb") as fh:
            database = fh.read().decode("latin-1")
        for secret in SECRETS:
            self.assertNotIn(secret, json.dumps(seen))
            self.assertNotIn(secret, database)
            self.assertNotIn(secret, self.logs.getvalue())
        self.assertNotIn(BB_TOKEN + '"', json.dumps(seen))
        self.assertNotIn(EMAIL, self.logs.getvalue())


class HatchApiTest(unittest.TestCase):
    """The small Hatch-specific module on its own."""

    def test_unauthenticated_answer_means_sign_in_again(self):
        with self.assertRaises(hatch_api.HatchProblem) as ctx:
            hatch_api.classify(403, {"status": "failure", "message": "not authenticated"})
        self.assertEqual(ctx.exception.code, "auth")
        with self.assertRaises(hatch_api.HatchProblem) as ctx:
            hatch_api.classify(403, {"status": "failure", "errorCode": 1007})
        self.assertEqual(ctx.exception.code, "refused")  # a real refusal, not an expired session

    def test_failure_envelope_and_non_envelope(self):
        with self.assertRaises(hatch_api.HatchProblem) as ctx:
            hatch_api.classify(200, {"status": "failure", "message": "Login failed for [someone@example.com]", "errorCode": "1001"})
        self.assertEqual(ctx.exception.code, "refused")
        self.assertNotIn("someone@example.com", ctx.exception.detail)
        with self.assertRaises(hatch_api.HatchProblem) as ctx:
            hatch_api.classify(200, ["not", "an", "envelope"])
        self.assertEqual(ctx.exception.code, "shape")
        hatch_api.classify(200, {"status": "success", "payload": {}})

    def test_time_segment_is_twelve_hour_and_locale_free(self):
        cases = {(0, 5): "12:05 AM", (8, 38): "8:38 AM", (11, 59): "11:59 AM", (12, 0): "12:00 PM", (12, 30): "12:30 PM", (19, 10): "7:10 PM", (23, 59): "11:59 PM"}
        for (h, m), want in cases.items():
            got = hatch_mod.time_segment(datetime(2026, 10, 6, h, m))
            self.assertEqual(got, want)
            self.assertRegex(got, hatch_mod.TIME_SEGMENT)
        for bad in ("13:00 PM", "0:30 AM", "8:60 AM", "08:38 AM", "8:38am", "Hatch Grow scale"):
            self.assertIsNone(hatch_mod.TIME_SEGMENT.match(bad), bad)

    def test_record_parsing(self):
        rec = hatch_api.parse_record({"id": 7, "weight": 3120.4, "measurementTime": "2026-10-04 21:15:00", "manualEntry": False, "deleted": False, "details": " after feed "})
        self.assertEqual((rec["id"], rec["grams"], rec["measured"], rec["manual"], rec["deleted"], rec["note"]), (7, 3120.4, datetime(2026, 10, 4, 21, 15), False, False, "after feed"))
        # falls back to the member-local creation time when measurementTime is absent
        self.assertEqual(hatch_api.parse_record({"id": "8", "weight": "3000", "createDateInMemberTimeZone": "2026-10-04 08:00:00"})["measured"], datetime(2026, 10, 4, 8, 0))
        for bad in (None, [], {"id": 1, "weight": 3000}, {"id": 1, "measurementTime": "2026-10-04 08:00:00"}, {"id": "x", "weight": 3000, "measurementTime": "2026-10-04 08:00:00"}, {"id": 1, "weight": 70000, "measurementTime": "2026-10-04 08:00:00"}, {"id": 1, "weight": 3000, "measurementTime": "yesterday"}):
            self.assertIsNone(hatch_api.parse_record(bad), bad)

    def test_epoch_millis_are_read_in_the_members_timezone(self):
        from zoneinfo import ZoneInfo

        millis = int(datetime(2026, 10, 5, 3, 30, tzinfo=ZoneInfo("UTC")).timestamp() * 1000)
        self.assertEqual(hatch_api.parse_time(millis, ZoneInfo("America/New_York")), datetime(2026, 10, 4, 23, 30))

    def test_partly_readable_lists_keep_the_good_records(self):
        out = hatch_api.parse_weights({"status": "success", "sync": 1790000000000, "payload": {"weights": [{"id": 1, "weight": 3000, "measurementTime": "2026-10-04 08:00:00"}, {"id": 2}], "earliestEntry": "2026-09-20 10:00:00"}})
        self.assertEqual((len(out["records"]), out["unreadable"], out["sync"], out["earliest"]), (1, 1, 1790000000000, date(2026, 9, 20)))
        self.assertEqual(hatch_api.parse_weights({"status": "success", "payload": {"weights": []}})["records"], [])

    def test_token_expiry_is_read_only_from_tokens_of_the_known_shape(self):
        self.assertEqual(hatch_api.token_expiry(HATCH_TOKEN), "2030-03-17T17:46:40+00:00")
        for other in ("", "opaque-token-value", base64.b64encode(b"a:b:c").decode(), base64.b64encode(b"1:2").decode()):
            self.assertIsNone(hatch_api.token_expiry(other))

    def test_describe_keeps_names_and_shapes_only(self):
        d = hatch_api.describe({"status": "success", "token": HATCH_TOKEN, "payload": {"email": EMAIL, "weights": [{"id": 12345, "weight": 2580.5, "measurementTime": "2026-10-04 08:00:00", "details": "private note"}], "babies": [{"name": "Ada"}]}})
        text = json.dumps(d)
        self.assertIn("token", d["keys"])
        self.assertEqual(d["records"], {"weights": {"details": "aaaaaaa aaaa", "id": "number 99999", "measurementTime": "9999-99-99 99:99:99", "weight": "number 9999.9"}})
        for secret in (HATCH_TOKEN, EMAIL, "private note", "Ada", "2580"):
            self.assertNotIn(secret, text)


if __name__ == "__main__":
    unittest.main()
