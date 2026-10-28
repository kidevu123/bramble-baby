"""Tests for the Bramble companion server. Standard library only; push sending is mocked."""
from __future__ import annotations

import base64
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bramble_server as bs  # noqa: E402


class FakeBabyBuddy(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/profile" and self.headers.get("Authorization") == "Token good":
            body = json.dumps({"user": {"id": 7, "username": "admin"}, "api_key": "good"}).encode()
            self.send_response(200)
        elif self.path == "/api/profile" and self.headers.get("Authorization") == "Token boss":
            body = json.dumps({"user": {"id": 8, "username": "boss", "is_staff": True}, "api_key": "boss"}).encode()
            self.send_response(200)
        else:
            body = json.dumps({"detail": "Invalid token."}).encode()
            self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bb = HTTPServer(("127.0.0.1", 0), FakeBabyBuddy)
        threading.Thread(target=cls.bb.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.app, cls.delivery = bs.build(os.path.join(cls.tmp.name, "t.db"), os.path.join(cls.tmp.name, "vapid"), f"http://127.0.0.1:{cls.bb.server_port}")
        cls.srv = bs.serve("127.0.0.1", 0, cls.app)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.bb.shutdown()
        cls.bb.server_close()
        cls.app.store.conn.close()
        cls.tmp.cleanup()

    def setUp(self):
        self.sent = []
        self.fail_with = {}

        def fake_send(sub, payload, vapid):
            self.sent.append((sub["endpoint"], payload))
            status = self.fail_with.get(sub["endpoint"])
            if status:
                raise bs.PushSendError(status)

        self._orig = bs.send_push
        bs.send_push = fake_send
        for t in ("contractions", "activities", "milestones", "reminders", "subscriptions", "settings", "milk_bags", "milk_uses"):
            self.app.store.x(f"DELETE FROM {t}")

    def tearDown(self):
        bs.send_push = self._orig

    def call(self, method, path, body=None, token="good", prefix=""):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + prefix + path, data=data, method=method)
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

    # ---- auth / health
    def test_health_is_public_and_reports_push(self):
        status, body = self.call("GET", "/health", token=None)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertIn("push", body)
        self.assertIn("webpush", body)
        self.assertIn("vapid", body)
        self.assertIn("subscriptions", body)

    def test_missing_vapid_contact_is_named_not_forwarded_to_apple(self):
        orig = bs.VAPID_SUB
        try:
            bs.VAPID_SUB = None
            status, body = self.call("GET", "/health", token=None)
            self.assertEqual(status, 200)
            self.assertFalse(body["contact"])
            if self.app.vapid.problem is None:  # key problems win when the crypto libs are absent locally
                self.assertIn("BRAMBLE_VAPID_SUB", body["problem"] or "")
            vapid = type("V", (), {"enabled": True, "private_key_path": "/nonexistent"})()
            with self.assertRaises(bs.PushSendError) as ctx:
                self._orig({"endpoint": "https://web.push.apple.com/x", "keys": {"p256dh": "a", "auth": "b"}}, {}, vapid)
            self.assertIn("BRAMBLE_VAPID_SUB", str(ctx.exception))
            bs.VAPID_SUB = "admin@example.com"
            self.assertIn("mailto:", bs.vapid_contact_problem())
            bs.VAPID_SUB = "mailto:owner@example.com"
            self.assertIsNone(bs.vapid_contact_problem())
        finally:
            bs.VAPID_SUB = orig

    def test_head_and_options_do_not_501(self):
        for method in ("HEAD", "OPTIONS"):
            req = urllib.request.Request(self.base + "/health", method=method)
            with urllib.request.urlopen(req) as res:
                self.assertIn(res.status, (200, 204))

    def test_bad_content_length_is_400_not_crash(self):
        import http.client

        conn = http.client.HTTPConnection("127.0.0.1", self.srv.server_port, timeout=5)
        conn.putrequest("POST", "/reminders")
        conn.putheader("Content-Length", "abc")
        conn.putheader("Authorization", "Token good")
        conn.endheaders()
        self.assertEqual(conn.getresponse().status, 400)
        conn.close()

    def test_invalid_values_are_400_not_500(self):
        self.assertEqual(self.call("GET", "/contractions?child=1.5")[0], 400)
        self.assertEqual(self.call("POST", "/contractions", {"child": {"a": 1}, "start": "2026-09-01T10:00:00Z"})[0], 400)
        self.assertEqual(self.call("GET", "/contractions?child=1.5")[1], {"detail": "Invalid value."})

    def test_vapid_endpoint_is_503_when_unconfigured(self):
        saved = self.app.vapid.public_key_b64
        self.app.vapid.public_key_b64 = None
        try:
            status, body = self.call("GET", "/push/vapid", token=None)
            self.assertEqual(status, 503)
            self.assertIn("not configured", body["detail"])
        finally:
            self.app.vapid.public_key_b64 = saved

    def test_upstream_outage_is_503_not_401(self):
        app2, _ = bs.build(os.path.join(self.tmp.name, "t2.db"), os.path.join(self.tmp.name, "vapid"), "http://127.0.0.1:1")
        status, body = app2.handle("GET", "/contractions?child=1", {"Authorization": "Token good"}, b"")
        self.assertEqual(status, 503)
        self.assertIn("not reachable", body["detail"])
        app2.store.conn.close()

    def test_auth_sends_configured_host_header(self):
        seen = {}

        class Recorder(BaseHTTPRequestHandler):
            def do_GET(self):
                seen["host"] = self.headers.get("Host")
                body = json.dumps({"user": {"id": 9}}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        rec = HTTPServer(("127.0.0.1", 0), Recorder)
        threading.Thread(target=rec.serve_forever, daemon=True).start()
        try:
            auth = bs.Auth(f"http://127.0.0.1:{rec.server_port}", host_header="baby.example.com")
            self.assertEqual(auth.user_id("tok"), 9)
            self.assertEqual(seen["host"], "baby.example.com")
        finally:
            rec.shutdown()
            rec.server_close()

    def test_prefix_is_stripped(self):
        self.assertEqual(self.call("GET", "/health", token=None, prefix="/bramble")[0], 200)

    def test_rejects_missing_or_bad_token(self):
        self.assertEqual(self.call("GET", "/contractions?child=1", token=None)[0], 401)
        self.assertEqual(self.call("GET", "/contractions?child=1", token="bad")[0], 401)

    def test_unknown_route_404(self):
        self.assertEqual(self.call("GET", "/nope")[0], 404)

    # ---- settings
    def test_settings_roundtrip(self):
        self.assertEqual(self.call("GET", "/settings/3"), (200, {}))
        status, body = self.call("PUT", "/settings/3", {"dayStart": "08:00", "cards": ["sleep"]})
        self.assertEqual(status, 200)
        self.assertEqual(self.call("GET", "/settings/3")[1], {"dayStart": "08:00", "cards": ["sleep"]})
        # Keys in the body replace, keys left out are kept (a partial PUT never erases what it did not send).
        self.call("PUT", "/settings/3", {"dayStart": "07:00"})
        self.assertEqual(self.call("GET", "/settings/3")[1], {"dayStart": "07:00", "cards": ["sleep"]})

    # ---- contractions
    def test_contractions_crud(self):
        status, row = self.call("POST", "/contractions", {"child": 1, "start": "2026-09-01T10:00:00+00:00", "intensity": 4})
        self.assertEqual(status, 201)
        self.assertIsNone(row["end"])
        self.assertEqual(row["intensity"], 4)
        status, patched = self.call("PATCH", f"/contractions/{row['id']}", {"end": "2026-09-01T10:01:00+00:00"})
        self.assertEqual(status, 200)
        self.assertEqual(patched["end"], "2026-09-01T10:01:00+00:00")
        self.call("POST", "/contractions", {"child": 1, "start": "2026-09-01T10:05:00+00:00"})
        status, rows = self.call("GET", "/contractions?child=1")
        self.assertEqual([r["start"] for r in rows], ["2026-09-01T10:05:00+00:00", "2026-09-01T10:00:00+00:00"])
        self.assertEqual(len(self.call("GET", "/contractions?child=1&since=2026-09-01T10:03:00")[1]), 1)
        self.assertEqual(self.call("GET", "/contractions?child=2")[1], [])
        self.assertEqual(self.call("DELETE", f"/contractions/{row['id']}")[0], 204)
        self.assertEqual(self.call("DELETE", f"/contractions/{row['id']}")[0], 404)
        self.assertEqual(self.call("POST", "/contractions", {"child": 1})[0], 400)

    def test_activities_crud(self):
        status, row = self.call("POST", "/activities", {"child": 1, "type": "bath", "start": "2026-09-01T18:00:00+00:00"})
        self.assertEqual(status, 201)
        self.assertEqual(row["type"], "bath")
        self.assertEqual(self.call("GET", "/activities?child=1")[1][0]["id"], row["id"])

    def test_activities_carry_who_logged_them(self):
        status, row = self.call("POST", "/activities", {"child": 1, "type": "bath", "start": "2026-09-01T18:00:00+00:00", "tags": ["caregiver:sara"]})
        self.assertEqual(status, 201)
        self.assertEqual(row["tags"], ["caregiver:sara"])
        # A patch without tags keeps them; an untagged row reads as an empty list, never null.
        self.assertEqual(self.call("PATCH", f"/activities/{row['id']}", {"notes": "warm"})[1]["tags"], ["caregiver:sara"])
        self.assertEqual(self.call("POST", "/activities", {"child": 1, "type": "story", "start": "2026-09-01T19:00:00+00:00"})[1]["tags"], [])
        self.assertEqual(self.call("POST", "/activities", {"child": 1, "type": "bath", "start": "2026-09-01T18:00:00+00:00", "tags": "caregiver:sara"})[0], 400)
        self.assertEqual(self.call("POST", "/activities", {"child": 1, "type": "bath", "start": "2026-09-01T18:00:00+00:00", "tags": [1]})[0], 400)

    def test_activities_table_gains_its_tags_column_in_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "old.db")
            old = sqlite3.connect(path)
            old.execute('CREATE TABLE activities (id INTEGER PRIMARY KEY AUTOINCREMENT, child INTEGER NOT NULL, type TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT, notes TEXT NOT NULL DEFAULT \'\')')
            old.execute("INSERT INTO activities (child, type, start) VALUES (1, 'bath', '2026-09-01T18:00:00+00:00')")
            old.commit()
            old.close()
            store = bs.Store(path)
            self.assertEqual(store.list_rows("activities", 1, None)[0]["tags"], [])
            store.conn.close()

    def test_milestones_crud(self):
        s1, a = self.call("POST", "/milestones", {"child": 1, "title": "First smile", "date": "2026-07-01", "category": "social"})
        s2, b = self.call("POST", "/milestones", {"child": 1, "title": "Rolled over", "date": "2026-08-15"})
        self.assertEqual((s1, s2), (201, 201))
        rows = self.call("GET", "/milestones?child=1")[1]
        self.assertEqual([r["title"] for r in rows], ["Rolled over", "First smile"])
        self.assertEqual(self.call("PATCH", f"/milestones/{a['id']}", {"notes": "at grandma's"})[1]["notes"], "at grandma's")
        self.assertEqual(self.call("DELETE", f"/milestones/{b['id']}")[0], 204)
        self.assertEqual(len(self.call("GET", "/milestones?child=1")[1]), 1)

    # ---- reminders
    def test_reminders_create_list_delete(self):
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(timespec="seconds")
        status, row = self.call("POST", "/reminders", {"child": 1, "at": future, "title": "Bottle", "body": "Time for a bottle", "tag": "bottle"})
        self.assertEqual(status, 201)
        self.assertFalse(row["sent"])
        rows = self.call("GET", "/reminders?child=1")[1]
        self.assertEqual([r["title"] for r in rows], ["Bottle"])
        self.assertEqual(self.call("POST", "/reminders", {"child": 1, "title": "x"})[0], 400)
        self.assertEqual(self.call("POST", "/reminders", {"child": 1, "title": "x", "at": "garbage"})[0], 400)
        self.assertEqual(self.call("DELETE", f"/reminders/{row['id']}")[0], 204)
        self.assertEqual(self.call("GET", "/reminders?child=1")[1], [])
        # timestamps are stored in canonical UTC so SQL string comparison is chronological
        status, row2 = self.call("POST", "/reminders", {"child": 1, "at": "2030-01-01T10:00:00.000Z", "title": "Z form"})
        self.assertEqual(row2["at"], "2030-01-01T10:00:00+00:00")
        status, row3 = self.call("POST", "/reminders", {"child": 1, "at": "2030-01-01T06:00:00-04:00", "title": "Offset form"})
        self.assertEqual(row3["at"], "2030-01-01T10:00:00+00:00")

    def test_reminder_with_negative_offset_is_not_delivered_early(self):
        self.subscribe("https://push/x", child=1)
        # 3 h in the future, written with a -04:00 offset: lexically "smaller" than a +00:00 now.
        local = (datetime.now(timezone.utc) + timedelta(hours=3)).astimezone(timezone(timedelta(hours=-4))).isoformat(timespec="seconds")
        self.call("POST", "/reminders", {"child": 1, "at": local, "title": "Later", "tag": "t"})
        self.assertEqual(self.delivery.run_once(), 0)
        self.assertEqual(self.sent, [])

    def test_schedule_skips_auto_alert_already_sent(self):
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(timespec="seconds")
        self.subscribe("https://push/x", child=1)
        self.call("POST", "/push/schedule", {"child": 1, "items": [{"tag": "sweetspot:now", "at": past, "title": "Now"}]})
        self.assertEqual(self.delivery.run_once(), 1)
        self.assertEqual(len(self.sent), 1)
        # app reopened inside the window: same item re-scheduled → no second push
        status, body = self.call("POST", "/push/schedule", {"child": 1, "items": [{"tag": "sweetspot:now", "at": past, "title": "Now"}]})
        self.assertEqual(body["scheduled"], [])
        self.assertEqual(self.delivery.run_once(), 0)
        self.assertEqual(len(self.sent), 1)

    def test_schedule_arriving_while_an_alert_is_being_sent_does_not_send_it_twice(self):
        """Two phones: one is delivered the nap window alert while the other re-posts the same schedule.
        The delivery loop must claim the reminder before the schedule's DELETE can take it away, or the
        same alert (same child, tag and time) is inserted again as unsent and goes out a second time."""
        self.subscribe("https://push/x", child=1)
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(timespec="seconds")
        items = [{"tag": "sweetspot:now", "at": past, "title": "Now"}]
        self.call("POST", "/push/schedule", {"child": 1, "items": items})
        orig = bs.send_push

        def send_then_reschedule(sub, payload, vapid):
            orig(sub, payload, vapid)
            self.call("POST", "/push/schedule", {"child": 1, "items": items})  # the other phone, mid-send

        bs.send_push = send_then_reschedule
        self.assertEqual(self.delivery.run_once(), 1)
        bs.send_push = orig
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.delivery.run_once(), 0)  # the re-posted copy must not be a second unsent alert
        self.assertEqual(len(self.sent), 1)

    # ---- milk stash
    def test_milk_bag_create_reuses_pumping_and_schedules_expiry_reminders(self):
        pumped = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds")
        status, bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 118.3, "pumping_id": 77})
        self.assertEqual(status, 201)
        self.assertEqual(bag["status"], "stored")
        self.assertEqual(bag["location"], "fridge")
        self.assertEqual(len(bag["code"]), 6)
        self.assertNotRegex(bag["code"], "[01OI]")
        # fridge: 4 days from pumping
        self.assertAlmostEqual((bs.parse_iso(bag["expires_at"]) - bs.parse_iso(pumped)).total_seconds(), 4 * 86400, delta=2)
        # a second label for the same pumping session returns the same bag
        status2, again = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 118.3, "pumping_id": 77})
        self.assertEqual((status2, again["id"]), (201, bag["id"]))
        self.assertEqual(len(self.call("GET", "/milk?child=1")[1]), 1)
        # two reminders: expiring soon (12 h before) and expired
        rems = [r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"]
        self.assertEqual([r["title"].split(" · ")[0] for r in rems], ["Milk expiring soon", "Milk expired"])
        self.assertIn(bag["code"], rems[0]["title"])
        self.assertAlmostEqual((bs.parse_iso(rems[1]["at"]) - bs.parse_iso(rems[0]["at"])).total_seconds(), 12 * 3600, delta=2)
        self.assertIn("118 mL (4.0 oz)", rems[0]["title"])
        # lookup by code (case-insensitive) and 404 for unknown
        self.assertEqual(self.call("GET", f"/milk/code/{bag['code'].lower()}")[1]["id"], bag["id"])
        self.assertEqual(self.call("GET", "/milk/code/ZZZZZZ")[0], 404)
        # validation
        self.assertEqual(self.call("POST", "/milk", {"child": 1, "pumped_at": pumped})[0], 400)
        self.assertEqual(self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": -5})[0], 400)
        self.assertEqual(self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 50, "location": "car"})[0], 400)

    def test_milk_kept_out_gets_a_fridge_by_push_and_moving_it_replaces_it(self):
        pumped = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(timespec="seconds")
        bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60, "location": "room", "pumping_id": 91})[1]
        self.assertAlmostEqual((bs.parse_iso(bag["expires_at"]) - bs.parse_iso(pumped)).total_seconds(), 4 * 3600, delta=2)
        rems = [r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"]
        self.assertEqual([r["title"].split(" by ")[0].split(" · ")[0] for r in rems], ["Fridge the milk", "Milk out too long"])
        self.assertIn(bag["code"], rems[0]["title"])
        self.assertIn("keeps 4 hours out", rems[0]["body"])
        self.assertIn("Move to fridge", rems[0]["body"])
        # an hour before the 4 hours are up
        self.assertAlmostEqual((bs.parse_iso(rems[1]["at"]) - bs.parse_iso(rems[0]["at"])).total_seconds(), 3600, delta=2)
        # into the fridge: counted from the pump (4 days), the room pushes are replaced by the fridge ones
        moved = self.call("PATCH", f"/milk/{bag['id']}", {"location": "fridge"})[1]
        self.assertAlmostEqual((bs.parse_iso(moved["expires_at"]) - bs.parse_iso(pumped)).total_seconds(), 4 * 86400, delta=2)
        rems = [r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"]
        self.assertEqual([r["title"].split(" · ")[0] for r in rems], ["Milk expiring soon", "Milk expired"])

    def test_milk_moved_out_a_day_after_pumping_is_counted_from_the_move_in_its_reminder(self):
        # Sweep 2026-10-27: "Out at room temperature since it was pumped (Mon 12:08 PM). Fresh milk keeps 30 hours out".
        pumped = (datetime.now(timezone.utc) - timedelta(hours=26)).isoformat(timespec="seconds")
        bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60, "location": "fridge", "pumping_id": 93})[1]
        out = self.call("PATCH", f"/milk/{bag['id']}", {"location": "room"})[1]
        self.assertTrue(out["out_at"])
        rems = [r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"]
        self.assertIn("keeps 4 hours out", rems[0]["body"])
        self.assertNotIn("since it was pumped", rems[0]["body"])
        self.assertIn("past 4 hours", rems[1]["body"])

    def test_a_push_tag_is_per_child_and_per_ping(self):
        # The phone keeps one notification per tag: twins' feed nudges and a burst of pings must not replace each other.
        self.app.store.x("INSERT INTO subscriptions (endpoint, user_id, child, p256dh, auth, created) VALUES ('https://push.example/tag', 1, 1, 'k', 'a', ?)", (bs.now_iso(),))
        sent = []
        orig, bs.send_push = bs.send_push, lambda sub, payload, vapid: sent.append(payload["tag"]) if sub["endpoint"] == "https://push.example/tag" else None
        try:
            for child, tag, anchor in ((1, "nudge:feed", "5"), (2, "nudge:feed", "6"), (1, "nudge:activity", "pumping:9:7"), (1, "nudge:activity", "pumping:10:7")):
                self.delivery._deliver({"title": "t", "body": "b", "tag": tag, "child": child, "anchor": anchor, "source": "other", "user_id": 1})
        finally:
            bs.send_push = orig
            self.app.store.x("DELETE FROM subscriptions WHERE endpoint='https://push.example/tag'")
        self.assertEqual(sent, ["nudge:feed:1", "nudge:feed:2", "nudge:activity:pumping:9:7", "nudge:activity:pumping:10:7"])

    def test_a_move_never_brings_expired_milk_back_but_a_move_dated_in_time_does(self):
        # Pumped 4 h 15 min ago and left out: the room window (4 h) ended 15 min ago.
        pumped_dt = datetime.now(timezone.utc) - timedelta(hours=4, minutes=15)
        pumped = pumped_dt.isoformat(timespec="seconds")
        bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60, "location": "room", "pumping_id": 92})[1]
        # Moving it now would re-date it from the pump (4 days in the fridge): refused, with the deadline named.
        code, body = self.call("PATCH", f"/milk/{bag['id']}", {"location": "fridge"})
        self.assertEqual(code, 400)
        self.assertIn("thrown away", body["detail"])
        # Nor with a time after the window ended, nor one in the future.
        late = (pumped_dt + timedelta(hours=4, minutes=5)).isoformat(timespec="seconds")
        self.assertEqual(self.call("PATCH", f"/milk/{bag['id']}", {"location": "fridge", "moved_at": late})[0], 400)
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(timespec="seconds")
        self.assertEqual(self.call("PATCH", f"/milk/{bag['id']}", {"location": "fridge", "moved_at": future})[0], 400)
        self.assertEqual(self.call("GET", f"/milk/{bag['id']}")[1]["location"], "room")
        # It went in the fridge 3 h 50 min after pumping: in time. Counted from the pump, 4 days; the time is on record.
        in_time = (pumped_dt + timedelta(hours=3, minutes=50)).isoformat(timespec="seconds")
        moved = self.call("PATCH", f"/milk/{bag['id']}", {"location": "fridge", "moved_at": in_time})[1]
        self.assertEqual(moved["location"], "fridge")
        self.assertAlmostEqual((bs.parse_iso(moved["expires_at"]) - pumped_dt).total_seconds(), 4 * 86400, delta=2)
        self.assertIn("In the fridge from", moved["notes"])
        self.assertIn("set by hand", moved["notes"])
        rems = [r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"]
        self.assertEqual([r["title"].split(" · ")[0] for r in rems], ["Milk expiring soon", "Milk expired"])
        # A fridge bag past its 4 days cannot be frozen to 6 months either.
        old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(timespec="seconds")
        stale = self.call("POST", "/milk", {"child": 1, "pumped_at": old, "volume_ml": 50, "location": "fridge", "client_key": "stale-fridge"})[1]
        self.assertEqual(self.call("PATCH", f"/milk/{stale['id']}", {"location": "freezer"})[0], 400)

    def test_milk_bag_move_thaw_use_and_discard(self):
        pumped = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 90})[1]
        # into the freezer: ~6 months from pumping
        frozen = self.call("PATCH", f"/milk/{bag['id']}", {"location": "freezer"})[1]
        self.assertEqual(frozen["location"], "freezer")
        self.assertGreater((bs.parse_iso(frozen["expires_at"]) - bs.parse_iso(pumped)).days, 150)
        rems = [r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"]
        self.assertEqual(len(rems), 2)  # replaced, not duplicated
        # back to the fridge = thawed: 24 h from now, never refreeze
        thawed = self.call("PATCH", f"/milk/{bag['id']}", {"location": "fridge"})[1]
        self.assertTrue(thawed["thawed"])
        self.assertAlmostEqual((bs.parse_iso(thawed["expires_at"]) - datetime.now(timezone.utc)).total_seconds(), 24 * 3600, delta=60)
        self.assertEqual(self.call("PATCH", f"/milk/{bag['id']}", {"location": "freezer"})[0], 400)
        # the thaw clock is stored, so moving a thawed bag to the counter keeps the original thaw time:
        # 2 h from the thaw, not 2 h from now, and an expires_at in the body is ignored
        counter = self.call("PATCH", f"/milk/{bag['id']}", {"location": "room", "expires_at": "2030-01-01T00:00:00+00:00"})[1]
        self.assertEqual(counter["thawed_at"], thawed["thawed_at"])
        self.assertAlmostEqual((bs.parse_iso(counter["expires_at"]) - bs.parse_iso(thawed["thawed_at"])).total_seconds(), 2 * 3600, delta=2)
        # used for a bottle: linked to the feeding, reminders gone
        used = self.call("PATCH", f"/milk/{bag['id']}", {"status": "used", "feeding_id": 501})[1]
        self.assertEqual((used["status"], used["feeding_id"]), ("used", 501))
        self.assertIsNotNone(used["used_at"])
        self.assertEqual([r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"], [])
        self.assertEqual(self.call("GET", "/milk?child=1&status=stored")[1], [])
        self.assertEqual(len(self.call("GET", "/milk?child=1&status=used")[1]), 1)
        # a bag labelled before its pumping entry existed gets linked afterwards
        linked = self.call("PATCH", f"/milk/{bag['id']}", {"pumping_id": 88})[1]
        self.assertEqual(linked["pumping_id"], 88)
        # discard another bag, then delete it outright
        other = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60})[1]
        self.assertEqual(self.call("PATCH", f"/milk/{other['id']}", {"status": "discarded"})[1]["status"], "discarded")
        self.assertEqual(self.call("DELETE", f"/milk/{other['id']}")[0], 204)
        self.assertEqual(self.call("GET", f"/milk/{other['id']}")[0], 404)

    def test_frozen_bag_cannot_be_marked_thawed_in_place(self):
        pumped = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 90, "location": "freezer"})[1]
        status, body = self.call("PATCH", f"/milk/{bag['id']}", {"thawed": True})
        self.assertEqual(status, 400)
        same = self.call("GET", f"/milk/{bag['id']}")[1]
        self.assertFalse(same["thawed"])
        self.assertEqual(same["expires_at"], bag["expires_at"])

    # ---- milk that already exists (added from the Stash tab, no pumping entry) -------------------------
    def _milk_reminders(self, bag):
        return [r for r in self.call("GET", "/reminders?child=1")[1] if r["tag"] == f"milk:{bag['id']}"]

    def test_stored_milk_expiry_counts_from_the_real_pumped_time(self):
        now = datetime.now(timezone.utc)
        pumped = (now - timedelta(days=3)).isoformat(timespec="seconds")
        status, bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60, "location": "fridge", "client_key": "bottle-one-0001"})
        self.assertEqual(status, 201)
        self.assertEqual((bag["status"], bag["location"], bag["thawed"], bag["pumping_id"]), ("stored", "fridge", False, None))
        self.assertEqual(bs.parse_iso(bag["pumped_at"]), bs.parse_iso(pumped))
        # four-day fridge window, three days already gone: one day left, not four
        self.assertAlmostEqual((bs.parse_iso(bag["expires_at"]) - bs.parse_iso(pumped)).total_seconds(), 4 * 86400, delta=2)
        self.assertAlmostEqual((bs.parse_iso(bag["expires_at"]) - now).total_seconds(), 86400, delta=5)
        # both reminders are still ahead: "expiring soon" in 12 h, "expired" in 24 h
        rems = self._milk_reminders(bag)
        self.assertEqual([r["title"].split(" · ")[0] for r in rems], ["Milk expiring soon", "Milk expired"])
        self.assertAlmostEqual((bs.parse_iso(rems[0]["at"]) - now).total_seconds(), 12 * 3600, delta=5)
        self.assertAlmostEqual((bs.parse_iso(rems[1]["at"]) - now).total_seconds(), 24 * 3600, delta=5)
        # the household's own window from label settings is what counts, not a hardcoded four days
        five = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60, "client_key": "bottle-two-0002", "windows": {"fridgeDays": 5}})[1]
        self.assertAlmostEqual((bs.parse_iso(five["expires_at"]) - now).total_seconds(), 2 * 86400, delta=5)
        # frozen two months ago: about four months left of six
        frozen_at = (now - timedelta(days=60)).isoformat(timespec="seconds")
        frozen = self.call("POST", "/milk", {"child": 1, "pumped_at": frozen_at, "volume_ml": 90, "location": "freezer", "client_key": "bottle-three-03"})[1]
        self.assertEqual(frozen["location"], "freezer")
        self.assertAlmostEqual((bs.parse_iso(frozen["expires_at"]) - now).days, 183 - 60, delta=1)

    def test_stored_milk_entered_late_gets_no_stale_reminders(self):
        self.subscribe("https://push/child1", child=1)
        now = datetime.now(timezone.utc)
        # four hours left in the fridge: the "expiring soon" moment (12 h before) passed eight hours ago
        pumped = (now - timedelta(days=3, hours=20)).isoformat(timespec="seconds")
        bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 45, "client_key": "late-bottle-001"})[1]
        rems = self._milk_reminders(bag)
        self.assertEqual([r["title"].split(" · ")[0] for r in rems], ["Milk expired"])
        self.assertAlmostEqual((bs.parse_iso(rems[0]["at"]) - now).total_seconds(), 4 * 3600, delta=5)
        self.assertTrue(all(bs.parse_iso(r["at"]) > now for r in rems))
        # nothing is due, so nothing is pushed at entry
        self.assertEqual(self.delivery.run_once(), 0)
        self.assertEqual(self.sent, [])

    def test_stored_milk_already_past_its_window_is_kept_as_expired_without_reminders(self):
        self.subscribe("https://push/child1", child=1)
        now = datetime.now(timezone.utc)
        pumped = (now - timedelta(days=5)).isoformat(timespec="seconds")
        status, bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 80, "location": "fridge", "client_key": "old-bottle-0001"})
        # accepted (the caregiver decides what to do with it) but never as fresh: it expired a day ago
        self.assertEqual(status, 201)
        self.assertEqual(bag["status"], "stored")
        self.assertAlmostEqual((now - bs.parse_iso(bag["expires_at"])).total_seconds(), 86400, delta=5)
        self.assertEqual(self._milk_reminders(bag), [])
        self.assertEqual(self.delivery.run_once(), 0)
        self.assertEqual(self.sent, [])
        # it is listed with its real expiry, and discarding or restoring it still schedules nothing in the past
        self.assertEqual(self.call("GET", "/milk?child=1&status=stored")[1][0]["expires_at"], bag["expires_at"])
        self.call("PATCH", f"/milk/{bag['id']}", {"status": "discarded"})
        restored = self.call("PATCH", f"/milk/{bag['id']}", {"status": "stored"})[1]
        self.assertEqual(restored["expires_at"], bag["expires_at"])
        self.assertEqual(self._milk_reminders(bag), [])

    def test_stored_milk_is_one_bag_per_client_key_and_identical_bottles_are_separate_bags(self):
        pumped = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        body = {"child": 1, "pumped_at": pumped, "volume_ml": 60, "location": "fridge", "client_key": "3f9a1c0e5b7d4a2f"}
        first = self.call("POST", "/milk", body)[1]
        # retry, double tap, reopened sheet: the same key is the same container
        status, again = self.call("POST", "/milk", body)
        self.assertEqual((status, again["id"], again["code"]), (201, first["id"], first["code"]))
        self.assertEqual(len(self.call("GET", "/milk?child=1")[1]), 1)
        self.assertEqual(len(self._milk_reminders(first)), 2)  # not doubled by the replay
        # a replay that arrives with different numbers still does not make a second bag
        self.assertEqual(self.call("POST", "/milk", {**body, "volume_ml": 75})[1]["id"], first["id"])
        self.assertEqual(self.call("GET", f"/milk/{first['id']}")[1]["volume_ml"], 60)
        # a second bottle with the same volume and the same time is its own bag with its own code
        twin = self.call("POST", "/milk", {**body, "client_key": "8c2e6d4b1a9f7053"})[1]
        self.assertNotEqual(twin["id"], first["id"])
        self.assertNotEqual(twin["code"], first["code"])
        self.assertEqual((twin["volume_ml"], twin["pumped_at"], twin["expires_at"]), (first["volume_ml"], first["pumped_at"], first["expires_at"]))
        self.assertEqual(len(self.call("GET", "/milk?child=1")[1]), 2)
        # keys belong to a child: the same key under another child is another bag
        self.assertNotEqual(self.call("POST", "/milk", {**body, "child": 2})[1]["id"], first["id"])
        # a key and a pumping entry can travel together; the pumping entry still wins on a reprint
        linked = self.call("POST", "/milk", {**body, "client_key": "aaaaaaaa11111111", "pumping_id": 91})[1]
        self.assertEqual(self.call("POST", "/milk", {**body, "client_key": "bbbbbbbb22222222", "pumping_id": 91})[1]["id"], linked["id"])
        # the key is opaque but must look like one
        for bad in ("short", "x" * 65, "has spaces in it", "semi;colon;key"):
            self.assertEqual(self.call("POST", "/milk", {**body, "client_key": bad})[0], 400, bad)
        # the key is not part of what the phone gets back
        self.assertNotIn("client_key", first)

    def test_stored_milk_that_was_thawed_needs_a_real_thaw_time(self):
        now = datetime.now(timezone.utc)
        pumped = (now - timedelta(days=30)).isoformat(timespec="seconds")
        thawed_at = (now - timedelta(hours=6)).isoformat(timespec="seconds")
        base = {"child": 1, "pumped_at": pumped, "volume_ml": 70, "location": "fridge", "thawed": True}
        # no thaw time: refused, never assumed to be "now"
        status, body = self.call("POST", "/milk", {**base, "client_key": "thawed-none-001"})
        self.assertEqual((status, body["detail"]), (400, "missing: thawed_at"))
        # thawed milk is never frozen again
        status, body = self.call("POST", "/milk", {**base, "location": "freezer", "thawed_at": thawed_at, "client_key": "thawed-frz-0001"})
        self.assertEqual((status, body["detail"]), (400, "Thawed milk cannot go back in the freezer."))
        # a thaw before the milk existed, or one that has not happened yet
        before = (now - timedelta(days=31)).isoformat(timespec="seconds")
        ahead = (now + timedelta(hours=1)).isoformat(timespec="seconds")
        for wrong in (before, ahead):
            status, body = self.call("POST", "/milk", {**base, "thawed_at": wrong, "client_key": "thawed-bad-0001"})
            self.assertEqual(status, 400)
            self.assertIn("thaw time", body["detail"])
        self.assertEqual(self.call("GET", "/milk?child=1")[1], [])
        # thawed six hours ago, in the fridge: 24 h from the thaw, so 18 h left
        status, bag = self.call("POST", "/milk", {**base, "thawed_at": thawed_at, "client_key": "thawed-ok-00001"})
        self.assertEqual(status, 201)
        self.assertTrue(bag["thawed"])
        self.assertEqual(bs.parse_iso(bag["thawed_at"]), bs.parse_iso(thawed_at))
        self.assertAlmostEqual((bs.parse_iso(bag["expires_at"]) - bs.parse_iso(thawed_at)).total_seconds(), 24 * 3600, delta=2)
        self.assertAlmostEqual((bs.parse_iso(bag["expires_at"]) - now).total_seconds(), 18 * 3600, delta=5)
        # moving it to the counter keeps the thaw clock that was entered; its room hours count from the move (thawed
        # milk keeps 1–2 h once out at room temperature), never past the fridge's 24 h from the thaw
        counter = self.call("PATCH", f"/milk/{bag['id']}", {"location": "room"})[1]
        self.assertEqual(counter["thawed_at"], bag["thawed_at"])
        left = bs.parse_iso(counter["expires_at"]) - now
        self.assertTrue(timedelta(hours=1) < left <= timedelta(hours=2, minutes=1), left)
        # thawed and out on the counter for an hour: one hour left of two
        hour_ago = (now - timedelta(hours=1)).isoformat(timespec="seconds")
        room = self.call("POST", "/milk", {**base, "location": "room", "thawed_at": hour_ago, "client_key": "thawed-room-001"})[1]
        self.assertAlmostEqual((bs.parse_iso(room["expires_at"]) - now).total_seconds(), 3600, delta=5)
        # milk that was not thawed ignores a stray thaw time
        fresh = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 70, "location": "freezer", "thawed_at": thawed_at, "client_key": "fresh-frozen-01"})[1]
        self.assertEqual((fresh["thawed"], fresh["thawed_at"]), (False, None))

    def test_pumped_time_in_the_future_is_refused(self):
        ahead = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(timespec="seconds")
        status, body = self.call("POST", "/milk", {"child": 1, "pumped_at": ahead, "volume_ml": 60, "client_key": "future-bottle-1"})
        self.assertEqual((status, body["detail"]), (400, "The pumped time cannot be in the future."))
        # a phone clock a minute ahead of the server is not a mistake
        nearly = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat(timespec="seconds")
        status, bag = self.call("POST", "/milk", {"child": 1, "pumped_at": nearly, "volume_ml": 60, "client_key": "skewed-bottle-1"})
        self.assertEqual(status, 201)
        # the same rule on an edit: a future pumped time would push the expiry (and its reminders) into the future too
        status, body = self.call("PATCH", f"/milk/{bag['id']}", {"pumped_at": ahead})
        self.assertEqual((status, body["detail"]), (400, "The pumped time cannot be in the future."))
        same = self.call("GET", f"/milk/{bag['id']}")[1]
        self.assertEqual((same["pumped_at"], same["expires_at"]), (bag["pumped_at"], bag["expires_at"]))
        # a thawed bag cannot be told it was pumped after it thawed
        thawed_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
        old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat(timespec="seconds")
        thawed = self.call("POST", "/milk", {"child": 1, "pumped_at": old, "volume_ml": 60, "thawed": True, "thawed_at": thawed_at, "client_key": "thawed-edit-0001"})[1]
        status, body = self.call("PATCH", f"/milk/{thawed['id']}", {"pumped_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds")})
        self.assertEqual(status, 400)
        self.assertIn("thaw time", body["detail"])

    # ---- partial bags: a bottle takes some of a bag and the rest stays in the stash -----------------------
    def _bag(self, ml=120, **extra):
        pumped = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
        status, bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": ml, **extra})
        self.assertEqual(status, 201)
        return bag

    def test_a_bottle_takes_part_of_a_bag_and_the_balance_stays_in_the_stash(self):
        bag = self._bag(120)
        self.assertEqual((bag["volume_ml"], bag["remaining_ml"], bag["uses"]), (120, 120, []))
        # a 40 mL bottle from a 120 mL bag: 80 left, same bag, same code, same expiry, still stored
        status, after = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 40, "feeding_id": 21})
        self.assertEqual(status, 200)
        self.assertEqual((after["status"], after["volume_ml"], after["remaining_ml"], after["code"], after["expires_at"]), ("stored", 120, 80, bag["code"], bag["expires_at"]))
        self.assertEqual(after["feeding_id"], 21)
        self.assertIsNone(after["used_at"])
        self.assertEqual([(u["feeding_id"], u["amount_ml"], u["kind"], u["by_user"]) for u in after["uses"]], [(21, 40, "bottle", 7)])
        self.assertEqual(self.call("GET", "/milk?child=1&status=stored")[1][0]["remaining_ml"], 80)
        # the feeding knows which bag it came from
        status, link = self.call("GET", "/milk/feeding/21")
        self.assertEqual((status, link["bag"]["id"], link["use"]["amount_ml"]), (200, bag["id"], 40))
        self.assertEqual(self.call("GET", "/milk/feeding/999")[1], {"bag": None, "use": None, "takes": [], "total_ml": 0})
        # saving the same feeding again (retry, lost response) does not take another 40
        again = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 40, "feeding_id": 21})[1]
        self.assertEqual((again["remaining_ml"], len(again["uses"])), (80, 1))
        # reminders are untouched by a partial use except for the volume in their title
        rems = self._milk_reminders(bag)
        self.assertEqual([r["title"].split(" · ")[0] for r in rems], ["Milk expiring soon", "Milk expired"])
        self.assertIn("80 mL", rems[0]["title"])
        self.assertEqual(bs.parse_iso(rems[1]["at"]), bs.parse_iso(bag["expires_at"]))
        # a second bottle takes from the same bag
        second = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 30, "feeding_id": 22})[1]
        self.assertEqual((second["remaining_ml"], second["feeding_id"], len(second["uses"])), (50, 22, 2))
        # editing the first feeding's amount adjusts its use, up or down
        edited = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 60, "feeding_id": 21})[1]
        self.assertEqual((edited["remaining_ml"], [u["amount_ml"] for u in edited["uses"]]), (30, [60, 30]))
        edited = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 50, "feeding_id": 21})[1]
        self.assertEqual(edited["remaining_ml"], 40)
        # more than what is left is refused in plain words, and nothing changes
        status, body = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 55, "feeding_id": 23})
        self.assertEqual(status, 400)
        self.assertEqual(body["detail"], f"Only 40 mL (1.4 oz) is left in bag {bag['code']}.")
        self.assertEqual(self.call("GET", f"/milk/{bag['id']}")[1]["remaining_ml"], 40)
        self.assertEqual(self.call("GET", "/milk/feeding/23")[1]["bag"], None)
        # bad amounts
        for bad in (-1, "x", None):
            self.assertEqual(self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": bad, "feeding_id": 23})[0], 400, bad)
        self.assertEqual(self.call("POST", "/milk/9999/use", {"amount_ml": 5})[0], 404)
        # the balance reaching zero (under 1 mL counts as zero) takes the bag out of the stash as used
        used = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 39.5, "feeding_id": 23})[1]
        self.assertEqual((used["status"], used["remaining_ml"], used["feeding_id"]), ("used", 0, 23))
        self.assertIsNotNone(used["used_at"])
        self.assertEqual(used["used_by"], 7)
        self.assertEqual(self._milk_reminders(bag), [])
        self.assertEqual(self.call("GET", "/milk?child=1&status=stored")[1], [])
        # nothing more can be taken from a used-up bag, but the feeding that emptied it can still be corrected
        status, body = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 5, "feeding_id": 24})
        self.assertEqual((status, body["detail"]), (400, f"Bag {bag['code']} is already used up."))
        back = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 20, "feeding_id": 23})[1]
        self.assertEqual((back["status"], back["remaining_ml"]), ("stored", 19.5))
        self.assertEqual(len(self._milk_reminders(bag)), 2)
        # a feeding deleted on the phone gives its milk back (amount 0 removes the use)
        gone = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 0, "feeding_id": 23})[1]
        self.assertEqual((gone["remaining_ml"], [u["feeding_id"] for u in gone["uses"]], gone["feeding_id"]), (39.5, [21, 22], 22))
        self.assertEqual(self.call("GET", "/milk/feeding/23")[1]["bag"], None)
        # a hair over what is left (display rounding, oz to mL) is capped at the balance, not refused
        capped = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 41, "feeding_id": 25})[1]
        self.assertEqual((capped["status"], capped["remaining_ml"], capped["uses"][-1]["amount_ml"]), ("used", 0, 39.5))

    def test_a_corrected_volume_moves_the_bag_in_or_out_of_the_stash(self):
        # 100 mL bag used whole; the label said 120: the 20 mL difference is back in the stash
        bag = self._bag(100)
        self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 100, "feeding_id": 41})
        status, fixed = self.call("PATCH", f"/milk/{bag['id']}", {"volume_ml": 120})
        self.assertEqual(status, 200)
        self.assertEqual((fixed["status"], fixed["volume_ml"], fixed["remaining_ml"], fixed["used_at"]), ("stored", 120, 20, None))
        self.assertEqual([u["feeding_id"] for u in fixed["uses"]], [41])  # no use row: nothing was poured
        self.assertEqual(self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 20, "feeding_id": 42})[0], 200)
        # 120 mL bag with 100 taken; the label really said 100: it is used up, out of the stash, no reminders
        bag = self._bag(120)
        self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 100, "feeding_id": 43})
        status, fixed = self.call("PATCH", f"/milk/{bag['id']}", {"volume_ml": 100})
        self.assertEqual((status, fixed["status"], fixed["remaining_ml"]), (200, "used", 0))
        self.assertIsNotNone(fixed["used_at"])
        self.assertEqual(self._milk_reminders(fixed), [])
        self.assertNotIn(bag["id"], [b["id"] for b in self.call("GET", "/milk?child=1&status=stored")[1]])

    def test_marking_a_bag_used_for_a_feeding_takes_that_feeding_off_its_old_bag(self):
        first, second = self._bag(100), self._bag(50)
        self.call("POST", f"/milk/{first['id']}/use", {"amount_ml": 100, "feeding_id": 51})
        status, scanned = self.call("PATCH", f"/milk/{second['id']}", {"status": "used", "feeding_id": 51})
        self.assertEqual((status, scanned["status"], scanned["feeding_id"]), (200, "used", 51))
        back = self.call("GET", f"/milk/{first['id']}")[1]
        self.assertEqual((back["status"], back["remaining_ml"], back["feeding_id"], back["uses"]), ("stored", 100, None, []))
        self.assertEqual(self.call("GET", "/milk/feeding/51")[1]["bag"]["id"], second["id"])

    def test_odd_input_is_a_400_not_an_internal_error(self):
        bag = self._bag(100)
        for method, path, body in [
            ("GET", "/milk/99999999999999999999", None),
            ("POST", "/milk/99999999999999999999/use", {"amount_ml": 10, "feeding_id": 1}),
            ("POST", "/push/subscribe", {"subscription": "x", "child": 1}),
            ("POST", "/push/schedule", {"child": 1, "items": ["x"]}),
            ("POST", "/milk", {"child": 1, "pumped_at": bag["pumped_at"], "volume_ml": 50, "windows": {"roomHours": 1e300}}),
            ("POST", "/milk", {"child": 1, "pumped_at": bag["pumped_at"], "volume_ml": 50, "windows": {"fridgeDays": "inf"}}),
            ("POST", "/reminders", {"child": 1, "at": "9999-12-31T23:00:00-05:00", "title": "x"}),
            ("POST", "/activities", {"child": 1, "type": "bath", "start": "garbage"}),
            ("POST", "/milestones", {"child": 1, "title": "x", "date": "not-a-date"}),
            ("POST", f"/milk/{bag['id']}/use", {"amount_ml": True, "feeding_id": 1}),
            ("PATCH", f"/milk/{bag['id']}", {"thawed": "false"}),
        ]:
            status, body = self.call(method, path, body)
            self.assertIn(status, (400, 404), (method, path, body))
        # a pumping session already on another bag
        other = self._bag(60, pumping_id=777)
        status, body = self.call("PATCH", f"/milk/{bag['id']}", {"pumping_id": 777})
        self.assertEqual(status, 400)
        self.assertIn(other["code"], body["detail"])

    def test_undo_restores_the_balance_of_the_last_use(self):
        bag = self._bag(120)
        self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 40, "feeding_id": 31})
        self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 80, "feeding_id": 32})
        self.assertEqual(self.call("GET", f"/milk/{bag['id']}")[1]["status"], "used")
        # the Stash page's Undo on a used bag: the last bottle's milk is back, the earlier one stays taken
        status, undone = self.call("PATCH", f"/milk/{bag['id']}", {"status": "stored"})
        self.assertEqual(status, 200)
        self.assertEqual((undone["status"], undone["remaining_ml"], undone["used_at"], undone["used_by"], undone["feeding_id"]), ("stored", 80, None, None, 31))
        self.assertEqual([u["feeding_id"] for u in undone["uses"]], [31])
        self.assertEqual(self.call("GET", "/milk/feeding/32")[1]["bag"], None)
        self.assertEqual(len(self._milk_reminders(bag)), 2)
        # "used without a bottle" takes everything that is left and undo brings it back
        elsewhere = self.call("PATCH", f"/milk/{bag['id']}", {"status": "used"})[1]
        self.assertEqual((elsewhere["status"], elsewhere["remaining_ml"], elsewhere["uses"][-1]["kind"], elsewhere["uses"][-1]["amount_ml"]), ("used", 0, "elsewhere", 80))
        undone = self.call("PATCH", f"/milk/{bag['id']}", {"status": "stored"})[1]
        self.assertEqual((undone["remaining_ml"], len(undone["uses"])), (80, 1))
        # discarding a partly used bag keeps its balance, and undoing the discard too
        discarded = self.call("PATCH", f"/milk/{bag['id']}", {"status": "discarded"})[1]
        self.assertEqual((discarded["status"], discarded["remaining_ml"], len(discarded["uses"])), ("discarded", 80, 1))
        self.assertIsNotNone(discarded["used_at"])
        status, body = self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 10, "feeding_id": 33})
        self.assertEqual((status, body["detail"]), (400, f"Bag {bag['code']} was discarded."))
        restored = self.call("PATCH", f"/milk/{bag['id']}", {"status": "stored"})[1]
        self.assertEqual((restored["status"], restored["remaining_ml"], restored["used_at"]), ("stored", 80, None))
        # a bag that still has milk in it is not undone: nothing to undo
        same = self.call("PATCH", f"/milk/{bag['id']}", {"status": "stored"})[1]
        self.assertEqual((same["remaining_ml"], len(same["uses"])), (80, 1))
        # deleting the bag outright takes its uses with it
        self.assertEqual(self.call("DELETE", f"/milk/{bag['id']}")[0], 204)
        self.assertEqual(self.app.store.q("SELECT COUNT(*) AS n FROM milk_uses WHERE bag=?", (bag["id"],))[0]["n"], 0)
        self.assertEqual(self.call("GET", "/milk/feeding/31")[1]["bag"], None)

    def test_one_bottle_from_several_bags(self):
        a, b, c = self._bag(30), self._bag(30), self._bag(80)
        # a 60 mL bottle from two 30 mL leftovers: both bags leave the stash, the feeding knows both
        status, link = self.call("PUT", "/milk/feeding/61", {"takes": [{"bag": a["id"], "amount_ml": 30}, {"bag": b["id"], "amount_ml": 30}]})
        self.assertEqual(status, 200)
        self.assertEqual(([t["bag"]["id"] for t in link["takes"]], [t["use"]["amount_ml"] for t in link["takes"]], link["total_ml"]), ([a["id"], b["id"]], [30, 30], 60))
        self.assertEqual(link["bag"]["id"], b["id"])  # the one-bag view: the latest take
        self.assertEqual([self.call("GET", f"/milk/{x['id']}")[1]["status"] for x in (a, b)], ["used", "used"])
        self.assertEqual(self.call("GET", "/milk?child=1&status=stored")[1][0]["id"], c["id"])
        # edited down to 50: the allocation is set again, the second bag gets 10 mL back and returns to the stash
        link = self.call("PUT", "/milk/feeding/61", {"takes": [{"bag": a["id"], "amount_ml": 30}, {"bag": b["id"], "amount_ml": 20}]})[1]
        self.assertEqual(link["total_ml"], 50)
        back = self.call("GET", f"/milk/{b['id']}")[1]
        self.assertEqual((back["status"], back["remaining_ml"], [u["amount_ml"] for u in back["uses"]]), ("stored", 10, [20]))
        # moved onto bag C alone: A and B get everything back
        link = self.call("PUT", "/milk/feeding/61", {"takes": [{"bag": c["id"], "amount_ml": 50}]})[1]
        self.assertEqual(([t["bag"]["id"] for t in link["takes"]], link["total_ml"]), ([c["id"]], 50))
        self.assertEqual([(self.call("GET", f"/milk/{x['id']}")[1]["status"], self.call("GET", f"/milk/{x['id']}")[1]["remaining_ml"]) for x in (a, b)], [("stored", 30), ("stored", 30)])
        self.assertEqual(len(self._milk_reminders(a)), 2)
        # a refused set changes nothing: B cannot give 40 (it has 30), so C keeps its take and A stays whole
        status, body = self.call("PUT", "/milk/feeding/61", {"takes": [{"bag": a["id"], "amount_ml": 10}, {"bag": b["id"], "amount_ml": 40}]})
        self.assertEqual(status, 400)
        self.assertIn(b["code"], body["detail"])
        self.assertEqual(self.call("GET", "/milk/feeding/61")[1]["total_ml"], 50)
        self.assertEqual(self.call("GET", f"/milk/{a['id']}")[1]["remaining_ml"], 30)
        # the same bag twice, or a bag that is not there, is a 400
        self.assertEqual(self.call("PUT", "/milk/feeding/61", {"takes": [{"bag": a["id"], "amount_ml": 5}, {"bag": a["id"], "amount_ml": 5}]})[0], 400)
        self.assertEqual(self.call("PUT", "/milk/feeding/61", {"takes": [{"bag": 99999, "amount_ml": 5}]})[0], 400)
        self.assertEqual(self.call("PUT", "/milk/feeding/61", {"takes": "x"})[0], 400)
        # deleted: an empty list gives it all back
        link = self.call("PUT", "/milk/feeding/61", {"takes": []})[1]
        self.assertEqual((link["bag"], link["takes"], link["total_ml"]), (None, [], 0))
        self.assertEqual(self.call("GET", f"/milk/{c['id']}")[1]["remaining_ml"], 80)
        # the one-bag call is the one-bag case: it takes the feeding off every other bag
        self.call("PUT", "/milk/feeding/62", {"takes": [{"bag": a["id"], "amount_ml": 10}, {"bag": b["id"], "amount_ml": 10}]})
        self.call("POST", f"/milk/{c['id']}/use", {"amount_ml": 20, "feeding_id": 62})
        link = self.call("GET", "/milk/feeding/62")[1]
        self.assertEqual(([t["bag"]["id"] for t in link["takes"]], link["total_ml"]), ([c["id"]], 20))
        self.assertEqual([self.call("GET", f"/milk/{x['id']}")[1]["remaining_ml"] for x in (a, b)], [30, 30])

    def test_the_household_sets_its_printer_and_push_contact_from_the_app(self):
        printer_before = self.app.printer
        try:
            status, view = self.call("GET", "/config")
            self.assertEqual(status, 200)
            self.assertFalse(view["admin"])
            # only an admin (Baby Buddy staff) changes them
            self.assertEqual(self.call("PUT", "/config", {"printer": "zebra://192.0.2.9:9100"})[0], 403)
            status, view = self.call("PUT", "/config", {"printer": "zebra://192.0.2.9:9100", "pushContact": "parent@example.com"}, token="boss")
            self.assertEqual(status, 200)
            self.assertEqual((view["printer"]["spec"], view["printer"]["source"]), ("zebra://192.0.2.9:9100", "settings"))
            self.assertEqual((view["pushContact"]["value"], view["pushContact"]["source"]), ("mailto:parent@example.com", "settings"))
            self.assertEqual((self.app.printer.kind, bs.VAPID_SUB), ("zebra", "mailto:parent@example.com"))
            self.assertIsNone(bs.vapid_contact_problem())
            self.assertTrue(self.call("GET", "/health", token=None)[1]["contact"])
            # a bridge token is a secret: shown masked, and sent back masked it is kept
            self.call("PUT", "/config", {"printer": "bridge://192.0.2.5:8110?token=s3cret"}, token="boss")
            masked = self.call("GET", "/config")[1]["printer"]["spec"]
            self.assertEqual(masked, "bridge://192.0.2.5:8110?token=••••")
            self.call("PUT", "/config", {"printer": masked}, token="boss")
            self.assertIn("token=s3cret", self.app.config_get("printer"))
            # refused: an unknown kind, a file path (host-only), a Zebra address without a port number, a bad email
            for body in ({"printer": "lpr://x"}, {"printer": "file:///tmp/x"}, {"printer": "zebra://192.0.2.9:91OO"}, {"pushContact": "not an email"}):
                with self.subTest(body=body):
                    self.assertEqual(self.call("PUT", "/config", body, token="boss")[0], 400)
            # "none": no printer even when the host set one
            self.app.env_printer = "zebra://192.0.2.77:9100"
            view = self.call("PUT", "/config", {"printer": "none"}, token="boss")[1]
            self.assertEqual((view["printer"]["spec"], view["printer"]["source"]), (None, "settings"))
            self.assertFalse(self.app.printer.configured)
            # cleared: back to what the host set
            view = self.call("PUT", "/config", {"printer": None}, token="boss")[1]
            self.assertEqual((view["printer"]["spec"], view["printer"]["source"]), ("zebra://192.0.2.77:9100", "server"))
            self.app.env_printer = None
            # cleared with nothing on the host: no printer
            view = self.call("PUT", "/config", {"printer": None, "pushContact": ""}, token="boss")[1]
            self.assertEqual((view["printer"]["source"], view["pushContact"]["source"]), ("none", "none"))
            self.assertFalse(self.app.printer.configured)
            self.assertIsNotNone(bs.vapid_contact_problem())
        finally:
            self.app.env_printer = None
            self.app.config_set("printer", None)
            self.app.config_set("push_contact", None)
            bs.set_vapid_sub(None)
            self.app.printer = printer_before

    def test_a_premade_bottle_moves_to_another_spot_and_swaps_with_the_bottle_there(self):
        a, b = self._bag(60), self._bag(60)
        bottles = [{"spot": 1, "takes": [{"bag": a["id"], "amount_ml": 60}], "client_key": "move-bottle-0001"}, {"spot": 2, "takes": [{"bag": b["id"], "amount_ml": 40}], "client_key": "move-bottle-0002"}]
        one, two = self.call("POST", "/milk/bottles", {"child": 1, "bottles": bottles})[1]
        # to an empty spot: it just moves, and its reminders name the new spot
        status, moved = self.call("POST", f"/milk/{one['id']}/spot", {"spot": 4})
        self.assertEqual((status, [(m["id"], m["spot"]) for m in moved]), (200, [(one["id"], 4)]))
        self.assertTrue(all("premade bottle 4" in r["title"] for r in self._milk_reminders(one)))
        # onto a taken spot: the two swap in one step
        status, moved = self.call("POST", f"/milk/{one['id']}/spot", {"spot": 2})
        self.assertEqual(sorted((m["id"], m["spot"]) for m in moved), sorted([(one["id"], 2), (two["id"], 4)]))
        spots = sorted((x["spot"], x["remaining_ml"]) for x in self.call("GET", "/milk?child=1&status=stored")[1] if x["kind"] == "bottle")
        self.assertEqual(spots, [(2, 60), (4, 40)])
        self.assertTrue(all("premade bottle 4" in r["title"] for r in self._milk_reminders(two)))
        # its own spot: nothing changes; refusals: no such spot, not a bottle, a missing id
        self.assertEqual(self.call("POST", f"/milk/{one['id']}/spot", {"spot": 2})[1][0]["spot"], 2)
        self.assertEqual(self.call("POST", f"/milk/{one['id']}/spot", {"spot": 6})[0], 400)
        self.assertEqual(self.call("POST", f"/milk/{one['id']}/spot", {"spot": True})[0], 400)
        bag = self._bag(30)
        self.assertEqual(self.call("POST", f"/milk/{bag['id']}/spot", {"spot": 3})[0], 400)
        self.assertEqual(self.call("POST", "/milk/999999/spot", {"spot": 3})[0], 404)

    def test_night_bottles_are_poured_from_bags_into_numbered_spots(self):
        a, b, d = self._bag(30), self._bag(60), self._bag(20)
        frozen = self._bag(100, location="freezer")
        bottles = [
            {"spot": 1, "takes": [{"bag": a["id"], "amount_ml": 30}, {"bag": b["id"], "amount_ml": 30}], "client_key": "night-bottle-0001"},
            {"spot": 2, "takes": [{"bag": b["id"], "amount_ml": 30}], "client_key": "night-bottle-0002"},
        ]
        status, made = self.call("POST", "/milk/bottles", {"child": 1, "bottles": bottles})
        self.assertEqual(status, 201)
        one, two = made
        self.assertEqual([(x["kind"], x["spot"], x["volume_ml"], x["remaining_ml"], x["location"], x["status"]) for x in made], [("bottle", 1, 60, 60, "fridge", "stored"), ("bottle", 2, 30, 30, "fridge", "stored")])
        # dated from its oldest milk, the way a combined container is labelled; the bags it came from are named
        self.assertEqual(one["pumped_at"], min(a["pumped_at"], b["pumped_at"]))
        self.assertEqual(datetime.fromisoformat(one["expires_at"]) - datetime.fromisoformat(one["pumped_at"]), timedelta(days=4))
        self.assertIn(a["code"], one["notes"])
        self.assertIn(b["code"], one["notes"])
        # the milk left the bags now: both are used up, each pour on record as `combined` into its bottle
        for bag, uses in ((a, [(30, "combined", one["id"])]), (b, [(30, "combined", one["id"]), (30, "combined", two["id"])])):
            now_bag = self.call("GET", f"/milk/{bag['id']}")[1]
            self.assertEqual((now_bag["status"], now_bag["remaining_ml"]), ("used", 0))
            self.assertEqual([(u["amount_ml"], u["kind"], u["into_bag"]) for u in now_bag["uses"]], uses)
        self.assertEqual(self._milk_reminders(a), [])
        self.assertTrue(all("premade bottle 1" in r["title"] for r in self._milk_reminders(one)))
        # sent again (a retry): the same bottles, nothing poured twice
        status, again = self.call("POST", "/milk/bottles", {"child": 1, "bottles": bottles})
        self.assertEqual((status, [x["id"] for x in again]), (201, [one["id"], two["id"]]))
        self.assertEqual(len(self.call("GET", f"/milk/{b['id']}")[1]["uses"]), 2)
        # refusals change nothing
        for body, says in (
            ({"bottles": [{"spot": 1, "takes": [{"bag": d["id"], "amount_ml": 10}]}]}, "Spot 1 already has a bottle"),
            ({"bottles": [{"spot": 3, "takes": [{"bag": frozen["id"], "amount_ml": 10}]}]}, "freezer"),
            ({"bottles": [{"spot": 3, "takes": [{"bag": d["id"], "amount_ml": 50}]}]}, "Only 20 mL"),
            ({"bottles": [{"spot": 3, "takes": [{"bag": a["id"], "amount_ml": 5}]}]}, "already used up"),
            ({"bottles": [{"spot": 3, "takes": [{"bag": one["id"], "amount_ml": 5}]}]}, "cannot be poured into another bottle"),
            ({"bottles": [{"spot": 6, "takes": [{"bag": d["id"], "amount_ml": 5}]}]}, "1 to 5"),
            ({"bottles": [{"spot": 3, "takes": [{"bag": d["id"], "amount_ml": 5}]}, {"spot": 3, "takes": [{"bag": d["id"], "amount_ml": 5}]}]}, "Two bottles"),
            ({"bottles": [{"spot": 3, "takes": []}]}, "no milk"),
            ({"bottles": [{"spot": 3, "takes": [{"bag": d["id"], "amount_ml": 5}], "location": "room"}]}, "fridge spots"),
            ({"bottles": [{"spot": i, "takes": [{"bag": d["id"], "amount_ml": 1}]} for i in range(1, 7)]}, "at most 5"),
        ):
            with self.subTest(says=says):
                status, out = self.call("POST", "/milk/bottles", {"child": 1, **body})
                self.assertEqual(status, 400)
                self.assertIn(says, out["detail"])
        self.assertEqual(self.call("GET", f"/milk/{d['id']}")[1]["remaining_ml"], 20)
        self.assertEqual(self.call("POST", "/milk/bottles", {"child": 1, "bottles": "x"})[0], 400)
        self.assertEqual(self.call("POST", "/milk/bottles", {"bottles": bottles})[0], 400)
        # Undo on a bag whose milk went into a bottle would count that milk twice
        status, out = self.call("PATCH", f"/milk/{b['id']}", {"status": "stored"})
        self.assertEqual(status, 400)
        self.assertIn("spot 2", out["detail"])
        # a night feed takes the whole bottle (what she did not drink is thrown away) and frees the spot
        self.call("PUT", "/milk/feeding/71", {"takes": [{"bag": one["id"], "amount_ml": 60}]})
        self.assertEqual(self.call("GET", f"/milk/{one['id']}")[1]["status"], "used")
        # the feeding deleted: the bottle is back in its spot
        self.call("PUT", "/milk/feeding/71", {"takes": []})
        self.assertEqual(self.call("GET", f"/milk/{one['id']}")[1]["status"], "stored")
        self.assertEqual(self.call("POST", "/milk/bottles", {"child": 1, "bottles": [{"spot": 1, "takes": [{"bag": d["id"], "amount_ml": 10}]}]})[0], 400)
        self.call("PUT", "/milk/feeding/71", {"takes": [{"bag": one["id"], "amount_ml": 60}]})
        status, made = self.call("POST", "/milk/bottles", {"child": 1, "bottles": [{"spot": 1, "takes": [{"bag": d["id"], "amount_ml": 10}]}]})
        self.assertEqual((status, made[0]["spot"], made[0]["volume_ml"]), (201, 1, 10))
        self.assertEqual(self.call("GET", f"/milk/{d['id']}")[1]["remaining_ml"], 10)

    def test_sweep_2026_10_21_milk_fixes(self):
        now = datetime.now(timezone.utc)
        # thawed milk stays thawed: un-thawing it would re-date it and let it back into the freezer
        frozen = self._bag(100, location="freezer", pumped_at=(now - timedelta(hours=20)).isoformat(timespec="seconds"))
        status, thawed = self.call("PATCH", f"/milk/{frozen['id']}", {"location": "fridge"})
        self.assertEqual((status, thawed["thawed"]), (200, True))
        status, body = self.call("PATCH", f"/milk/{frozen['id']}", {"thawed": False})
        self.assertEqual(status, 400)
        self.assertIn("stays thawed", body["detail"])
        self.assertEqual(self.call("PATCH", f"/milk/{frozen['id']}", {"location": "freezer"})[0], 400)
        # a day-old fridge bag put on the counter gets its room hours from now, not from the pump
        old = self._bag(80, pumped_at=(now - timedelta(hours=26)).isoformat(timespec="seconds"))
        status, out = self.call("PATCH", f"/milk/{old['id']}", {"location": "room"})
        self.assertEqual(status, 200)
        left = datetime.fromisoformat(out["expires_at"]) - now
        self.assertTrue(timedelta(hours=3) < left <= timedelta(hours=4, minutes=1), left)
        # ...and it can go back to the fridge, never keeping longer than its fridge window
        status, back = self.call("PATCH", f"/milk/{old['id']}", {"location": "fridge"})
        self.assertEqual(status, 200)
        self.assertLessEqual(datetime.fromisoformat(back["expires_at"]), datetime.fromisoformat(old["expires_at"]) + timedelta(seconds=1))
        # a bag moved from one travel sticker to another frees the first; deleting a bag frees its sticker
        codes = [t["code"] for t in self.call("POST", "/milk/travel", {"child": 2, "count": 2, "client_key": "sweep-1021-stickers"})[1]]
        bag = self._bag(60, child=2, travel_code=codes[0])
        status, moved = self.call("PATCH", f"/milk/{bag['id']}", {"travel_code": codes[1]})
        self.assertEqual((status, moved["code"]), (200, codes[1]))
        self.assertEqual(self.call("GET", f"/milk/travel/{codes[0]}")[1]["status"], "unused")
        self.assertEqual(self.call("DELETE", f"/milk/{bag['id']}")[0], 204)
        self.assertEqual(self.call("GET", f"/milk/travel/{codes[1]}")[1]["status"], "unused")
        # an emptied bag cannot take a sticker (it would only use one up)
        empty = self._bag(30, child=2)
        self.assertEqual(self.call("PATCH", f"/milk/{empty['id']}", {"remaining_ml": 0})[1]["status"], "used")
        status, body = self.call("PATCH", f"/milk/{empty['id']}", {"travel_code": codes[0]})
        self.assertEqual(status, 400)
        self.assertIn("no longer in the stash", body["detail"])
        self.assertEqual(self.call("GET", f"/milk/travel/{codes[0]}")[1]["status"], "unused")

    def test_bags_taken_to_the_nicu_leave_the_home_stash_whole_and_undo_brings_one_back(self):
        a, b = self._bag(30, pumping_id=601), self._bag(12, pumping_id=602)
        self.call("POST", f"/milk/{b['id']}/use", {"amount_ml": 2})  # 2 mL used as drops at home: 10 mL goes in
        status, gone = self.call("POST", "/milk/nicu", {"child": 1, "bags": [a["id"], b["id"], a["id"]]})
        self.assertEqual(status, 200)
        self.assertEqual([(g["status"], g["remaining_ml"]) for g in gone], [("used", 0), ("used", 0)])
        self.assertEqual([u["kind"] for u in gone[1]["uses"]], ["bottle", "nicu"])
        self.assertEqual(gone[1]["uses"][-1]["amount_ml"], 10)
        self.assertEqual(self.call("GET", "/milk?child=1&status=stored")[1], [])
        # taken in by mistake: Undo on the bag reverses the trip and keeps the drops
        status, back = self.call("PATCH", f"/milk/{b['id']}", {"status": "stored"})
        self.assertEqual((status, back["status"], back["remaining_ml"], [u["kind"] for u in back["uses"]]), (200, "stored", 10, ["bottle"]))
        # every bag is checked first: one that is gone, another child's, or past its window refuses the trip
        status, body = self.call("POST", "/milk/nicu", {"child": 1, "bags": [b["id"], a["id"]]})
        self.assertEqual(status, 400)
        self.assertIn("no longer in the stash", body["detail"])
        self.assertEqual(self.call("GET", f"/milk/{b['id']}")[1]["status"], "stored")  # nothing was written
        old = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat(timespec="seconds")
        status, stale = self.call("POST", "/milk", {"child": 1, "pumped_at": old, "volume_ml": 20, "location": "fridge", "client_key": "nicu-stale-0001"})
        status, body = self.call("POST", "/milk/nicu", {"child": 1, "bags": [stale["id"]]})
        self.assertEqual(status, 400)
        self.assertIn("past its window", body["detail"])
        self.assertEqual(self.call("POST", "/milk/nicu", {"child": 2, "bags": [b["id"]]})[0], 400)
        self.assertEqual(self.call("POST", "/milk/nicu", {"child": 1, "bags": []})[0], 400)
        self.assertEqual(self.call("POST", "/milk/nicu", {"child": 1, "bags": [True]})[0], 400)

    def test_travel_stickers_are_printed_ahead_and_go_on_the_session_they_were_used_for(self):
        status, stickers = self.call("POST", "/milk/travel", {"child": 1, "count": 3, "client_key": "travel-batch-0001"})
        self.assertEqual(status, 201)
        codes = [t["code"] for t in stickers]
        self.assertEqual((len(set(codes)), {t["status"] for t in stickers}), (3, {"unused"}))
        # a reprint of the same batch (a retry) is the same codes, not three more
        self.assertEqual([t["code"] for t in self.call("POST", "/milk/travel", {"child": 1, "count": 3, "client_key": "travel-batch-0001"})[1]], codes)
        self.assertEqual(len(self.call("GET", "/milk/travel?child=1")[1]), 3)
        # nothing is in the stash; scanning one on the Stash tab says what it is
        self.assertEqual(self.call("GET", "/milk?child=1&status=stored")[1], [])
        status, body = self.call("GET", f"/milk/code/{codes[0]}")
        self.assertEqual(status, 404)
        self.assertIn("not on any milk yet", body["detail"])
        self.assertEqual(self.call("GET", f"/milk/travel/{codes[0].lower()}")[1]["status"], "unused")
        # the session is logged: its bag takes the sticker's code
        pumped = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds")
        status, bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 90, "pumping_id": 501, "travel_code": codes[0]})
        self.assertEqual((status, bag["code"]), (201, codes[0]))
        self.assertEqual(self.call("GET", f"/milk/code/{codes[0]}")[1]["id"], bag["id"])
        self.assertEqual(self.call("GET", f"/milk/travel/{codes[0]}")[1]["bag_id"], bag["id"])
        # one sticker, one bag: the same code on other milk is refused, and so is a code that is not ours
        status, body = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60, "pumping_id": 502, "travel_code": codes[0]})
        self.assertEqual(status, 400)
        self.assertIn("already on other milk", body["detail"])
        self.assertEqual(self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 60, "pumping_id": 503, "travel_code": "ZZZZZZ"})[0], 400)
        self.assertEqual(self.call("POST", "/milk", {"child": 2, "pumped_at": pumped, "volume_ml": 60, "travel_code": codes[1]})[0], 400)
        # a bag made before the sticker went on (auto-print at home) takes the sticker's code
        other = self._bag(70, pumping_id=504)
        status, moved = self.call("PATCH", f"/milk/{other['id']}", {"travel_code": codes[1]})
        self.assertEqual((status, moved["code"]), (200, codes[1]))
        # ...and so does the session's bag registered again with a sticker (the same idempotent call)
        third = self._bag(50, pumping_id=505)
        again = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 50, "pumping_id": 505, "travel_code": codes[2]})[1]
        self.assertEqual((again["id"], again["code"]), (third["id"], codes[2]))
        self.assertEqual({t["status"] for t in self.call("GET", "/milk/travel?child=1")[1]}, {"assigned"})
        # limits
        self.assertEqual(self.call("POST", "/milk/travel", {"child": 1, "count": 31})[0], 400)
        self.assertEqual(self.call("POST", "/milk/travel", {"child": 1, "count": 0})[0], 400)
        self.assertEqual(self.call("POST", "/milk/travel", {"count": 2})[0], 400)

    def test_a_bottle_moved_to_another_bag_gives_the_first_bag_its_milk_back(self):
        a = self._bag(120)
        b = self._bag(100, location="freezer")
        self.call("POST", f"/milk/{a['id']}/use", {"amount_ml": 40, "feeding_id": 51})
        # the bottle was logged against the wrong bag: saving it against B moves the take, A is whole again
        status, moved = self.call("POST", f"/milk/{b['id']}/use", {"amount_ml": 40, "feeding_id": 51})
        self.assertEqual(status, 200)
        self.assertEqual((moved["remaining_ml"], moved["feeding_id"], [u["feeding_id"] for u in moved["uses"]]), (60, 51, [51]))
        back = self.call("GET", f"/milk/{a['id']}")[1]
        self.assertEqual((back["remaining_ml"], back["status"], back["feeding_id"], back["uses"]), (120, "stored", None, []))
        link = self.call("GET", "/milk/feeding/51")[1]
        self.assertEqual((link["bag"]["id"], link["use"]["amount_ml"]), (b["id"], 40))
        self.assertEqual(len(self._milk_reminders(a)), 2)
        # a bag the bottle had emptied comes back into the stash when the bottle leaves it
        self.call("POST", f"/milk/{b['id']}/use", {"amount_ml": 100, "feeding_id": 51})
        self.assertEqual(self.call("GET", f"/milk/{b['id']}")[1]["status"], "used")
        self.assertEqual(self._milk_reminders(b), [])
        moved = self.call("POST", f"/milk/{a['id']}/use", {"amount_ml": 100, "feeding_id": 51})[1]
        self.assertEqual((moved["remaining_ml"], moved["feeding_id"]), (20, 51))
        b_back = self.call("GET", f"/milk/{b['id']}")[1]
        self.assertEqual((b_back["status"], b_back["remaining_ml"], b_back["used_at"], b_back["used_by"], b_back["uses"]), ("stored", 100, None, None, []))
        self.assertEqual(len(self._milk_reminders(b)), 2)
        # other bottles from the first bag are untouched by the move
        self.call("POST", f"/milk/{b['id']}/use", {"amount_ml": 25, "feeding_id": 52})
        moved = self.call("POST", f"/milk/{b['id']}/use", {"amount_ml": 60, "feeding_id": 51})[1]
        self.assertEqual(([u["feeding_id"] for u in moved["uses"]], moved["remaining_ml"]), ([52, 51], 15))
        self.assertEqual(self.call("GET", f"/milk/{a['id']}")[1]["remaining_ml"], 120)
        # a refused move leaves the first bag's take where it is
        status, body = self.call("POST", f"/milk/{a['id']}/use", {"amount_ml": 150, "feeding_id": 51})
        self.assertEqual(status, 400)
        self.assertEqual(self.call("GET", f"/milk/{b['id']}")[1]["remaining_ml"], 15)
        self.assertEqual(self.call("GET", "/milk/feeding/51")[1]["bag"]["id"], b["id"])
        # the same feeding saved again on the same bag is still one use
        again = self.call("POST", f"/milk/{b['id']}/use", {"amount_ml": 60, "feeding_id": 51})[1]
        self.assertEqual((again["remaining_ml"], len(again["uses"])), (15, 2))

    def test_what_is_left_in_a_bag_can_be_set_by_hand(self):
        bag = self._bag(120)
        self.call("POST", f"/milk/{bag['id']}/use", {"amount_ml": 40, "feeding_id": 41})
        # a spill: 50 left, not 80; the correction is on record
        status, fixed = self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": 50})
        self.assertEqual(status, 200)
        self.assertEqual((fixed["status"], fixed["remaining_ml"], fixed["volume_ml"]), ("stored", 50, 120))
        self.assertEqual([(u["kind"], u["amount_ml"], u["feeding_id"]) for u in fixed["uses"]], [("bottle", 40, 41), ("adjust", 30, None)])
        # back up to 80 (the spill was a misread): a negative adjustment, never more than the bag held
        fixed = self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": 80})[1]
        self.assertEqual((fixed["remaining_ml"], fixed["uses"][-1]["amount_ml"]), (80, -30))
        self.assertEqual(self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": 121})[0], 400)
        self.assertEqual(self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": -1})[0], 400)
        self.assertEqual(self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": "lots"})[0], 400)
        self.assertEqual(self.call("GET", f"/milk/{bag['id']}")[1]["remaining_ml"], 80)
        # the same value again is not a change
        self.assertEqual(len(self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": 80})[1]["uses"]), 3)
        # zero means used; undo reverses that adjustment
        empty = self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": 0})[1]
        self.assertEqual((empty["status"], empty["remaining_ml"], empty["uses"][-1]["kind"], empty["uses"][-1]["amount_ml"]), ("used", 0, "adjust", 80))
        self.assertIsNotNone(empty["used_at"])
        self.assertEqual(self._milk_reminders(bag), [])
        undone = self.call("PATCH", f"/milk/{bag['id']}", {"status": "stored"})[1]
        self.assertEqual((undone["status"], undone["remaining_ml"], len(undone["uses"])), ("stored", 80, 3))
        # setting what is left on a used-up bag brings it back into the stash
        self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": 0})
        revived = self.call("PATCH", f"/milk/{bag['id']}", {"remaining_ml": 25})[1]
        self.assertEqual((revived["status"], revived["remaining_ml"], revived["used_at"]), ("stored", 25, None))
        self.assertEqual(len(self._milk_reminders(bag)), 2)
        # the label volume can still be corrected on an untouched bag, and the balance follows it
        fresh = self._bag(100)
        self.assertEqual(self.call("PATCH", f"/milk/{fresh['id']}", {"volume_ml": 110})[1]["remaining_ml"], 110)
        self.call("POST", f"/milk/{fresh['id']}/use", {"amount_ml": 30, "feeding_id": 42})
        self.assertEqual(self.call("PATCH", f"/milk/{fresh['id']}", {"volume_ml": 90})[1]["remaining_ml"], 60)

    # The table as it first shipped (commit a5e2bfc) and as it stood before client_key: both may be in the field.
    OLD_MILK_SCHEMA = """
    CREATE TABLE milk_bags (
      id INTEGER PRIMARY KEY AUTOINCREMENT, child INTEGER NOT NULL, code TEXT NOT NULL UNIQUE, pumped_at TEXT NOT NULL,
      volume_ml REAL NOT NULL, location TEXT NOT NULL DEFAULT 'fridge', thawed INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stored', pumping_id INTEGER, feeding_id INTEGER, notes TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL, created_by INTEGER, used_at TEXT, used_by INTEGER{extra}
    );
    CREATE INDEX milk_bags_child ON milk_bags (child, status, expires_at);
    CREATE UNIQUE INDEX milk_bags_pumping ON milk_bags (child, pumping_id) WHERE pumping_id IS NOT NULL;
    """

    def test_milk_schema_migrates_an_existing_database_in_place(self):
        import sqlite3

        import milk as milk_mod

        kept_cols = "id, child, code, pumped_at, volume_ml, location, thawed, expires_at, status, pumping_id, feeding_id, notes, created, created_by, used_at, used_by"
        for label, extra in (("as-first-shipped", ""), ("with-thawed-at", ", thawed_at TEXT")):
            with self.subTest(schema=label):
                path = os.path.join(self.tmp.name, f"old-{label}.db")
                old = sqlite3.connect(path)
                old.executescript(self.OLD_MILK_SCHEMA.format(extra=extra))
                # a travel-sticker table left by an earlier, reverted build (before its batch_key column)
                old.execute("CREATE TABLE milk_travel_labels (code TEXT PRIMARY KEY, child INTEGER NOT NULL, bag_id INTEGER UNIQUE, created TEXT NOT NULL, created_by INTEGER, assigned_at TEXT)")
                old.execute("INSERT INTO milk_travel_labels (code, child, created) VALUES ('T7RAV2', 1, '2026-10-20T08:00:00+00:00')")
                old.execute(
                    "INSERT INTO milk_bags (child, code, pumped_at, volume_ml, location, thawed, expires_at, status, pumping_id, notes, created, created_by)"
                    " VALUES (1, 'K7M2QP', '2026-10-01T18:00:00+00:00', 118.29, 'fridge', 0, '2026-10-05T18:00:00+00:00', 'stored', 77, 'left side', '2026-10-01T18:05:00+00:00', 7)"
                )
                old.execute(
                    "INSERT INTO milk_bags (child, code, pumped_at, volume_ml, location, thawed, expires_at, status, feeding_id, created, used_at, used_by)"
                    " VALUES (1, '9XH3TR', '2026-09-29T08:00:00+00:00', 60, 'freezer', 0, '2027-03-31T08:00:00+00:00', 'used', 501, '2026-09-29T08:10:00+00:00', '2026-10-02T03:00:00+00:00', 7)"
                )
                old.execute(
                    "INSERT INTO milk_bags (child, code, pumped_at, volume_ml, location, thawed, expires_at, status, created, used_at, used_by)"
                    " VALUES (1, 'D4RK2N', '2026-09-28T08:00:00+00:00', 45, 'fridge', 0, '2026-10-02T08:00:00+00:00', 'discarded', '2026-09-28T08:10:00+00:00', '2026-10-01T03:00:00+00:00', 7)"
                )
                old.commit()
                before = [tuple(r) for r in old.execute(f"SELECT {kept_cols} FROM milk_bags ORDER BY id")]
                old.close()

                store = bs.Store(path)
                try:
                    milk = milk_mod.MilkStore(store, bs.parse_iso, bs.utc_iso, bs.now_iso)
                    cols = {r["name"] for r in store.q("PRAGMA table_info(milk_bags)")}
                    self.assertLessEqual({"thawed_at", "client_key", "remaining_ml", "kind", "spot"}, cols)
                    self.assertIn("into_bag", {r["name"] for r in store.q("PRAGMA table_info(milk_uses)")})
                    # the balance column starts full on stored bags, empty on used ones, full on discarded ones (undo gives it all back)
                    self.assertEqual({r["code"]: r["remaining_ml"] for r in store.q("SELECT code, remaining_ml FROM milk_bags")}, {"K7M2QP": 118.29, "9XH3TR": 0, "D4RK2N": 45})
                    self.assertEqual(store.q("SELECT COUNT(*) AS n FROM milk_uses")[0]["n"], 0)
                    indexes = {r["name"]: r["unique"] for r in store.q("PRAGMA index_list(milk_bags)")}
                    self.assertEqual(indexes.get("milk_bags_client_key"), 1)
                    self.assertEqual(indexes.get("milk_bags_pumping"), 1)
                    # every existing bag is still there, unchanged, and reads back through the API shape
                    after = [tuple(r.values()) for r in store.q(f"SELECT {kept_cols} FROM milk_bags ORDER BY id")]
                    self.assertEqual(after, before)
                    self.assertEqual(len(after), 3)
                    self.assertEqual(store.q("SELECT COUNT(*) AS n FROM milk_bags WHERE client_key IS NOT NULL OR thawed_at IS NOT NULL")[0]["n"], 0)
                    kept = milk.by_code("K7M2QP")
                    self.assertEqual((kept["volume_ml"], kept["pumping_id"], kept["notes"], kept["thawed_at"]), (118.29, 77, "left side", None))
                    self.assertEqual((kept["kind"], kept["spot"]), ("bag", None))
                    self.assertIn("batch_key", {r["name"] for r in store.q("PRAGMA table_info(milk_travel_labels)")})
                    self.assertEqual(milk.travel_get("T7RAV2")["status"], "unused")
                    self.assertEqual([b["code"] for b in milk.list(1)], ["K7M2QP", "D4RK2N", "9XH3TR"])
                    self.assertEqual([(b["remaining_ml"], b["uses"]) for b in milk.list(1)], [(118.29, []), (45, []), (0, [])])
                    # old bags keep working: a reprint for the same pumping entry finds the old bag
                    pumped = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(timespec="seconds")
                    self.assertEqual(milk.create({"child": 1, "pumped_at": pumped, "volume_ml": 100, "pumping_id": 77}, 7)["code"], "K7M2QP")
                    # ...and an old bag can still be moved and thawed, which writes the added thawed_at column;
                    # undoing a bag used before balances existed gives the whole bag back (no use to reverse)
                    moved = milk.patch(2, {"status": "stored", "location": "fridge"}, 7)
                    self.assertTrue(moved["thawed"])
                    self.assertIsNotNone(moved["thawed_at"])
                    self.assertEqual((moved["remaining_ml"], moved["feeding_id"]), (60, None))
                    # an old stored bag takes a partial bottle like a new one
                    part = milk.use(1, 40, 601, 7)
                    self.assertEqual((part["status"], part["remaining_ml"], part["uses"][0]["feeding_id"]), ("stored", 78.29, 601))
                    # new bags with a client key land next to them, once per key
                    new = milk.create({"child": 1, "pumped_at": pumped, "volume_ml": 60, "client_key": "after-migration-1"}, 7)
                    self.assertEqual(milk.create({"child": 1, "pumped_at": pumped, "volume_ml": 60, "client_key": "after-migration-1"}, 7)["id"], new["id"])
                    self.assertEqual(new["id"], 4)
                    with self.assertRaises(sqlite3.IntegrityError):
                        store.x("INSERT INTO milk_bags (child, code, pumped_at, volume_ml, expires_at, created, client_key) VALUES (1, 'ZZZZZ2', ?, 1, ?, ?, 'after-migration-1')", (pumped, pumped, pumped))
                    # starting the service again on the migrated file changes nothing
                    milk_mod.MilkStore(store, bs.parse_iso, bs.utc_iso, bs.now_iso)
                    self.assertEqual(store.q("SELECT COUNT(*) AS n FROM milk_bags")[0]["n"], 4)
                    self.assertEqual(store.q("SELECT remaining_ml FROM milk_bags WHERE id=1")[0]["remaining_ml"], 78.29)
                    self.assertEqual({r["name"] for r in store.q("PRAGMA table_info(milk_bags)")}, cols)
                finally:
                    store.conn.close()

    def test_niimbot_backend_scales_to_head_width_and_reports_connection_errors(self):
        import milk as milk_mod
        try:
            from PIL import Image
        except Exception:
            self.skipTest("Pillow not installed here")
        printed = {}

        class FakeClient:
            def __init__(self, kind, target):
                printed["connection"] = (kind, target)

            def print_image(self, image, density=3):
                printed["size"] = image.size
                printed["mode"] = image.mode
                printed["density"] = density

        p = milk_mod.Printer("niimbot://bluetooth/aa:bb:cc:dd:ee:ff?model=b1&density=4", niimbot_factory=FakeClient)
        self.assertTrue(p.configured)
        buf = io.BytesIO()
        Image.new("L", (400, 240), 255).save(buf, format="PNG")  # a 50 × 30 mm label at 203 dpi
        res = p.print_png(buf.getvalue())
        self.assertEqual(printed["connection"], ("bluetooth", "aa:bb:cc:dd:ee:ff"))
        self.assertEqual(printed["size"], (384, 230))  # fitted to the 48 mm head
        self.assertEqual(printed["mode"], "1")
        self.assertEqual(printed["density"], 4)
        self.assertEqual(res["width"], 384)
        # a 40 × 30 label (320 px) is not upscaled
        buf2 = io.BytesIO()
        Image.new("L", (320, 240), 255).save(buf2, format="PNG")
        p.print_png(buf2.getvalue())
        self.assertEqual(printed["size"], (320, 240))
        # usb spec, auto port
        usb = milk_mod.Printer("niimbot://usb?model=b21", niimbot_factory=FakeClient)
        usb.print_png(buf2.getvalue())
        self.assertEqual(printed["connection"], ("usb", ""))

        class Unreachable:
            def __init__(self, kind, target):
                raise OSError(112, "Host is down")

        bad = milk_mod.Printer("niimbot://bluetooth/aa:bb:cc:dd:ee:ff?model=b1", niimbot_factory=Unreachable)
        with self.assertRaises(milk_mod.PrinterError) as ctx:
            bad.print_png(buf2.getvalue())
        self.assertIn("paired with the server", str(ctx.exception))
        self.assertEqual(milk_mod.Printer("niimbot://bluetooth/aa?model=zz", niimbot_factory=FakeClient).kind, "niimbot")

    def test_zebra_backend_sends_the_label_as_zpl_at_the_label_size(self):
        import milk as milk_mod

        try:
            from PIL import Image, ImageDraw
        except Exception:
            self.skipTest("Pillow not installed here")
        sent = {}

        def capture(addr, port, zpl):
            sent.update(addr=addr, port=port, zpl=zpl)

        p = milk_mod.Printer("zebra://192.0.2.2:9100?darkness=22", zebra_send=capture)
        self.assertTrue(p.configured)
        self.assertEqual(p.status()["target"], "zebra://192.0.2.2:9100")
        img = Image.new("L", (400, 240), 255)  # the 50 × 30 mm preset at 203 dpi
        ImageDraw.Draw(img).rectangle((0, 0, 7, 0), fill=0)  # the first byte of the first row is all black
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        res = p.print_png(buf.getvalue())
        self.assertEqual((sent["addr"], sent["port"]), ("192.0.2.2", 9100))
        zpl = sent["zpl"]
        self.assertTrue(zpl.startswith(b"^XA") and zpl.endswith(b"^PQ1^XZ"))
        self.assertIn(b"^PW400^LL240", zpl)  # the label size follows the PNG, i.e. the size chosen in Settings
        self.assertIn(b"~SD22", zpl)
        self.assertIn(b"^GFA,12000,12000,50,FF00", zpl)  # 50 bytes a row, black is a 1 bit
        self.assertEqual((res["width"], res["height"]), (400, 240))
        # a 40 × 60 portrait preset rotated to feed sideways
        tall = io.BytesIO()
        Image.new("L", (320, 480), 255).save(tall, format="PNG")
        milk_mod.Printer("zebra://192.0.2.2?rotate=90", zebra_send=capture).print_png(tall.getvalue())
        self.assertIn(b"^PW480^LL320", sent["zpl"])
        self.assertEqual(sent["port"], 9100)
        self.assertNotIn(b"~SD", sent["zpl"])
        self.assertIn("needs the printer's address", milk_mod.Printer("zebra://").status()["detail"])

        def down(addr, port, zpl):
            raise OSError(113, "No route to host")

        with self.assertRaises(milk_mod.PrinterError) as ctx:
            milk_mod.Printer("zebra://10.0.0.9:9100", zebra_send=down).print_png(buf.getvalue())
        self.assertIn("Could not reach the Zebra", str(ctx.exception))

    def test_zebra_label_goes_out_with_resume_first_and_the_status_question_last(self):
        """A paused Zebra (after a jam or a head-open) resumes by itself: ~PS leads, the label follows, ~HS asks."""
        import socket
        import threading

        import milk as milk_mod

        try:
            from PIL import Image
        except Exception:
            self.skipTest("Pillow not installed here")
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        got = {}

        def printer():
            conn, _ = srv.accept()
            conn.settimeout(2)
            buf = b""
            try:
                while not buf.endswith(b"~HS"):
                    chunk = conn.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
            except OSError:
                pass
            got["bytes"] = buf
            conn.close()

        t = threading.Thread(target=printer, daemon=True)
        t.start()
        buf = io.BytesIO()
        Image.new("L", (400, 240), 255).save(buf, format="PNG")
        p = milk_mod.Printer(f"zebra://127.0.0.1:{srv.getsockname()[1]}")
        result, link = p._print(buf.getvalue())
        t.join(3)
        link.close()
        srv.close()
        self.assertTrue(result["ok"])
        self.assertTrue(got["bytes"].startswith(b"~PS^XA"), got["bytes"][:12])
        self.assertTrue(got["bytes"].endswith(b"^PQ1^XZ~HS"))

    def test_zebra_host_status_is_decoded_into_plain_language(self):
        import milk as milk_mod
        # Three ~HS lines as the GK420d sends them through AP1 (captured 2026-10-06): all clear.
        clear = b"\x02030,0,0,0210,000,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n"
        fields = milk_mod.parse_host_status(clear)
        self.assertEqual((fields["paper_out"], fields["paused"], fields["head_open"], fields["buffered"], fields["remaining"]), (False, False, False, 0, 0))
        self.assertEqual(milk_mod.describe_host_status(fields)[0], "ready")
        self.assertIn("should be out", milk_mod.describe_host_status(fields)[1])
        paper = milk_mod.parse_host_status(b"\x02030,1,0,0210,001,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000001,1,000\x03\r\n\x021234,0\x03\r\n")
        self.assertEqual(milk_mod.describe_host_status(paper)[0], "paper_out")
        self.assertIn("out of labels", milk_mod.describe_host_status(paper)[1])
        lid = milk_mod.parse_host_status(b"\x02030,0,0,0210,000,0,0,0,000,0,0,0\x03\r\n\x02000,0,1,0,0,2,1,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n")
        self.assertEqual(milk_mod.describe_host_status(lid)[0], "head_open")
        paused = milk_mod.parse_host_status(b"\x02030,0,1,0210,000,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000000,1,000\x03\r\n")
        self.assertEqual(milk_mod.describe_host_status(paused)[0], "paused")
        busy = milk_mod.parse_host_status(b"\x02030,0,0,0210,001,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000001,1,000\x03\r\n")
        self.assertEqual(milk_mod.describe_host_status(busy)[0], "busy")
        # Garbage, or a reply cut short, is "no answer", never a guess.
        self.assertIsNone(milk_mod.parse_host_status(b""))
        self.assertIsNone(milk_mod.parse_host_status(b"\x02030,0,0\x03\r\n"))
        self.assertIsNone(milk_mod.parse_host_status(b"  PRINTER STATUS\r\n   ERRORS: 0"))

    def test_print_label_records_a_job_and_the_zebra_check_updates_it(self):
        import milk as milk_mod

        try:
            from PIL import Image
        except Exception:
            self.skipTest("Pillow not installed here")
        buf = io.BytesIO()
        Image.new("L", (400, 240), 255).save(buf, format="PNG")
        png = buf.getvalue()
        sent, answers = [], []

        def capture(addr, port, zpl):
            sent.append(zpl)

        def query(addr, port, cmd, wait):
            answers.append((cmd, wait))
            return b"\x02030,0,0,0210,000,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n"

        p = milk_mod.Printer("zebra://192.0.2.2:9100", zebra_send=capture, zebra_query=query)
        with self.assertLogs("bramble.milk", level="INFO") as logs:
            res = p.print_label(png, code="AB23CD", background=False)
        self.assertTrue(res["ok"])
        self.assertEqual(len(sent), 1)
        job = res["job"]
        self.assertEqual((job["backend"], job["state"], job["checking"]), ("zebra", "ready", False))
        self.assertIn("should be out", job["detail"])
        self.assertEqual(answers[0][0], b"~HS")
        self.assertEqual(p.job(job["id"]), job)
        self.assertIsNone(p.job(job["id"] + 100))
        joined = "\n".join(logs.output)
        self.assertIn("bag=AB23CD", joined)
        self.assertIn("backend=zebra", joined)
        self.assertRegex(joined, r"in \d+ms")
        self.assertIn("ready", joined)
        self.assertNotIn(base64.b64encode(png).decode()[:20], joined)

        # The printer stays silent for the whole window: the job says so instead of pretending.
        silent = milk_mod.Printer("zebra://192.0.2.2:9100", zebra_send=capture, zebra_query=lambda *a: b"")
        job = silent.print_label(png, background=False)["job"]
        self.assertEqual((job["state"], job["checking"]), ("no_answer", False))
        self.assertIn("did not answer", job["detail"])

        # Still printing when it first answers: the check asks again (bounded), then reports the last answer.
        replies = iter([b"\x02030,0,0,0210,001,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000001,1,000\x03\r\n", b"\x02030,0,0,0210,000,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000000,1,000\x03\r\n"])
        slow = milk_mod.Printer("zebra://192.0.2.2:9100", zebra_send=capture, zebra_query=lambda *a: next(replies), check_pause=0)
        self.assertEqual(slow.print_label(png, background=False)["job"]["state"], "ready")
        # ...but "it has the label" is what stands when the window closes first.
        stuck = milk_mod.Printer("zebra://192.0.2.2:9100", zebra_send=capture, zebra_query=lambda *a: b"\x02030,0,0,0210,001,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000001,1,000\x03\r\n", check_pause=0)
        stuck.CHECK_WINDOW = 0.1
        job = stuck.print_label(png, background=False)["job"]
        self.assertEqual((job["state"], job["checking"]), ("busy", False))
        self.assertIn("has the label", job["detail"])

        # A failed send is logged at WARNING with the reason, and no job is left behind.
        def down(addr, port, zpl):
            raise OSError(113, "No route to host")

        broken = milk_mod.Printer("zebra://10.0.0.9:9100", zebra_send=down, zebra_query=query)
        with self.assertLogs("bramble.milk", level="WARNING") as logs:
            with self.assertRaises(milk_mod.PrinterError):
                broken.print_label(png, code="ZZ", background=False)
        self.assertIn("Could not reach the Zebra", "\n".join(logs.output))
        self.assertIn("bag=ZZ", "\n".join(logs.output))

        # In the background (the real path) the job starts as "sent" and the check lands shortly after.
        def slow_query(addr, port, cmd, wait):
            time.sleep(0.3)
            return query(addr, port, cmd, wait)

        bg = milk_mod.Printer("zebra://192.0.2.2:9100", zebra_send=capture, zebra_query=slow_query)
        first = bg.print_label(png)["job"]
        self.assertEqual(first["state"], "sent")
        self.assertTrue(first["checking"])
        self.assertIn("Waiting for the printer", first["detail"])
        bg.wait_for_checks(5)
        self.assertEqual(bg.job(first["id"])["state"], "ready")

    def test_zebra_link_keeps_one_connection_and_reads_split_and_queued_replies(self):
        import socket
        import milk as milk_mod
        busy = b"\x02030,0,0,0210,001,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000001,1,000\x03\r\n\x021234,0\x03\r\n"
        ready = b"\x02030,0,0,0210,000,0,0,0,000,0,0,0\x03\r\n\x02000,0,0,0,0,2,1,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n"
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        asks = []

        def printer():
            conn, _ = srv.accept()
            with conn:
                conn.settimeout(5)
                while True:
                    try:
                        data = conn.recv(64)
                    except socket.timeout:
                        return
                    if not data:
                        return
                    asks.append(data)
                    if len(asks) == 1:
                        time.sleep(0.4)  # the slow relay: the reply lands late, in two pieces, with the next one right behind
                        conn.sendall(busy[:30])
                        time.sleep(0.1)
                        conn.sendall(busy[30:] + ready)

        threading.Thread(target=printer, daemon=True).start()
        link = milk_mod.ZebraLink("127.0.0.1", srv.getsockname()[1])
        try:
            link.send(b"^XA^XZ~HS")  # the question travels with the label
            self.assertEqual(link.read(0.2), b"")  # nothing yet
            first = link.read(2)
            self.assertEqual(milk_mod.describe_host_status(milk_mod.parse_host_status(first))[0], "busy")
            second = link.ask(0.5)  # already queued on the same connection
            self.assertEqual(milk_mod.describe_host_status(milk_mod.parse_host_status(second))[0], "ready")
            self.assertEqual(link.ask(0.2), b"")
        finally:
            link.close()
            srv.close()
        self.assertEqual(asks[:1], [b"^XA^XZ~HS"])

    def test_print_job_endpoint_for_backends_without_printer_state(self):
        import milk as milk_mod
        png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()
        outdir = os.path.join(self.tmp.name, "labels-jobs")
        self.app.printer = milk_mod.Printer(f"file://{outdir}")
        try:
            status, res = self.call("POST", "/print/label", {"png": png, "code": "AB23CD"})
            self.assertEqual(status, 200)
            job = res["job"]
            self.assertEqual((job["backend"], job["state"], job["checking"]), ("file", "sent", False))
            self.assertIn("file", job["detail"])
            self.assertEqual(self.call("GET", f"/print/job/{job['id']}")[1], job)
            self.assertEqual(self.call("GET", f"/print/job/{job['id'] + 999}")[0], 404)
            self.assertEqual(self.call("GET", "/print/job/x")[0], 400)
            # a bad bag code is ignored for the log line, never an error
            self.assertEqual(self.call("POST", "/print/label", {"png": png, "code": "x" * 50})[0], 200)
        finally:
            self.app.printer = milk_mod.Printer(None)

    def test_bridge_backend_forwards_png_and_surfaces_bridge_errors(self):
        import milk as milk_mod
        seen = {}

        class FakeBridge(BaseHTTPRequestHandler):
            def _json(self, status, body):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                seen["auth"] = self.headers.get("Authorization")
                if self.headers.get("Authorization") != "Bearer secret":
                    return self._json(401, {"detail": "bad bridge token"})
                return self._json(200, {"configured": True, "kind": "niimbot", "detail": None, "target": "niimbot://bluetooth/AA:BB"})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])).decode())
                seen["png"] = body["png"]
                if b"fail" in base64.b64decode(body["png"]):
                    return self._json(503, {"detail": "Could not reach the Niimbot over Bluetooth AA:BB"})
                return self._json(200, {"ok": True, "printed": "niimbot b1 via bluetooth AA:BB"})

            def log_message(self, *a):
                pass

        srv = HTTPServer(("127.0.0.1", 0), FakeBridge)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            good = milk_mod.Printer(f"bridge://127.0.0.1:{srv.server_port}?token=secret")
            st = good.status()
            self.assertTrue(st["configured"])
            self.assertIn("niimbot://bluetooth/AA:BB", st["target"])
            png = b"\x89PNG\r\n\x1a\n" + b"0" * 16
            self.assertEqual(good.print_png(png)["printed"], "niimbot b1 via bluetooth AA:BB")
            self.assertEqual(base64.b64decode(seen["png"]), png)
            with self.assertRaises(milk_mod.PrinterError) as ctx:
                good.print_png(b"\x89PNG\r\n\x1a\n" + b"0" * 8 + b"fail")
            self.assertIn("Could not reach the Niimbot", str(ctx.exception))
            bad = milk_mod.Printer(f"bridge://127.0.0.1:{srv.server_port}?token=wrong")
            self.assertFalse(bad.status()["configured"])
            self.assertIn("bad bridge token", bad.status()["detail"])
            down = milk_mod.Printer("bridge://127.0.0.1:1?token=x")
            self.assertIn("not reachable", down.status()["detail"])
        finally:
            srv.shutdown()
            srv.server_close()

    def test_print_bridge_checks_its_token_and_prints_one_label_at_a_time(self):
        from http.server import ThreadingHTTPServer

        import print_bridge

        state = {"now": 0, "most": 0}
        lock = threading.Lock()

        class SlowPrinter:
            def status(self):
                return {"configured": True, "kind": "niimbot", "detail": None}

            def print_png(self, png):
                with lock:
                    state["now"] += 1
                    state["most"] = max(state["most"], state["now"])
                time.sleep(0.15)
                with lock:
                    state["now"] -= 1
                return {"ok": True, "printed": "fake"}

        saved = (print_bridge.TOKEN, print_bridge.PRINTER)
        print_bridge.TOKEN, print_bridge.PRINTER = "bridge-secret", SlowPrinter()
        srv = ThreadingHTTPServer(("127.0.0.1", 0), print_bridge.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            def post(token):
                body = json.dumps({"png": base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 16).decode()}).encode()
                req = urllib.request.Request(f"http://127.0.0.1:{srv.server_port}/print", data=body, method="POST")
                req.add_header("Authorization", f"Bearer {token}")
                try:
                    with urllib.request.urlopen(req) as res:
                        return res.status
                except urllib.error.HTTPError as e:
                    e.close()
                    return e.code

            self.assertEqual(post("wrong"), 401)
            self.assertEqual(post("bridge-secret-and-more"), 401)
            results = []
            threads = [threading.Thread(target=lambda: results.append(post("bridge-secret"))) for _ in range(3)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(results, [200, 200, 200])
            self.assertEqual(state["most"], 1)
        finally:
            print_bridge.TOKEN, print_bridge.PRINTER = saved
            srv.shutdown()
            srv.server_close()

    def test_bridge_role_gives_pairing_hint(self):
        import milk as milk_mod
        self.assertIn("bluetoothctl", milk_mod.Printer(None, role="bridge").status()["detail"])
        self.assertIn("bridge://", milk_mod.Printer(None).status()["detail"])

    def test_vendored_niimbot_driver_imports(self):
        try:
            import PIL  # noqa: F401
        except Exception:
            self.skipTest("Pillow not installed here")
        import niimbot_proto
        self.assertTrue(hasattr(niimbot_proto, "PrinterClient"))
        self.assertTrue(hasattr(niimbot_proto, "BluetoothTransport"))

    def test_printer_spec_parses_and_health_hides_target(self):
        import milk as milk_mod
        p = milk_mod.Printer("brother_ql://tcp/192.0.2.50:9100?model=QL-810W&label=29x62")
        self.assertEqual(p.kind, "brother_ql")  # urlparse would reject the underscore
        self.assertEqual(p.status()["target"], "brother_ql://tcp/192.0.2.50:9100")
        self.app.printer = p
        try:
            health = self.call("GET", "/health", token=None)[1]
            self.assertNotIn("target", health["printer"])
            self.assertEqual(health["printer"]["kind"], "brother_ql")
            self.assertIn("target", self.call("GET", "/print/status")[1])
        finally:
            self.app.printer = milk_mod.Printer(None)

    def test_milk_windows_from_label_settings_change_expiry(self):
        pumped = datetime.now(timezone.utc).isoformat(timespec="seconds")
        bag = self.call("POST", "/milk", {"child": 1, "pumped_at": pumped, "volume_ml": 100, "windows": {"fridgeDays": 3, "roomHours": 6, "freezerMonths": 12}})[1]
        self.assertAlmostEqual((bs.parse_iso(bag["expires_at"]) - bs.parse_iso(pumped)).total_seconds(), 3 * 86400, delta=2)
        room = self.call("PATCH", f"/milk/{bag['id']}", {"location": "room", "windows": {"roomHours": 6}})[1]
        self.assertAlmostEqual((bs.parse_iso(room["expires_at"]) - bs.parse_iso(pumped)).total_seconds(), 6 * 3600, delta=2)

    def test_print_status_and_file_backend(self):
        status, health = self.call("GET", "/health", token=None)
        self.assertIn("printer", health)
        self.assertFalse(health["printer"]["configured"])
        st = self.call("GET", "/print/status")[1]
        self.assertFalse(st["configured"])
        self.assertIn("BRAMBLE_PRINTER", st["detail"])
        png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()
        self.assertEqual(self.call("POST", "/print/label", {"png": png})[0], 503)
        self.assertEqual(self.call("POST", "/print/label", {"png": "bm90IGEgcG5n"})[0], 400)
        # file backend writes the PNG
        import milk as milk_mod
        outdir = os.path.join(self.tmp.name, "labels")
        self.app.printer = milk_mod.Printer(f"file://{outdir}")
        try:
            self.assertTrue(self.call("GET", "/print/status")[1]["configured"])
            status, res = self.call("POST", "/print/label", {"png": "data:image/png;base64," + png})
            self.assertEqual(status, 200)
            self.assertTrue(os.path.exists(res["printed"]))
        finally:
            self.app.printer = milk_mod.Printer(None)

    # ---- sweep 2026-10-10 regressions
    def _fridge_bag(self, ml=100.0) -> dict:
        pumped = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds")
        return self.app.milk.create({"child": 1, "pumped_at": pumped, "volume_ml": ml, "location": "fridge"}, 7)

    def test_set_takes_judges_each_bag_as_it_is_inside_the_lock(self):
        import milk as milk_mod

        milk = self.app.milk
        b = self._fridge_bag(100)
        real_get = milk.get
        raced = {"done": False}

        def racing_get(bag_id):
            row = real_get(bag_id)
            if not raced["done"]:
                raced["done"] = True  # the other phone's bottle lands between this request's read and its lock
                milk.set_takes(901, [{"bag": b["id"], "amount_ml": 80}], 8)
            return row

        milk.get = racing_get
        try:
            with self.assertRaises(milk_mod.MilkError) as ctx:
                milk.set_takes(902, [{"bag": b["id"], "amount_ml": 80}], 7)
        finally:
            milk.get = real_get
        self.assertIn("Only 20 mL", str(ctx.exception))
        self.assertEqual(milk.for_feeding(902)["takes"], [])
        self.assertEqual(milk.get(b["id"])["remaining_ml"], 20)

    def test_a_bottle_from_a_bag_discarded_later_can_still_be_corrected_down(self):
        import milk as milk_mod

        milk = self.app.milk
        b = self._fridge_bag(120)
        milk.set_takes(77, [{"bag": b["id"], "amount_ml": 40}], 7)
        milk.patch(b["id"], {"status": "discarded"}, 7, None)
        # 40 -> 30 mL: nothing new comes out of the bag; it stays discarded with the 10 mL back on its record.
        self.assertEqual(milk.set_takes(77, [{"bag": b["id"], "amount_ml": 30}], 7)["total_ml"], 30)
        bag = milk.get(b["id"])
        self.assertEqual((bag["status"], bag["remaining_ml"]), ("discarded", 90))
        self.assertEqual(milk.set_takes(77, [{"bag": b["id"], "amount_ml": 30}], 7)["total_ml"], 30)  # unchanged: fine
        with self.assertRaises(milk_mod.MilkError):
            milk.set_takes(77, [{"bag": b["id"], "amount_ml": 50}], 7)  # more than it took: refused
        with self.assertRaises(milk_mod.MilkError):
            milk.set_takes(78, [{"bag": b["id"], "amount_ml": 10}], 7)  # a new bottle: refused
        self.assertEqual(milk.set_takes(77, [], 7)["takes"], [])  # deleting the bottle still gives it back
        self.assertEqual(milk.get(b["id"])["status"], "discarded")

    def test_milk_uses_gets_its_feeding_index_on_a_database_from_before_it(self):
        import sqlite3

        import milk as milk_mod

        path = os.path.join(self.tmp.name, "uses-before-index.db")
        old = sqlite3.connect(path)
        old.executescript(milk_mod.SCHEMA.replace("CREATE INDEX IF NOT EXISTS milk_uses_by_feeding", "-- "))
        old.execute("INSERT INTO milk_uses (bag, feeding_id, amount_ml, kind, at, by_user) VALUES (1, 55, 40, 'bottle', '2026-10-01T00:00:00+00:00', 7)")
        old.commit()
        self.assertNotIn("milk_uses_by_feeding", {r[1] for r in old.execute("PRAGMA index_list(milk_uses)")})
        old.close()
        store = bs.Store(path)
        try:
            milk_mod.MilkStore(store, bs.parse_iso, bs.utc_iso, bs.now_iso)
            self.assertIn("milk_uses_by_feeding", {r["name"] for r in store.q("PRAGMA index_list(milk_uses)")})
            self.assertEqual(store.q("SELECT feeding_id, amount_ml FROM milk_uses"), [{"feeding_id": 55, "amount_ml": 40}])
            milk_mod.MilkStore(store, bs.parse_iso, bs.utc_iso, bs.now_iso)  # twice is fine
        finally:
            store.conn.close()

    def test_a_zebra_port_typo_is_a_printer_problem_not_an_invalid_label(self):
        import milk as milk_mod

        self.app.printer = milk_mod.Printer("zebra://127.0.0.1:91OO")  # letter O typed for zero
        try:
            self.assertFalse(self.app.printer.status()["configured"])
            self.assertIn("port", self.app.printer.status()["detail"])
            png = base64.b64encode(self._png()).decode()
            status, body = self.call("POST", "/print/label", {"png": png})
            self.assertEqual(status, 503)
            self.assertIn("port", body["detail"])
        finally:
            self.app.printer = milk_mod.Printer(None)

    def _png(self) -> bytes:
        try:
            from PIL import Image
        except Exception:
            self.skipTest("Pillow not installed here")
        buf = io.BytesIO()
        Image.new("L", (16, 8), 255).save(buf, "PNG")
        return buf.getvalue()

    def test_public_health_asks_the_bridge_once_a_minute_and_never_shows_its_address(self):
        import milk as milk_mod

        hits = []

        class Bridge(BaseHTTPRequestHandler):
            def do_GET(self):
                hits.append(self.path)
                data = json.dumps({"configured": True, "kind": "niimbot", "detail": None, "target": "niimbot://bluetooth/AA:BB"}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        srv = HTTPServer(("127.0.0.1", 0), Bridge)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            self.app.printer = milk_mod.Printer(f"bridge://127.0.0.1:{srv.server_port}?token=SEKRET")
            for _ in range(3):
                health = self.call("GET", "/health", token=None)[1]
            self.assertEqual(len(hits), 1)
            self.assertEqual(health["printer"], {"configured": True, "kind": "bridge", "detail": None})
            self.app.printer._public = (time.monotonic() - 61, self.app.printer._public[1])  # a minute later
            self.call("GET", "/health", token=None)
            self.assertEqual(len(hits), 2)
            self.assertTrue(self.call("GET", "/print/status")[1]["configured"])  # the authenticated status asks live
            self.assertEqual(len(hits), 3)
            # The bridge down: the public answer says so without the host's address.
            self.app.printer = milk_mod.Printer("bridge://127.0.0.1:1?token=SEKRET")
            text = json.dumps(self.call("GET", "/health", token=None)[1]["printer"])
            self.assertIn("not reachable", text)
            self.assertNotIn("127.0.0.1", text)
            self.assertNotIn("SEKRET", text)
        finally:
            self.app.printer = milk_mod.Printer(None)
            srv.shutdown()
            srv.server_close()

    def test_public_health_leaves_urls_and_paths_out_of_the_last_push_error(self):
        saved = (self.delivery.last_error, self.delivery.last_error_at)
        try:
            self.delivery.last_error = "error: ConnectionError: HTTPSConnectionPool(host='web.push.apple.com', port=443): Max retries exceeded with url: /QGx1SubscriptionToken (Caused by x) https://push.example/abc"
            err = self.call("GET", "/health", token=None)[1]["lastPushError"]
            self.assertNotIn("QGx1SubscriptionToken", err)
            self.assertNotIn("push.example/abc", err)
            self.assertIn("Max retries exceeded", err)
            self.delivery.last_error = "410: Gone"
            self.assertEqual(self.call("GET", "/health", token=None)[1]["lastPushError"], "410: Gone")
        finally:
            self.delivery.last_error, self.delivery.last_error_at = saved

    def test_settings_put_keeps_the_keys_it_did_not_send(self):
        units = {"volume": "ml", "weight": "lb", "temp": "f", "length": "in"}
        self.call("PUT", "/settings/3", {"storageUnits": units, "pumps": []})
        status, body = self.call("PUT", "/settings/3", {"pumps": [{"name": "Eufy", "minutes": 30}]})
        self.assertEqual((status, body["storageUnits"]), (200, units))
        self.assertEqual(self.call("GET", "/settings/3")[1], {"storageUnits": units, "pumps": [{"name": "Eufy", "minutes": 30}]})

    def test_storage_units_are_recorded_once(self):
        # sweep 2026-10-21: a phone that missed the shared copy could write its own units over the household's
        units = {"volume": "ml", "weight": "lb", "temp": "f", "length": "in"}
        self.call("PUT", "/settings/4", {"storageUnits": units})
        status, body = self.call("PUT", "/settings/4", {"storageUnits": {"volume": "oz", "weight": "kg", "temp": "c", "length": "cm"}, "stashGoalDays": 3})
        self.assertEqual((status, body["storageUnits"], body["stashGoalDays"]), (200, units, 3))

    def test_a_night_bottle_is_fed_whole_even_from_an_old_phone(self):
        # sweep 2026-10-21: an app build without premade bottles could take part of one
        bag = self._bag(100)
        made = self.call("POST", "/milk/bottles", {"child": 1, "bottles": [{"spot": 4, "takes": [{"bag": bag["id"], "amount_ml": 90}], "client_key": "sweep-whole-0001"}]})[1]
        bottle = made[0]
        status, body = self.call("PUT", "/milk/feeding/9901", {"takes": [{"bag": bottle["id"], "amount_ml": 40}]})
        self.assertEqual(status, 400)
        self.assertIn("fed whole", body["detail"])
        self.assertEqual(self.call("PUT", "/milk/feeding/9901", {"takes": [{"bag": bottle["id"], "amount_ml": 90}]})[0], 200)
        self.assertEqual(self.call("GET", f"/milk/{bottle['id']}")[1]["status"], "used")

    def test_a_premade_bottle_can_be_undone_and_its_milk_goes_back_in_the_bags(self):
        a = self._bag(60)
        b = self._bag(100)
        made = self.call("POST", "/milk/bottles", {"child": 1, "bottles": [{"spot": 2, "takes": [{"bag": a["id"], "amount_ml": 60}, {"bag": b["id"], "amount_ml": 30}], "client_key": "undo-bottle-0001"}]})[1]
        bottle = made[0]
        self.assertEqual(self.call("GET", f"/milk/{a['id']}")[1]["status"], "used")  # emptied by the pour
        status, bags = self.call("POST", f"/milk/{bottle['id']}/unmake", {})
        self.assertEqual(status, 200)
        self.assertEqual(sorted(x["id"] for x in bags), sorted([a["id"], b["id"]]))
        again_a = self.call("GET", f"/milk/{a['id']}")[1]
        again_b = self.call("GET", f"/milk/{b['id']}")[1]
        self.assertEqual((again_a["status"], again_a["remaining_ml"]), ("stored", 60))
        self.assertEqual((again_b["status"], again_b["remaining_ml"]), ("stored", 100))
        self.assertEqual(self.call("GET", f"/milk/{bottle['id']}")[0], 404)
        self.assertEqual(self.app.store.q("SELECT COUNT(*) AS n FROM milk_uses WHERE into_bag=?", (bottle["id"],))[0]["n"], 0)
        self.assertEqual(self.app.store.q("SELECT COUNT(*) AS n FROM reminders WHERE tag=? AND sent=0", (f"milk:{bottle['id']}",))[0]["n"], 0)
        # The spot is free again: a new bottle can go in it.
        self.assertEqual(self.call("POST", "/milk/bottles", {"child": 1, "bottles": [{"spot": 2, "takes": [{"bag": b["id"], "amount_ml": 50}], "client_key": "undo-bottle-0002"}]})[0], 201)

    def test_a_premade_bottle_already_fed_from_cannot_be_undone(self):
        bag = self._bag(100)
        bottle = self.call("POST", "/milk/bottles", {"child": 1, "bottles": [{"spot": 3, "takes": [{"bag": bag["id"], "amount_ml": 90}], "client_key": "undo-bottle-0003"}]})[1][0]
        self.assertEqual(self.call("PUT", "/milk/feeding/9902", {"takes": [{"bag": bottle["id"], "amount_ml": 90}]})[0], 200)
        status, body = self.call("POST", f"/milk/{bottle['id']}/unmake", {})
        self.assertEqual(status, 400)
        self.assertIn("already fed", body["detail"])
        self.assertEqual(self.call("GET", f"/milk/{bag['id']}")[1]["remaining_ml"], 10)  # nothing changed
        # A plain bag is not a bottle; a missing one is a 404.
        self.assertEqual(self.call("POST", f"/milk/{bag['id']}/unmake", {})[0], 400)
        self.assertEqual(self.call("POST", "/milk/999999/unmake", {})[0], 404)

    def test_sent_reminders_older_than_thirty_days_are_pruned_once_a_day(self):
        now = datetime.now(timezone.utc)
        old = (now - timedelta(days=400)).isoformat(timespec="seconds")
        recent = (now - timedelta(days=3)).isoformat(timespec="seconds")
        later = (now + timedelta(days=60)).isoformat(timespec="seconds")
        for at, sent in [(old, 1)] * 50 + [(recent, 1), (later, 0)]:
            self.app.store.x("INSERT INTO reminders (child, at, title, body, tag, source, sent, created) VALUES (1,?,?,?,?,?,?,?)", (at, "x", "", "nudge:activity", "nudge", sent, old))
        self.delivery._pruned_at = None
        self.delivery.run_once(now)
        self.assertEqual(sorted(r["at"] for r in self.app.store.q("SELECT at FROM reminders")), [recent, later])
        # Not again within the day.
        self.app.store.x("INSERT INTO reminders (child, at, title, body, tag, source, sent, created) VALUES (1,?,?,?,?,?,1,?)", (old, "x", "", "t", "nudge", old))
        self.delivery.run_once(now + timedelta(hours=1))
        self.assertEqual(len(self.app.store.q("SELECT 1 FROM reminders")), 3)
        self.delivery.run_once(now + timedelta(days=1, minutes=1))
        self.assertEqual(len(self.app.store.q("SELECT 1 FROM reminders")), 2)
        self.assertIn("reminders_anchor", {r["name"] for r in self.app.store.q("PRAGMA index_list(reminders)")})

    def test_non_string_push_fields_are_a_400(self):
        cases = [
            ("subscribe", {"subscription": {"endpoint": {"x": 1}, "keys": {"p256dh": "k", "auth": "a"}}}),
            ("subscribe", {"subscription": {"endpoint": "https://e", "keys": {"p256dh": ["k"], "auth": "a"}}}),
            ("subscribe", {"subscription": {"endpoint": "https://e", "keys": {"p256dh": "k", "auth": 5}}}),
            ("unsubscribe", {"endpoint": ["https://e"]}),
            ("status", {"endpoint": {"a": 1}}),
            ("test", {"endpoint": {"a": 1}}),
        ]
        for action, body in cases:
            with self.subTest(action=action, body=body):
                self.assertEqual(self.call("POST", f"/push/{action}", body)[0], 400)
        self.assertEqual(self.app.store.q("SELECT COUNT(*) AS n FROM subscriptions")[0]["n"], 0)

    def test_store_atomic_rolls_back_on_error_and_commits_otherwise(self):
        store = self.app.store
        with self.assertRaises(RuntimeError):
            with store.atomic():
                store.x("INSERT INTO settings (child, blob) VALUES (?, ?)", (9001, "{}"))
                raise RuntimeError("boom")
        self.assertEqual(store.q("SELECT COUNT(*) AS n FROM settings WHERE child=9001")[0]["n"], 0)
        with store.atomic():
            store.x("INSERT INTO settings (child, blob) VALUES (?, ?)", (9001, "{}"))
            # nested q()/x() inside the transaction must not deadlock on the store lock
            self.assertEqual(store.q("SELECT COUNT(*) AS n FROM settings WHERE child=9001")[0]["n"], 1)
        self.assertEqual(store.q("SELECT COUNT(*) AS n FROM settings WHERE child=9001")[0]["n"], 1)
        store.x("DELETE FROM settings WHERE child=9001")

    def test_schedule_replaces_auto_but_keeps_manual(self):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(timespec="seconds")
        self.call("POST", "/reminders", {"child": 1, "at": future, "title": "Manual", "tag": "manual"})
        self.call("POST", "/push/schedule", {"child": 1, "items": [{"tag": "sweetspot-near", "at": future, "title": "Near"}, {"tag": "sweetspot", "at": future, "title": "Now"}]})
        titles = sorted(r["title"] for r in self.call("GET", "/reminders?child=1")[1])
        self.assertEqual(titles, ["Manual", "Near", "Now"])
        status, body = self.call("POST", "/push/schedule", {"child": 1, "items": [{"tag": "sweetspot", "at": future, "title": "Later"}]})
        self.assertEqual(status, 200)
        self.assertEqual([r["title"] for r in body["scheduled"]], ["Later"])
        titles = sorted(r["title"] for r in self.call("GET", "/reminders?child=1")[1])
        self.assertEqual(titles, ["Later", "Manual"])
        # clearing the schedule removes stale auto reminders entirely
        self.call("POST", "/push/schedule", {"child": 1, "items": []})
        self.assertEqual([r["title"] for r in self.call("GET", "/reminders?child=1")[1]], ["Manual"])
        # auto reminders can be deleted individually too
        rid = self.call("POST", "/push/schedule", {"child": 1, "items": [{"tag": "t", "at": future, "title": "A"}]})[1]["scheduled"][0]["id"]
        self.assertEqual(self.call("DELETE", f"/reminders/{rid}")[0], 204)

    # ---- push
    def subscribe(self, endpoint, child=1):
        return self.call("POST", "/push/subscribe", {"child": child, "subscription": {"endpoint": endpoint, "keys": {"p256dh": "p", "auth": "a"}}})

    def test_subscribe_upserts_and_unsubscribes(self):
        self.assertEqual(self.subscribe("https://push/1", child=1)[0], 200)
        self.assertEqual(self.subscribe("https://push/1", child=2)[0], 200)
        rows = self.app.store.q("SELECT * FROM subscriptions")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["child"], 2)
        self.assertEqual(rows[0]["user_id"], 7)
        self.assertEqual(self.call("POST", "/push/subscribe", {"subscription": {"endpoint": "x"}})[0], 400)
        self.assertEqual(self.call("POST", "/push/unsubscribe", {"endpoint": "https://push/1"})[0], 200)
        self.assertEqual(self.app.store.q("SELECT * FROM subscriptions"), [])

    def test_push_test_sends_to_users_subscriptions(self):
        self.subscribe("https://push/a")
        self.subscribe("https://push/b", child=None)
        status, body = self.call("POST", "/push/test")
        self.assertEqual(status, 200)
        self.assertEqual(body["sent"], 2)
        self.assertEqual(body["errors"], [])
        self.assertEqual(sorted(e for e, _ in self.sent), ["https://push/a", "https://push/b"])
        self.assertEqual(self.sent[0][1]["tag"], "test")

    def test_push_test_reports_errors_and_unregistered_device(self):
        self.subscribe("https://push/a")
        self.fail_with = {"https://push/a": 403}
        status, body = self.call("POST", "/push/test", {"endpoint": "https://push/a"})
        self.assertEqual(body["sent"], 0)
        self.assertEqual(body["subscriptions"], 1)
        self.assertEqual(len(body["errors"]), 1)
        status, body = self.call("POST", "/push/test", {"endpoint": "https://push/unknown"})
        self.assertEqual(body["subscriptions"], 0)
        self.assertIn("not registered", body["errors"][0])

    def test_push_status_reports_registration(self):
        self.subscribe("https://push/a", child=4)
        status, body = self.call("POST", "/push/status", {"endpoint": "https://push/a"})
        self.assertEqual((status, body["registered"], body["child"]), (200, True, 4))
        self.assertFalse(self.call("POST", "/push/status", {"endpoint": "https://push/none"})[1]["registered"])

    def test_transport_error_does_not_abort_batch(self):
        self.subscribe("https://push/boom", child=1)
        self.subscribe("https://push/ok", child=1)
        orig = bs.send_push

        def exploding(sub, payload, vapid):
            if sub["endpoint"].endswith("boom"):
                raise bs.PushSendError(None, "ConnectionError: dns")
            return orig(sub, payload, vapid)

        bs.send_push = exploding
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec="seconds")
        self.call("POST", "/reminders", {"child": 1, "at": past, "title": "Due", "tag": "due"})
        self.call("POST", "/reminders", {"child": 1, "at": past, "title": "Due2", "tag": "due2"})
        self.assertEqual(self.delivery.run_once(), 2)
        self.assertEqual(sorted(e for e, _ in self.sent), ["https://push/ok", "https://push/ok"])
        self.assertIn("ConnectionError", self.delivery.last_error)

    def test_delivery_sends_due_once_per_subscription(self):
        self.subscribe("https://push/child1", child=1)
        self.subscribe("https://push/any", child=None)
        self.subscribe("https://push/child2", child=2)
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec="seconds")
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(timespec="seconds")
        self.call("POST", "/reminders", {"child": 1, "at": past, "title": "Due", "body": "now", "tag": "due"})
        self.call("POST", "/reminders", {"child": 1, "at": future, "title": "Later", "tag": "later"})
        processed = self.delivery.run_once()
        self.assertEqual(processed, 1)
        # every caregiver phone in the household gets it, whichever child it was enabled on
        endpoints = sorted(e for e, _ in self.sent)
        self.assertEqual(endpoints, ["https://push/any", "https://push/child1", "https://push/child2"])
        self.assertEqual(self.sent[0][1]["title"], "Due")
        self.assertEqual(self.sent[0][1]["child"], 1)
        rows = {r["title"]: r["sent"] for r in self.call("GET", "/reminders?child=1")[1]}
        self.assertEqual(rows, {"Due": True, "Later": False})
        # second run does not resend
        self.sent.clear()
        self.assertEqual(self.delivery.run_once(), 0)
        self.assertEqual(self.sent, [])

    def test_stale_reminders_marked_sent_without_sending(self):
        self.subscribe("https://push/child1", child=1)
        stale = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat(timespec="seconds")
        self.call("POST", "/reminders", {"child": 1, "at": stale, "title": "Old", "tag": "old"})
        self.assertEqual(self.delivery.run_once(), 1)
        self.assertEqual(self.sent, [])
        self.assertTrue(self.app.store.q("SELECT sent FROM reminders")[0]["sent"])

    def test_dead_subscription_removed_on_404_or_410(self):
        self.subscribe("https://push/dead410", child=1)
        self.subscribe("https://push/dead404", child=1)
        self.subscribe("https://push/flaky", child=1)
        self.subscribe("https://push/alive", child=1)
        self.fail_with = {"https://push/dead410": 410, "https://push/dead404": 404, "https://push/flaky": 500}
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec="seconds")
        self.call("POST", "/reminders", {"child": 1, "at": past, "title": "Due", "tag": "due"})
        self.delivery.run_once()
        remaining = sorted(r["endpoint"] for r in self.app.store.q("SELECT endpoint FROM subscriptions"))
        self.assertEqual(remaining, ["https://push/alive", "https://push/flaky"])

    def test_vapid_private_key_is_never_regenerated(self):
        d = tempfile.mkdtemp(dir=self.tmp.name)
        v1 = bs.Vapid(d)
        if not v1.has_keys:
            self.skipTest("no crypto libs")
        with open(v1.private_key_path, "rb") as fh:
            private = fh.read()
        os.remove(v1.public_key_path)
        v2 = bs.Vapid(d)
        with open(v2.private_key_path, "rb") as fh:
            self.assertEqual(fh.read(), private)
        self.assertEqual(v2.public_key_b64, v1.public_key_b64)
        self.assertEqual(oct(os.stat(v1.private_key_path).st_mode & 0o777), "0o600")

    def test_send_push_without_libs_raises(self):
        bs.send_push = self._orig
        if bs._load_webpush()[0] is None:
            with self.assertRaises(bs.PushSendError):
                bs.send_push({"endpoint": "x", "keys": {}}, {}, self.app.vapid)


# The Hatch Grow import has its own file (test_hatch.py); imported here so this file's command runs it too.
from test_hatch import HatchApiTest, HatchTest  # noqa: E402,F401


if __name__ == "__main__":
    unittest.main()
