"""Tests for the data-driven reminders (nudges.py) against a fake Baby Buddy with feedings, pumping,
diapers and sleep. Run on their own (`python3 -m unittest server/test_nudges.py`) or with the rest."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bramble_server as bs  # noqa: E402
import nudges as nd  # noqa: E402

TZ = timezone(timedelta(hours=-4))  # a fixed "America/New_York in summer" so clock text is predictable
NOW = datetime(2026, 10, 7, 15, 0, tzinfo=TZ)  # 3:00 PM local
CHILD = 3


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


class World:
    def __init__(self):
        self.reset()

    def reset(self):
        self.tokens = {"good": {"id": 7, "username": "sara"}, "dad": {"id": 8, "username": "tom"}}
        self.children = [{"id": CHILD, "first_name": "Oscar", "last_name": "V", "birth_date": (NOW - timedelta(days=24)).date().isoformat()}]
        self.rows: dict[str, list[dict]] = {"feedings": [], "pumping": [], "changes": [], "sleep": []}
        self.next = 100

    def add(self, kind: str, **row) -> dict:
        self.next += 1
        row = {"id": self.next, "child": CHILD, "tags": [], "notes": "", **row}
        self.rows[kind].append(row)
        return row

    def feed(self, hours_ago: float, amount=60.0, method="bottle", **extra) -> dict:
        start = NOW - timedelta(hours=hours_ago)
        return self.add("feedings", start=iso(start), end=iso(start + timedelta(minutes=15)), type="breast milk", method=method, amount=amount, **extra)

    def pump(self, hours_ago: float, amount=45.0, who="sara") -> dict:
        start = NOW - timedelta(hours=hours_ago)
        return self.add("pumping", start=iso(start), end=iso(start + timedelta(minutes=20)), amount=amount, tags=[{"name": f"caregiver:{who}"}])

    def diaper(self, hours_ago: float, wet=True, solid=False) -> dict:
        return self.add("changes", time=iso(NOW - timedelta(hours=hours_ago)), wet=wet, solid=solid, color="", amount=None)

    def sleep(self, start_ago: float, end_ago: float) -> dict:
        return self.add("sleep", start=iso(NOW - timedelta(hours=start_ago)), end=iso(NOW - timedelta(hours=end_ago)), nap=True)


W = World()


class FakeBabyBuddy(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        token = (self.headers.get("Authorization") or "")[6:]
        user = W.tokens.get(token)
        if not user:
            return self._send(403, {"detail": "Invalid token."})
        url = urlparse(self.path)
        if url.path == "/api/profile":
            return self._send(200, {"user": {**user, "is_staff": True}})
        q = {k: v[-1] for k, v in parse_qs(url.query).items()}
        name = url.path.strip("/").split("/")[1]
        if name == "children":
            return self._send(200, {"count": len(W.children), "results": W.children})
        rows = W.rows.get(name, [])
        since = q.get("start_min") or q.get("date_min")
        if since:
            rows = [r for r in rows if (r.get("start") or r.get("time")) >= since]
        return self._send(200, {"count": len(rows), "results": rows})


class NudgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bb = ThreadingHTTPServer(("127.0.0.1", 0), FakeBabyBuddy)
        threading.Thread(target=cls.bb.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.app, cls.delivery = bs.build(os.path.join(cls.tmp.name, "t.db"), os.path.join(cls.tmp.name, "vapid"), f"http://127.0.0.1:{cls.bb.server_port}")
        cls.app.nudges.tz = TZ
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
        W.reset()
        self.sent = []
        self._orig = bs.send_push
        bs.send_push = lambda sub, payload, vapid: self.sent.append((sub["endpoint"], payload))
        for t in ("reminders", "subscriptions", "settings", "nudge_settings", "nudge_seen", "milk_bags", "milk_uses", "people", "hatch_weights", "server_config"):
            self.app.store.x(f"DELETE FROM {t}")
        self.n = self.app.nudges
        self.n.secrets.clear()
        self.n.secrets.update(bb_token="good", user_id="7")
        self.n.problem = None
        self.n.status_notes = {}
        self.app.store.x("INSERT INTO settings (child, blob) VALUES (?, ?)", (CHILD, json.dumps({"storageUnits": {"volume": "ml", "weight": "lb", "temp": "f", "length": "in"}})))
        self.subscribe("https://push.example/mom", 7)
        self.subscribe("https://push.example/dad", 8)

    def tearDown(self):
        bs.send_push = self._orig

    def subscribe(self, endpoint: str, user_id: int):
        self.app.store.x("INSERT INTO subscriptions (endpoint, user_id, child, p256dh, auth, created) VALUES (?,?,?,?,?,?)", (endpoint, user_id, CHILD, "k", "a", bs.now_iso()))

    def rows(self, tag: str | None = None, sent: int | None = None) -> list[dict]:
        sql, params = "SELECT * FROM reminders WHERE 1=1", []
        if tag:
            sql, params = sql + " AND tag=?", [tag]
        if sent is not None:
            sql, params = sql + " AND sent=?", [*params, sent]
        return self.app.store.q(sql + " ORDER BY at", params)

    def call(self, method, path, body=None, token="good"):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Token {token}")
        try:
            with urllib.request.urlopen(req) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            e.close()
            return e.code, (json.loads(raw) if raw else None)

    # ---- cadence maths
    def test_median_gap_is_clamped_to_the_age_typical_range(self):
        starts = [NOW - timedelta(hours=h) for h in (9, 6.2, 3.1, 0.3)]  # gaps 2.8, 3.1, 2.8 -> median 2.8 h
        gap, n = nd.cadence(starts, NOW, nd.feed_gap_bounds(0.8, 24))
        self.assertEqual(n, 4)
        self.assertAlmostEqual(gap.total_seconds() / 3600, 2.8, places=2)
        # Six-hour gaps for a newborn are clamped to the top of the 8–12 feeds/day range (3 h).
        gap, _ = nd.cadence([NOW - timedelta(hours=h) for h in (12, 6, 0)], NOW, nd.feed_gap_bounds(0.8, 24))
        self.assertEqual(gap, timedelta(hours=3))
        # A 2-month-old: 6–8 feeds a day -> 3–4 h.
        self.assertEqual(nd.feed_gap_bounds(2.5, 76), (3, 4))
        # Below two feeds in two days there is no cadence at all.
        self.assertEqual(nd.cadence([NOW - timedelta(hours=1)], NOW, (2, 3)), (None, 1))
        # Last 24 h win when they hold three or more starts; older history only fills in when they do not.
        gap, n = nd.cadence([NOW - timedelta(hours=h) for h in (40, 30, 4, 2, 0.5)], NOW, (0.5, 12))
        self.assertEqual(n, 3)
        self.assertEqual(gap, timedelta(hours=1.75))

    def test_wet_diaper_threshold_follows_the_home_card_numbers(self):
        self.assertEqual(nd.wet_threshold_hours(24), 6.0)  # day 5–42: six or more a day -> 1.5 × 4 h
        self.assertEqual(nd.wet_threshold_hours(100), 7.0)  # 5 a day -> 7.2 h, to the half hour
        self.assertEqual(nd.wet_threshold_hours(3), 12.0)
        self.assertEqual(nd.wet_threshold_hours(0), 24.0)  # never more than a day

    def test_quiet_hours_wrap_midnight(self):
        self.assertTrue(nd.in_quiet_hours(datetime(2026, 1, 1, 23, 30), "22:00", "07:00"))
        self.assertTrue(nd.in_quiet_hours(datetime(2026, 1, 1, 6, 59), "22:00", "07:00"))
        self.assertFalse(nd.in_quiet_hours(datetime(2026, 1, 1, 7, 0), "22:00", "07:00"))
        self.assertFalse(nd.in_quiet_hours(datetime(2026, 1, 1, 15, 0), "22:00", "07:00"))
        self.assertTrue(nd.in_quiet_hours(datetime(2026, 1, 1, 13, 0), "12:00", "14:00"))
        self.assertFalse(nd.in_quiet_hours(datetime(2026, 1, 1, 13, 0), "09:00", "09:00"))  # equal = off
        self.assertEqual(nd.quiet_end_after(datetime(2026, 1, 1, 23, 30), "22:00", "07:00"), datetime(2026, 1, 2, 7, 0))

    def test_units_and_wording_helpers(self):
        self.assertEqual(nd.format_volume(60, "ml"), "60 mL")
        self.assertEqual(nd.format_volume(59.1, "oz"), "2.0 oz")
        self.assertEqual(nd.format_weight(2381, "lb"), "5 lb 4 oz")
        self.assertEqual(nd.format_weight(2381, "kg"), "2.38 kg")
        self.assertEqual(nd.format_weight_delta(34, "lb"), "up 1.2 oz")
        self.assertEqual(nd.format_weight_delta(-34, "kg"), "down 34 g")
        self.assertEqual(nd.ago(timedelta(hours=2, minutes=50)), "2 h 50 min")
        self.assertEqual(nd.ago(timedelta(minutes=45)), "45 min")
        self.assertEqual(nd.ago(timedelta(hours=3)), "3 h")

    # ---- feeding due
    def test_feed_nudge_is_worded_from_the_last_bottle_and_the_measured_gap(self):
        for h in (8.8, 5.9, 2.9):
            W.feed(h, amount=60)
        notes = self.n.run_once(NOW)[CHILD]
        row = self.rows("nudge:feed", sent=0)
        self.assertEqual(len(row), 1)
        self.assertEqual(row[0]["title"], "Oscar usually eats about now")
        self.assertEqual(row[0]["body"], "Last bottle 60 mL at 12:06 PM, 2 h 54 min ago.")
        self.assertEqual(row[0]["url"], "/?log=bottle")
        self.assertIsNone(row[0]["user_id"])
        # gaps 2.9 and 3.0 h -> median 2.95 h, inside the newborn 2–3 h band -> due 2.95 h after 12:06 PM
        due = datetime.fromisoformat(row[0]["at"])
        self.assertAlmostEqual((due - (NOW - timedelta(hours=2.9))).total_seconds() / 3600, 2.95, places=2)
        self.assertIn("Every 2 h 57 min lately, from 3 feeds", notes["feed"]["note"])
        self.assertNotIn("!", row[0]["title"] + row[0]["body"])

    def test_nursing_feed_names_the_side_and_opens_the_nursing_sheet(self):
        W.feed(6, amount=None, method="left breast")
        W.feed(3, amount=None, method="right breast")
        self.n.run_once(NOW)
        row = self.rows("nudge:feed", sent=0)[0]
        self.assertEqual(row["body"], "Last nursing (right side) at 12:00 PM, 3 h ago.")
        self.assertEqual(row["url"], "/?log=nursing")

    def test_amounts_are_converted_to_the_display_units(self):
        self.app.store.x("UPDATE settings SET blob=? WHERE child=?", (json.dumps({"storageUnits": {"volume": "oz", "weight": "kg"}}), CHILD))
        self.n.save_settings(CHILD, {"units": {"volume": "ml", "weight": "lb"}})
        W.feed(6, amount=2.0)
        W.feed(3, amount=2.0)
        self.n.run_once(NOW)
        self.assertIn("Last bottle 59 mL", self.rows("nudge:feed", sent=0)[0]["body"])

    def test_two_polls_leave_one_row_and_a_sent_row_is_never_repeated(self):
        W.feed(6)
        W.feed(3)
        self.n.run_once(NOW)
        self.n.run_once(NOW + timedelta(minutes=2))
        self.assertEqual(len(self.rows("nudge:feed")), 1)
        # Deliver it (the moment comes), then poll again: no new row for the same feed.
        at = datetime.fromisoformat(self.rows("nudge:feed")[0]["at"])
        self.delivery.run_once(at + timedelta(seconds=1))
        self.assertEqual(len(self.sent), 2)  # every phone
        self.assertEqual(self.sent[0][1]["url"], "/?log=bottle")
        notes = self.n.run_once(at + timedelta(minutes=5))[CHILD]
        self.assertEqual(self.rows("nudge:feed", sent=0), [])
        self.assertEqual(len(self.rows("nudge:feed", sent=1)), 1)
        self.assertIn("Sent for the last one", notes["feed"]["note"])

    def test_logging_a_feed_cancels_the_pending_nudge_and_moves_the_moment(self):
        W.feed(6)
        W.feed(3)
        self.n.run_once(NOW)
        first = self.rows("nudge:feed", sent=0)[0]
        W.feed(0.1)  # just fed
        self.n.run_once(NOW + timedelta(minutes=1))
        rows = self.rows("nudge:feed", sent=0)
        self.assertEqual(len(rows), 1)
        self.assertNotEqual(rows[0]["id"], first["id"])
        self.assertGreater(rows[0]["at"], first["at"])
        self.assertIn("Last bottle 60 mL at 2:54 PM, 7 min ago", rows[0]["body"])

    def test_moments_are_stored_in_utc_whatever_zone_baby_buddy_answers_in(self):
        # Baby Buddy serialises in its TIME_ZONE ("…-04:00"); the delivery loop compares `at` as a string
        # against the UTC clock, so a local-offset row would be claimed four hours early.
        local = lambda dt: dt.astimezone(TZ).isoformat(timespec="seconds")  # noqa: E731
        for hours_ago in (6, 3):
            start = NOW - timedelta(hours=hours_ago)
            W.add("feedings", start=local(start), end=local(start + timedelta(minutes=15)), type="breast milk", method="bottle", amount=60.0)
        notes = self.n.run_once(NOW)[CHILD]
        row = self.rows("nudge:feed", sent=0)[0]
        self.assertTrue(row["at"].endswith("+00:00"), row["at"])
        self.assertEqual(notes["feed"]["at"], row["at"])
        self.assertEqual(self.delivery.run_once(NOW), 0)  # nothing is due yet
        self.assertEqual(self.rows("nudge:feed", sent=1), [])

    def test_a_moment_missed_by_more_than_an_hour_is_dropped_not_sent_late(self):
        W.feed(8)
        W.feed(5)  # due at ~2 h ago
        notes = self.n.run_once(NOW)[CHILD]
        self.assertEqual(self.rows("nudge:feed"), [])
        self.assertIn("Missed the last moment", notes["feed"]["note"])
        # Overdue by less than the grace: fires at once.
        W.reset()
        W.feed(6.5)
        W.feed(3.4)  # gap 3.1 -> clamped to 3 h -> due 24 min ago
        self.n.run_once(NOW)
        row = self.rows("nudge:feed", sent=0)[0]
        self.assertEqual(datetime.fromisoformat(row["at"]), NOW.astimezone(timezone.utc))

    def test_nothing_is_planned_without_feeds_or_without_a_phone(self):
        notes = self.n.run_once(NOW)[CHILD]
        self.assertEqual(self.rows(), [])
        self.assertEqual(notes["feed"]["note"], "Waiting for a feed to be logged")
        W.feed(3)
        self.assertEqual(self.n.run_once(NOW)[CHILD]["feed"]["note"], "Waiting for two feeds within a day")
        self.app.store.x("DELETE FROM subscriptions")
        W.feed(6)
        self.assertEqual(self.n.run_once(NOW)[CHILD]["feed"]["note"], "No phone has notifications on")
        self.assertEqual(self.rows(), [])

    def test_feed_nudge_names_the_bag_to_use_first_when_one_expires_today(self):
        self.app.milk.create({"child": CHILD, "pumped_at": iso(NOW - timedelta(hours=3, days=3)), "volume_ml": 80, "location": "fridge"}, 7)
        W.feed(6)
        W.feed(3)
        self.n.run_once(NOW)
        body = self.rows("nudge:feed", sent=0)[0]["body"]
        self.assertRegex(body, r"Use bag [A-Z0-9]{6} first: 80 mL, good until \d+:\d\d [AP]M\.")

    def test_feed_nudge_names_a_night_bottle_before_any_bag(self):
        now = datetime.now(timezone.utc)
        bag = self.app.milk.create({"child": CHILD, "pumped_at": iso(now - timedelta(hours=2)), "volume_ml": 120, "location": "fridge"}, 7)
        self.app.milk.make_bottles(CHILD, [{"spot": 2, "takes": [{"bag": bag["id"], "amount_ml": 90}]}], 7)
        W.feed(6)
        W.feed(3)
        self.n.run_once(NOW)
        self.assertIn("Premade bottle 2 is ready: 90 mL.", self.rows("nudge:feed", sent=0)[0]["body"])

    # ---- quiet hours
    def test_quiet_hours_silence_feeds_but_not_the_diaper_check(self):
        night = NOW.replace(hour=23, minute=0)  # 11 PM
        W.rows["feedings"] = []
        for h in (6, 3):
            W.add("feedings", start=iso(night - timedelta(hours=h)), end=iso(night - timedelta(hours=h) + timedelta(minutes=10)), type="breast milk", method="bottle", amount=50)
        for h in (30, 20, 9):
            W.add("changes", time=iso(night - timedelta(hours=h)), wet=True, solid=False)
        notes = self.n.run_once(night)[CHILD]
        self.assertEqual(self.rows("nudge:feed"), [])
        self.assertIn("Quiet hours", notes["feed"]["note"])
        diaper = self.rows("nudge:diaper", sent=0)
        self.assertEqual(len(diaper), 1)
        self.assertEqual(diaper[0]["title"], "No wet diaper in 6 h")
        self.assertEqual(datetime.fromisoformat(diaper[0]["at"]), night.astimezone(timezone.utc))  # already 9 h: at once
        # Quiet hours can be moved: 1–5 AM leaves 11 PM free.
        self.n.save_settings(CHILD, {"quietStart": "01:00", "quietEnd": "05:00"})
        self.n.run_once(night)
        self.assertEqual(len(self.rows("nudge:feed", sent=0)), 1)

    def test_diaper_nudge_waits_for_regular_logging_and_fires_once_per_anchor(self):
        W.diaper(9)
        self.assertEqual(self.n.run_once(NOW)[CHILD]["diaper"]["note"], "Waiting for diapers to be logged regularly")
        W.diaper(30)
        W.diaper(20, wet=False, solid=True)
        self.n.run_once(NOW)
        row = self.rows("nudge:diaper", sent=0)[0]
        self.assertEqual(row["body"], "Last wet diaper at 6:00 AM today. At this age 6 or more a day is typical; offer a feed and mention it to your pediatrician if it continues.")
        self.assertEqual(row["url"], "/?log=diaper")
        self.delivery.run_once(NOW + timedelta(seconds=1))
        self.assertEqual(len(self.sent), 2)
        self.n.run_once(NOW + timedelta(hours=1))
        self.assertEqual(self.rows("nudge:diaper", sent=0), [])
        W.diaper(0.2)
        notes = self.n.run_once(NOW + timedelta(hours=1))[CHILD]
        self.assertEqual(len(self.rows("nudge:diaper", sent=0)), 1)
        self.assertIn("ignores quiet hours", notes["diaper"]["note"])

    # ---- pumping
    def test_pump_nudge_goes_to_the_person_who_pumps(self):
        self.app.store.x("INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES ('sara','mom','',7,1,1,'t',NULL,'t'), ('tom','dad','',8,1,1,'t',NULL,'t')")
        self.app.milk.create({"child": CHILD, "pumped_at": iso(NOW - timedelta(hours=5)), "volume_ml": 120, "location": "fridge"}, 7)
        self.app.milk.create({"child": CHILD, "pumped_at": iso(NOW - timedelta(hours=2)), "volume_ml": 130, "location": "fridge"}, 7)
        for h in (8, 5, 2):
            W.pump(h, amount=45)
        notes = self.n.run_once(NOW)[CHILD]
        row = self.rows("nudge:pump", sent=0)[0]
        self.assertEqual(row["title"], "About time to pump")
        self.assertEqual(row["body"], "Last session 1:00 PM, 45 mL. Stash: 2 bags, 250 mL.")
        self.assertEqual(row["user_id"], 7)
        self.assertEqual(row["url"], "/?log=pumping")
        self.assertEqual(notes["pump"]["note"], "Every 3 h lately, from 3 sessions · to Mom's phone")
        self.delivery.run_once(datetime.fromisoformat(row["at"]) + timedelta(seconds=1))
        self.assertEqual([e for e, _ in self.sent], ["https://push.example/mom"])

    def test_pump_nudge_falls_back_to_the_mom_role_then_to_every_phone(self):
        for h in (8, 5, 2):
            W.pump(h, who="nobody")
        self.app.store.x("INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES ('sara','mom','',7,1,1,'t',NULL,'t')")
        self.assertEqual(self.n.run_once(NOW)[CHILD]["pump"]["note"].split(" · ")[1], "to Mom's phone")
        self.app.store.x("DELETE FROM people")
        self.assertEqual(self.n.run_once(NOW)[CHILD]["pump"]["note"].split(" · ")[1], "to every phone")
        self.assertIsNone(self.rows("nudge:pump", sent=0)[0]["user_id"])
        # A target with no registered phone: everyone gets it rather than nobody.
        self.app.store.x("INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES ('nobody','mom','',99,1,0,'t',NULL,'t')")
        self.n.run_once(NOW)
        row = self.rows("nudge:pump", sent=0)[0]
        self.assertEqual(row["user_id"], 99)
        self.delivery.run_once(datetime.fromisoformat(row["at"]) + timedelta(seconds=1))
        self.assertEqual(len(self.sent), 2)

    def test_pump_cadence_can_be_fixed_from_settings(self):
        W.pump(1)
        self.assertEqual(self.n.run_once(NOW)[CHILD]["pump"]["note"], "Waiting for two sessions within a day")
        self.n.save_settings(CHILD, {"pumpEveryMinutes": 150})
        notes = self.n.run_once(NOW)[CHILD]
        self.assertEqual(notes["pump"]["note"], "Every 2 h 30 min, set in Settings · to every phone")
        self.assertEqual(datetime.fromisoformat(self.rows("nudge:pump", sent=0)[0]["at"]), (NOW + timedelta(hours=1.5)).astimezone(timezone.utc))
        self.assertIsNone(nd.clean_settings({"pumpEveryMinutes": 5})["pumpEveryMinutes"])  # out of range = auto

    def test_clocks_in_notifications_follow_the_household_zone_not_the_servers(self):
        # Reported 2026-10-25 by a family on their own copy: "the right time but the wrong text, it says I pumped at
        # 6:30 and sends it at 2:30". Their container ran in UTC, so a 2:30 PM pump in New York read as 6:30 PM.
        old_env, old_tz = os.environ.get("TZ"), self.n.tz
        os.environ["TZ"] = "UTC"
        try:
            self.n._auto_tz = self.n.tz = nd.household_zone(self.app.store)  # what a fresh container starts with
            self.app.store.x("DELETE FROM server_config WHERE key='time_zone'")
            for h in (8, 5, 2):
                W.pump(h, amount=45)
            self.n.run_once(NOW)
            self.assertEqual(self.rows("nudge:pump", sent=0)[0]["body"], "Last session 5:00 PM, 45 mL.")  # the bug: 1:00 PM in UTC
            pumped = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=1)  # milk reminders run on the real clock
            self.app.milk.create({"child": CHILD, "pumped_at": iso(pumped), "volume_ml": 60, "location": "fridge"}, 7)

            def put(body):
                req = urllib.request.Request(self.base + "/config", data=json.dumps(body).encode(), method="PUT", headers={"Authorization": "Token good", "Content-Type": "application/json"})
                try:
                    with urllib.request.urlopen(req) as r:
                        return r.status, json.loads(r.read())
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read())

            self.assertEqual(put({"timeZone": "Not/AZone"})[0], 400)
            self.assertEqual(put({"timeZone": "../../etc/passwd"})[0], 400)
            status, view = put({"timeZone": "America/New_York"})
            self.assertEqual(status, 200)
            self.assertEqual(view["timeZone"], {"value": "America/New_York", "source": "settings", "server": "UTC"})
            self.n.run_once(NOW)
            self.assertEqual(self.rows("nudge:pump", sent=0)[0]["body"], "Last session 1:00 PM, 45 mL. Stash: 1 bag, 60 mL.")
            # Milk reminders carry clocks too; changing the zone wrote them again.
            from zoneinfo import ZoneInfo

            soon = [r for r in self.rows() if r["source"] == "milk" and r["title"].startswith("Milk expiring soon")][0]
            self.assertIn("Pumped " + pumped.astimezone(ZoneInfo("America/New_York")).strftime("%a %b %-d, %-I:%M %p"), soon["body"])
            # Quiet hours are the household's 10 PM - 7 AM: 11 PM in New York is quiet, 11 PM UTC (7 PM there) is not.
            self.assertTrue(nd.in_quiet_hours(datetime(2026, 10, 7, 23, 0, tzinfo=timezone.utc).astimezone(self.n.tz), "22:00", "07:00") is False)
            # Cleared: back to the server's zone.
            status, view = put({"timeZone": None})
            self.assertEqual(view["timeZone"]["source"], "server")
        finally:
            if old_env is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = old_env
            self.app.store.x("DELETE FROM server_config WHERE key='time_zone'")
            self.n._auto_tz, self.n.tz = None, old_tz

    # ---- activity pings
    def test_activity_pings_the_other_phones_once_per_entry_never_the_logger(self):
        self.app.store.x("INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES ('sara','mom','',7,1,1,'t',NULL,'t'), ('tom','dad','',8,1,1,'t',NULL,'t')")
        self.n.save_settings(CHILD, {"activity": True})
        W.feed(3, tags=[{"name": "caregiver:sara"}])
        self.assertEqual(self.n.run_once(NOW)[CHILD]["activity"]["note"], "Watching from now: the other phones hear about what is logged")
        self.assertEqual(self.rows("nudge:activity"), [])  # the first poll only learns what is there
        bottle = W.feed(1, amount=60, tags=[{"name": "caregiver:tom"}])
        notes = self.n.run_once(NOW)[CHILD]
        self.assertEqual(notes["activity"]["note"], "To the other phones when someone logs something · 1 new just now")
        rows = self.rows("nudge:activity")
        self.assertEqual([(r["title"], r["body"], r["user_id"], r["anchor"], r["url"]) for r in rows], [("Dad logged a bottle", "60 mL breast milk at 2:00 PM.", 7, f"feeding:{bottle['id']}:7", "/")])
        self.assertEqual(datetime.fromisoformat(rows[0]["at"]), NOW.astimezone(timezone.utc))
        self.delivery.run_once(datetime.fromisoformat(rows[0]["at"]) + timedelta(seconds=1))
        self.assertEqual([e for e, _ in self.sent], ["https://push.example/mom"])
        self.assertEqual(self.n.run_once(NOW + timedelta(minutes=2))[CHILD]["activity"]["note"], "To the other phones when someone logs something")
        self.assertEqual(len(self.rows("nudge:activity")), 1)  # seen once, pinged once
        # Every kind, worded from the entry; an entry with no caregiver tag (Baby Buddy's own UI) names nobody and is skipped.
        W.pump(0.5, who="sara")
        W.diaper(0.2)
        W.add("sleep", start=iso(NOW - timedelta(hours=2)), end=iso(NOW - timedelta(hours=1)), nap=True, tags=[{"name": "caregiver:tom"}])
        W.add("feedings", start=iso(NOW - timedelta(minutes=20)), end=iso(NOW - timedelta(minutes=8)), type="breast milk", method="left breast", amount=None, tags=[{"name": "caregiver:sara"}])
        notes = self.n.run_once(NOW + timedelta(minutes=4))[CHILD]
        self.assertEqual(notes["activity"]["note"], "To the other phones when someone logs something · 3 new just now · 1 without a known caregiver")
        new = [(r["title"], r["body"], r["user_id"]) for r in self.rows("nudge:activity")[1:]]
        self.assertIn(("Mom logged pumping", "Pumped 45 mL at 2:30 PM.", 8), new)
        self.assertIn(("Dad logged a nap", "A nap 1:00 PM–2:00 PM, 1 h.", 7), new)
        self.assertIn(("Mom logged nursing", "Nursing, left side, 12 min at 2:40 PM.", 8), new)
        self.assertEqual(len(new), 3)
        self.assertEqual(self.n.route(self.rows("nudge:activity")[0]), ("/", 7, False))

    def test_activity_is_off_by_default_keeps_its_ledger_and_waits_out_quiet_hours(self):
        self.app.store.x("INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES ('sara','mom','Sara',7,1,1,'t',NULL,'t'), ('tom','dad','',8,1,1,'t',NULL,'t')")
        W.feed(3, tags=[{"name": "caregiver:tom"}])
        self.assertEqual(self.n.run_once(NOW)[CHILD]["activity"]["note"], "Off")
        W.feed(1, tags=[{"name": "caregiver:tom"}])
        self.assertEqual(self.n.run_once(NOW)[CHILD]["activity"]["note"], "Off")
        # Switched on later: what was logged while it was off is already seen, so nothing bursts out.
        self.n.save_settings(CHILD, {"activity": True})
        self.assertEqual(self.n.run_once(NOW)[CHILD]["activity"]["note"], "To the other phones when someone logs something")
        self.assertEqual(self.rows("nudge:activity"), [])
        # Quiet hours: a ping is dropped, not held for the morning.
        late = NOW.replace(hour=23)
        self.n.run_once(late - timedelta(minutes=2))  # the poll runs every 2 min; hours between polls is a gap
        W.feed(0.1, tags=[{"name": "caregiver:tom"}])
        self.assertEqual(self.n.run_once(late)[CHILD]["activity"]["note"], "Quiet hours · nothing goes out until they end")
        self.n.run_once(late + timedelta(hours=9) - timedelta(minutes=2))
        self.assertEqual(self.n.run_once(late + timedelta(hours=9))[CHILD]["activity"]["note"], "To the other phones when someone logs something")
        self.assertEqual(self.rows("nudge:activity"), [])
        # The person's name when People has one; a lone phone has nobody to tell.
        W.pump(0.05, who="sara")
        self.n.run_once(NOW + timedelta(minutes=10))
        self.assertEqual(self.rows("nudge:activity")[0]["title"], "Sara logged pumping")
        self.app.store.x("DELETE FROM subscriptions WHERE user_id=8")
        W.pump(0.02, who="sara")
        self.assertEqual(self.n.run_once(NOW + timedelta(minutes=12))[CHILD]["activity"]["note"], "Only one phone has notifications on, so there is nobody else to tell")
        self.assertEqual(len(self.rows("nudge:activity")), 1)

    PEOPLE = "INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES ('sara','mom','',7,1,1,'t',NULL,'t'), ('tom','dad','',8,1,1,'t',NULL,'t')"

    def test_born_early_paces_feeds_by_corrected_age_and_the_nicu_stay_keeps_feeds_and_diapers_quiet(self):
        birth = date(2026, 7, 1)
        # 25 wk 3 d (178 days): due Oct 11. Before it, every age counts as 0 (the newborn feed band).
        a = nd.age_basis(birth, date(2026, 10, 7), {"bornAtDays": 178})
        self.assertEqual((a["hold"], a["age_days"], a["real_days"]), ("before-term", 0, 98))
        a = nd.age_basis(birth, date(2026, 12, 11), {"bornAtDays": 178, "nicu": {"since": "2026-07-01", "home": "2026-09-20"}})
        self.assertEqual((a["hold"], a["age_days"]), (None, 61))
        self.assertEqual(nd.age_basis(birth, date(2026, 8, 1), {"nicu": {"since": "2026-07-01", "home": None}})["hold"], "nicu")
        self.assertEqual(nd.age_basis(birth, date(2028, 7, 2), {"bornAtDays": 178})["age_days"], (date(2028, 7, 2) - birth).days)  # two years on: no correction
        self.assertEqual(nd.age_basis(birth, date(2026, 8, 1), {"bornAtDays": 300, "nicu": "x"})["hold"], None)  # nonsense is ignored
        # In the NICU: feeds and diapers logged, nothing planned, the plan says why; the pump nudge still works.
        self.app.store.x("UPDATE settings SET blob=? WHERE child=?", (json.dumps({"bornAtDays": 196, "nicu": {"since": (NOW - timedelta(days=24)).date().isoformat(), "home": None}}), CHILD))
        for h in (8.8, 5.9, 2.9):
            W.feed(h, amount=20)
        for h in (30, 20, 9):
            W.diaper(h)
        notes = self.n.run_once(NOW)[CHILD]
        self.assertEqual(notes["feed"]["note"], "In the NICU · quiet until home")
        self.assertEqual(notes["diaper"]["note"], "In the NICU · quiet until home")
        self.assertEqual(self.rows("nudge:feed") + self.rows("nudge:diaper"), [])
        # Home again: both come back.
        self.app.store.x("UPDATE settings SET blob=? WHERE child=?", (json.dumps({"bornAtDays": 196, "nicu": {"since": (NOW - timedelta(days=24)).date().isoformat(), "home": (NOW - timedelta(days=1)).date().isoformat()}}), CHILD))
        self.n.run_once(NOW)
        self.assertEqual(len(self.rows("nudge:feed", sent=0)), 1)
        self.assertEqual(len(self.rows("nudge:diaper", sent=0)), 1)

    def test_day_15_of_life_is_the_newborn_feed_band_not_the_toddler_one(self):
        # 15 / 30.4375 = 0.49 months: past the (3, 14)-day row, before the (0.5, 1)-month row.
        for day in (14, 15, 16):
            self.assertEqual(nd.feed_gap_bounds(day / 30.4375, day), (2.0, 3.0), f"day {day}")
        self.assertEqual(nd.feed_gap_bounds(30, 900), (6.0, 12.0))  # past the table: the last row still
        W.children[0]["birth_date"] = (NOW - timedelta(days=15)).date().isoformat()
        for h in (8.5, 6, 3.5, 1):  # a 2.5 h rhythm
            W.feed(h)
        self.assertIn("Every 2 h 30 min", self.n.run_once(NOW)[CHILD]["feed"]["note"])

    def test_activity_ping_is_dropped_when_its_target_has_no_phone_left(self):
        self.app.store.x(self.PEOPLE)
        self.n.save_settings(CHILD, {"activity": True})
        W.feed(5)
        self.n.run_once(NOW)
        W.pump(0.1, who="sara")
        self.n.run_once(NOW + timedelta(minutes=2))
        rows = self.rows("nudge:activity")
        self.assertEqual([r["user_id"] for r in rows], [8])
        # Dad's endpoint went away (410 earlier, or notifications off) before the ping was delivered: it must
        # not fall back to every phone, which would tell Mom about her own entry.
        self.app.store.x("DELETE FROM subscriptions WHERE user_id=8")
        self.delivery.run_once(datetime.fromisoformat(rows[0]["at"]) + timedelta(seconds=1))
        self.assertEqual(self.sent, [])
        # Other nudges meant for one person still reach every phone when theirs is gone (pump, supply).
        self.app.store.x(
            "INSERT INTO reminders (child, at, title, body, tag, source, sent, created, url, user_id, anchor) VALUES (?,?,?,?,?,?,0,?,?,?,?)",
            (CHILD, iso(NOW), "About time to pump", "", "nudge:pump", nd.SOURCE, iso(NOW), "/?log=pumping", 8, "x"),
        )
        self.delivery.run_once(NOW.astimezone(timezone.utc) + timedelta(seconds=1))
        self.assertEqual([e for e, _ in self.sent], ["https://push.example/mom"])

    def test_activity_ledger_is_kept_while_no_phone_is_subscribed_so_resubscribing_never_bursts(self):
        self.app.store.x(self.PEOPLE)
        self.n.save_settings(CHILD, {"activity": True})
        W.feed(5)
        self.n.run_once(NOW)
        subs = self.app.store.q("SELECT * FROM subscriptions")
        self.app.store.x("DELETE FROM subscriptions")
        for h in (4, 3, 2, 1.5, 1):
            W.pump(h, who="sara")
        self.assertEqual(self.n.run_once(NOW + timedelta(minutes=2))[CHILD]["activity"]["note"], "No phone has notifications on")
        for sub in subs:
            self.subscribe(sub["endpoint"], sub["user_id"])
        self.n.run_once(NOW + timedelta(minutes=4))
        self.assertEqual(self.rows("nudge:activity"), [])
        W.pump(0.05, who="sara")  # the next real entry is still pinged
        self.n.run_once(NOW + timedelta(minutes=6))
        self.assertEqual(len(self.rows("nudge:activity")), 1)

    def test_first_entry_after_an_empty_window_or_for_a_new_child_is_pinged(self):
        self.app.store.x(self.PEOPLE)
        self.n.save_settings(CHILD, {"activity": True})
        self.assertEqual(self.n.run_once(NOW)[CHILD]["activity"]["note"], "Watching from now: the other phones hear about what is logged")
        W.pump(0.1, who="sara")
        note = self.n.run_once(NOW + timedelta(minutes=2))[CHILD]["activity"]["note"]
        self.assertEqual(note, "To the other phones when someone logs something · 1 new just now")
        self.assertEqual([r["user_id"] for r in self.rows("nudge:activity")], [8])
        W.pump(0.05, who="tom")
        self.n.run_once(NOW + timedelta(minutes=4))
        self.assertEqual(len(self.rows("nudge:activity")), 2)

    def test_after_a_gap_in_polling_what_was_logged_meanwhile_is_caught_up_quietly(self):
        # Sweep 2026-10-27: the poll stopped (token lost, Baby Buddy down); on its return every entry of the last 48 h
        # it had not seen pinged at once, a session from yesterday among them ("Pumped 45 mL at 1:00 AM").
        self.app.store.x(self.PEOPLE)
        self.n.save_settings(CHILD, {"activity": True})
        self.n.run_once(NOW - timedelta(hours=6))
        W.pump(20, who="sara")
        W.pump(3, who="sara")
        self.assertEqual(self.n.run_once(NOW)[CHILD]["activity"]["note"], "Back after a gap: what was logged meanwhile was not announced")
        self.assertEqual(self.rows("nudge:activity"), [])
        W.pump(0.05, who="sara")  # back to normal: the next one is announced
        self.n.run_once(NOW + timedelta(minutes=2))
        self.assertEqual([r["body"] for r in self.rows("nudge:activity")], ["Pumped 45 mL at 2:57 PM."])
        # A ledger written before it carried the time (an upgrade) is caught up quietly once, then pings.
        self.app.store.x("UPDATE nudge_seen SET entry_id=0 WHERE kind=?", (nd.LEARNED,))
        W.pump(0.02, who="sara")
        self.n.run_once(NOW + timedelta(minutes=4))
        self.assertEqual(len(self.rows("nudge:activity")), 1)

    def test_a_session_logged_late_names_its_day(self):
        # Reported 2026-10-25: "you pumped at 6:30 [two days ago] and it sends it at 2:30": a clock alone reads as today.
        self.app.store.x(self.PEOPLE)
        self.n.save_settings(CHILD, {"activity": True})
        self.n.run_once(NOW - timedelta(minutes=2))
        W.pump(44.5, who="sara")  # Monday 6:30 PM, logged now (Wednesday 3:00 PM)
        self.n.run_once(NOW)
        self.assertEqual(self.rows("nudge:activity")[0]["body"], "Pumped 45 mL at 6:30 PM Monday.")
        self.assertEqual(nd.stamp(NOW - timedelta(hours=2), NOW, TZ), "1:00 PM")
        self.assertEqual(nd.stamp(NOW - timedelta(hours=20), NOW, TZ), "7:00 PM yesterday")

    def test_a_poll_that_cannot_read_baby_buddy_takes_back_its_predictions(self):
        # Sweep 2026-10-27: planned at 1 PM for 4 PM, then the token was lost; the 4 PM push still said "Last session
        # 1:00 PM" after Mom had pumped at 2:30.
        for h in (8, 5, 2):
            W.pump(h)
            W.feed(h)
        W.diaper(1)
        self.n.run_once(NOW)
        self.assertTrue(self.rows("nudge:pump", sent=0) and self.rows("nudge:feed", sent=0))
        self.n.secrets.update(bb_token="revoked")
        self.n.run_once(NOW + timedelta(minutes=2))
        self.assertEqual(self.n.problem["code"], "needs_login")
        self.assertEqual(self.rows("nudge:pump", sent=0) + self.rows("nudge:feed", sent=0), [])

    def test_age_in_days_counts_local_days_not_utc_ones(self):
        W.children[0]["birth_date"] = (NOW - timedelta(days=4)).date().isoformat()  # day 4 of life, local
        for h in (10, 6, 2):
            W.diaper(h)
        evening = NOW + timedelta(hours=6)  # 9:00 PM local = 01:00 UTC on the next date
        notes = self.n.run_once(evening.astimezone(timezone.utc))[CHILD]
        self.assertIn("After 9 h", notes["diaper"]["note"])  # day 4: 4 wet a day -> 9 h (day 5 would be 6 h)
        # Born "today" in local time but already tomorrow in UTC: not waiting for the birth date any more.
        W.children[0]["birth_date"] = evening.date().isoformat()
        self.assertNotEqual(self.n.run_once(evening.astimezone(timezone.utc))[CHILD]["diaper"]["note"], "Waiting for the birth date")
        W.children[0]["birth_date"] = (evening + timedelta(days=1)).date().isoformat()
        self.assertEqual(self.n.run_once(evening.astimezone(timezone.utc))[CHILD]["diaper"]["note"], "Waiting for the birth date")

    # ---- supply
    def _two_weeks(self, recent_ml=60.0, recent_sessions=3, base_ml=100.0, base_days=range(4, 15), recent_days=(1, 2, 3)):
        """Three sessions a day, 7 AM / 10 AM / 1 PM local, over the base days and the recent days."""
        for d in base_days:
            for h in (2, 5, 8):
                W.pump(24 * d + h, amount=base_ml)
        for d in recent_days:
            for i in range(recent_sessions):
                W.pump(24 * d + 2 + 3 * i, amount=recent_ml)

    def test_supply_nudge_fires_after_three_low_days_to_the_pumper_once_per_three_days(self):
        self.app.store.x("INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES ('sara','mom','',7,1,1,'t',NULL,'t')")
        self._two_weeks()  # 180 mL a day for three days against 300 mL a day over the eleven before
        notes = self.n.run_once(NOW)[CHILD]
        row = self.rows("nudge:supply", sent=0)[0]
        self.assertEqual(row["title"], "Pumping is down this week")
        self.assertEqual(row["body"], "Last 3 days 180 mL a day, 40% under the 300 mL a day of the 11 days before. About as many sessions a day (3), so each one gives less. Three days in a row is a trend, not a bad day.")
        self.assertEqual(row["url"], "/reports")
        self.assertEqual(row["user_id"], 7)
        self.assertEqual(row["anchor"], (NOW - timedelta(days=1)).date().isoformat())
        self.assertEqual(datetime.fromisoformat(row["at"]), NOW.astimezone(timezone.utc))  # 3 PM: not quiet hours, goes now
        self.assertEqual(notes["supply"]["note"], "Down 40% over the last 3 days · to Mom's phone")
        self.delivery.run_once(datetime.fromisoformat(row["at"]) + timedelta(seconds=1))
        self.assertEqual([e for e, _ in self.sent], ["https://push.example/mom"])
        # The next polls do not repeat it: today's anchor went out, and tomorrow's is held for three days.
        self.assertEqual(self.n.run_once(NOW + timedelta(hours=1))[CHILD]["supply"]["note"], "Down 40% over the last 3 days · sent today, again after 3 days")
        self.assertEqual(self.rows("nudge:supply", sent=0), [])
        W.reset()
        self._two_weeks(base_days=range(3, 14), recent_days=(0, 1, 2))  # hours_ago counts from NOW: the same picture seen from tomorrow
        tomorrow = NOW + timedelta(days=1)
        self.assertEqual(self.n.run_once(tomorrow)[CHILD]["supply"]["note"], "Down 40% over the last 3 days · sent yesterday, again after 3 days")
        self.assertEqual(self.rows("nudge:supply", sent=0), [])
        self.app.store.x("UPDATE reminders SET at=? WHERE tag='nudge:supply'", (iso(NOW - timedelta(days=4)),))
        self.assertIn("to Mom's phone", self.n.run_once(tomorrow)[CHILD]["supply"]["note"])
        self.assertEqual(len(self.rows("nudge:supply", sent=0)), 1)

    def test_supply_nudge_waits_for_data_and_stays_quiet_while_pumping_holds_up(self):
        self.assertEqual(self.n.run_once(NOW)[CHILD]["supply"]["note"], "Watching the last 3 days against the 11 before · 0 of 11 days logged so far, needs 5")
        self._two_weeks(base_days=range(4, 8), recent_days=())  # four base days: not enough
        self.assertEqual(self.n.run_once(NOW)[CHILD]["supply"]["note"], "Watching the last 3 days against the 11 before · 4 of 11 days logged so far, needs 5")
        W.reset()
        self._two_weeks(recent_days=(1, 3))  # a day with nothing logged is missing, not a drop
        self.assertEqual(self.n.run_once(NOW)[CHILD]["supply"]["note"], "Usual 300 mL a day · waiting for 3 logged days in a row")
        W.reset()
        self._two_weeks(recent_ml=90.0)  # 270 a day: a dip under 15 % is not a trend
        self.assertEqual(self.n.run_once(NOW)[CHILD]["supply"]["note"], "Holding up: 270 mL a day lately, usual 300 mL")
        self.assertEqual(self.rows("nudge:supply", sent=0), [])
        W.reset()
        self._two_weeks(recent_ml=100.0, recent_sessions=2)  # the sessions explain it
        row = self.rows("nudge:supply", sent=0) if self.n.run_once(NOW) else []
        self.assertEqual(row[0]["body"], "Last 3 days 200 mL a day, 33% under the 300 mL a day of the 11 days before. Fewer sessions a day (2 from 3) explain most of it. Three days in a row is a trend, not a bad day.")
        self.assertIsNone(row[0]["user_id"])  # no people table rows: every phone
        # Amounts in the display unit, deferred through quiet hours, and off by the switch.
        self.n.save_settings(CHILD, {"units": {"volume": "oz"}})
        late = NOW.replace(hour=23)
        W.reset()
        self._two_weeks(recent_ml=100.0, recent_sessions=2)
        notes = self.n.run_once(late)[CHILD]
        row = self.rows("nudge:supply", sent=0)[0]
        self.assertIn("6.8 oz a day, 33% under the 10.1 oz a day", row["body"])
        self.assertEqual(datetime.fromisoformat(row["at"]), late.replace(hour=7, minute=0).astimezone(timezone.utc) + timedelta(days=1))
        self.assertIn("Down 33%", notes["supply"]["note"])
        self.n.save_settings(CHILD, {"supply": False})
        self.assertEqual(self.n.run_once(late)[CHILD]["supply"]["note"], "Off")
        self.assertEqual(self.rows("nudge:supply", sent=0), [])

    # ---- summary
    def test_evening_summary_has_one_line_per_thing(self):
        for h in (10, 7, 4, 1):
            W.feed(h, amount=60)
        W.feed(2, amount=None, method="left breast")
        W.diaper(9)
        W.diaper(5, wet=True, solid=True)
        W.diaper(1, wet=False, solid=True)
        W.sleep(13, 11)
        W.sleep(6, 4.5)
        W.pump(8, amount=45)
        W.pump(3, amount=55)
        self.app.milk.create({"child": CHILD, "pumped_at": iso(NOW - timedelta(hours=3)), "volume_ml": 55, "location": "fridge"}, 7)
        notes = self.n.run_once(NOW)[CHILD]
        row = self.rows("nudge:summary", sent=0)[0]
        self.assertEqual(row["title"], "Oscar's day")
        self.assertEqual(row["body"].split("\n"), ["Feeds: 5, 240 mL by bottle", "Diapers: 3 (2 wet, 2 dirty)", "Sleep: 3 h 30 min", "Pumping: 2 sessions, 100 mL", "Stash: 1 bag, 55 mL"])
        self.assertEqual(datetime.fromisoformat(row["at"]).astimezone(TZ).strftime("%H:%M"), "20:00")
        self.assertEqual(notes["summary"]["note"], "Every day at 8:00 PM")
        self.assertEqual(row["url"], "/")
        # Once sent, the next day's row only appears when something has been logged that day.
        self.delivery.run_once(datetime.fromisoformat(row["at"]) + timedelta(seconds=1))
        later = NOW + timedelta(hours=6)  # 9 PM
        self.assertIn("Sent for the last one", self.n.run_once(later)[CHILD]["summary"]["note"])
        self.n.save_settings(CHILD, {"summary": False})
        self.assertEqual(self.n.run_once(later)[CHILD]["summary"]["note"], "Off")

    # ---- Hatch weight
    def test_hatch_weight_hook_pushes_the_change_since_the_previous_weighing(self):
        self.app.store.x(
            "INSERT INTO hatch_weights (hatch_id, baby, child, grams, measured_at, manual, note, backlog, status, created) VALUES (1, 501, ?, 2347, '2026-10-05 09:30:00', 0, '', 1, 'imported', 't')",
            (CHILD,),
        )
        self.n.weight_imported(CHILD, 1, 2347, "2026-10-05 09:30:00", backlog=True)
        self.assertEqual(self.rows("nudge:weight"), [])  # a first import's backlog never pushes
        self.app.store.x(
            "INSERT INTO hatch_weights (hatch_id, baby, child, grams, measured_at, manual, note, backlog, status, created) VALUES (2, 501, ?, 2381, '2026-10-07 09:30:00', 0, '', 0, 'imported', 't')",
            (CHILD,),
        )
        with FrozenNow(nd, NOW):
            self.n.weight_imported(CHILD, 2, 2381, "2026-10-07 09:30:00", backlog=False)
        row = self.rows("nudge:weight", sent=0)[0]
        self.assertEqual(row["title"], "New weight from the Hatch")
        self.assertEqual(row["body"], "5 lb 4 oz at 9:30 AM today, up 1.2 oz since Monday.")
        self.assertEqual(row["url"], "/child")
        # The same weighing again (a re-sync) is not a second push once it went out.
        self.delivery.run_once(NOW.astimezone(timezone.utc) + timedelta(seconds=1))
        with FrozenNow(nd, NOW + timedelta(minutes=5)):
            self.n.weight_imported(CHILD, 2, 2381, "2026-10-07 09:30:00", backlog=False)
        self.assertEqual(self.rows("nudge:weight", sent=0), [])
        # In quiet hours it waits for the morning instead of waking anyone.
        self.app.store.x("INSERT INTO hatch_weights (hatch_id, baby, child, grams, measured_at, manual, note, backlog, status, created) VALUES (3, 501, ?, 2400, '2026-10-07 23:10:00', 0, '', 0, 'imported', 't')", (CHILD,))
        with FrozenNow(nd, NOW.replace(hour=23, minute=12)):
            self.n.weight_imported(CHILD, 3, 2400, "2026-10-07 23:10:00", backlog=False)
        row = self.rows("nudge:weight", sent=0)[0]
        self.assertEqual(datetime.fromisoformat(row["at"]).astimezone(TZ).strftime("%d %H:%M"), "08 07:00")
        self.assertEqual(row["body"], "5 lb 5 oz at 11:10 PM today, up 0.7 oz since today.")

    # ---- settings, routing, http
    def test_settings_switch_each_nudge_off_including_milk_expiry_at_delivery(self):
        W.feed(6)
        W.feed(3)
        self.n.save_settings(CHILD, {"feed": False})
        notes = self.n.run_once(NOW)[CHILD]
        self.assertEqual(notes["feed"]["note"], "Off")
        self.assertEqual(self.rows("nudge:feed"), [])
        # Milk expiry rows come from milk.py; the switch is honoured when they are about to go out.
        bag = self.app.milk.create({"child": CHILD, "pumped_at": iso(datetime.now(timezone.utc) - timedelta(hours=1)), "volume_ml": 80, "location": "room"}, 7)
        milk_rows = self.rows(f"milk:{bag['id']}", sent=0)
        self.assertTrue(milk_rows)
        self.assertEqual(self.n.route(milk_rows[0]), ("/milk", None, False))
        self.n.save_settings(CHILD, {"milk": False})
        self.assertEqual(self.n.route(milk_rows[0]), ("/milk", None, True))
        self.delivery.run_once(datetime.fromisoformat(milk_rows[-1]["at"]) + timedelta(seconds=1))
        self.assertEqual([p for _, p in self.sent if p["tag"].startswith("milk:")], [])
        # Manual tile reminders open their sheet; nap window stays on Home.
        self.assertEqual(self.n.route({"tag": "reminder:bottle", "source": "manual", "child": CHILD}), ("/?log=bottle", None, False))
        self.assertEqual(self.n.route({"tag": "sweetspot:now", "source": "auto", "child": CHILD}), ("/", None, False))

    def test_http_arms_the_token_saves_settings_and_reports_the_plan(self):
        self.n.secrets.clear()
        self.assertFalse(self.n.armed())
        status, body = self.call("GET", f"/nudges/{CHILD}")
        self.assertEqual(status, 200)
        self.assertTrue(body["armed"])
        self.assertEqual(body["settings"]["quietStart"], "22:00")
        self.assertEqual(body["quiet"], "10:00 PM to 7:00 AM")
        self.assertEqual(body["subscriptions"], 2)
        status, body = self.call("PUT", f"/nudges/{CHILD}", {"pumpEveryMinutes": 180, "quietStart": "23:30", "summaryAt": "19:00", "bogus": 1, "units": {"volume": "oz"}})
        self.assertEqual(status, 200)
        self.assertEqual(body["settings"]["pumpEveryMinutes"], 180)
        self.assertEqual(body["settings"]["quietStart"], "23:30")
        self.assertEqual(body["settings"]["units"], {"volume": "oz", "weight": "lb"})
        self.assertNotIn("bogus", body["settings"])
        real_now = datetime.now(timezone.utc)  # the HTTP run uses the wall clock
        for h in (6, 3):
            W.add("feedings", start=iso(real_now - timedelta(hours=h)), end=iso(real_now - timedelta(hours=h, minutes=-10)), type="formula", method="bottle", amount=70)
        status, body = self.call("POST", f"/nudges/{CHILD}/run")
        self.assertEqual(status, 200)
        self.assertIn("Quiet hours", body["next"]["feed"]["note"]) if body["next"]["feed"]["at"] is None else self.assertEqual(body["next"]["feed"]["title"], "Oscar usually eats about now")
        self.assertIn("from 2 feeds", body["next"]["feed"]["note"])
        self.assertIsNone(body["problem"])
        # A revoked token is reported in plain words and the poll stops reading until someone opens Settings.
        W.tokens.pop("good")
        self.app.auth.forget()
        self.n.run_once(NOW)
        self.assertEqual(self.n.problem["code"], "needs_login")
        self.assertFalse(self.n.armed())
        self.assertEqual(self.call("GET", f"/nudges/{CHILD}", token="dad")[1]["armed"], True)
        self.assertEqual(self.call("GET", "/health", token="dad")[1]["nudges"]["armed"], True)
        self.assertEqual(self.call("GET", "/nudges", token="dad")[0], 404)

    def test_reminders_table_gained_its_columns_on_an_old_database(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            store = bs.Store(os.path.join(tmp.name, "old.db"))  # the base schema: no url/user_id/anchor
            self.assertNotIn("anchor", {r["name"] for r in store.q("PRAGMA table_info(reminders)")})
            nd.Nudges(store, "http://127.0.0.1:1", data_dir=tmp.name)
            self.assertLessEqual({"url", "user_id", "anchor"}, {r["name"] for r in store.q("PRAGMA table_info(reminders)")})
            self.assertIn("reminders_anchor", {r["name"] for r in store.q("PRAGMA index_list(reminders)")})
            nd.Nudges(store, "http://127.0.0.1:1", data_dir=tmp.name)  # twice is fine
            store.conn.close()
        finally:
            tmp.cleanup()


class FrozenNow:
    """weight_imported() takes no `now`; pin the module clock for it."""

    def __init__(self, module, now: datetime):
        self.module, self.now = module, now

    def __enter__(self):
        self._orig = self.module.datetime
        now = self.now

        class _Frozen(datetime):
            @classmethod
            def now(cls, tz=None):
                return now.astimezone(tz) if tz else now.replace(tzinfo=None)

        self.module.datetime = _Frozen
        return self

    def __exit__(self, *exc):
        self.module.datetime = self._orig


if __name__ == "__main__":
    unittest.main()
