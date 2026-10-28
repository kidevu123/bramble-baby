"""Tests for People (people.py, people_django.py): Baby Buddy logins managed from Bramble.

Baby Buddy's Django is `testdata/fake_manage.py`, copied into a temporary BABYBUDDY_HOME: it executes the
real people_django.py against stub Django modules and keeps users in users.json. The fake Baby Buddy HTTP
server here reads that same file, so a login created through the companion is one /api/profile accepts.

Run with the rest: `python3 -m unittest server/test_server.py server/test_hatch.py server/test_people.py`.
"""
from __future__ import annotations

import io
import json
import logging
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bramble_server as bs  # noqa: E402
import people as people_mod  # noqa: E402
import test_hatch  # noqa: E402  (the fake Hatch cloud, for the "Hatch holds a removed person's token" test)

HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_MANAGE = os.path.join(HERE, "testdata", "fake_manage.py")
ADMIN_TOKEN = "mocktoken0000000000000000000000000000000"
MOM_PASSWORD = "walnut-cradle-77"


def _send(handler, status, body):
    raw = json.dumps(body).encode() if body is not None else b""
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


class FakeBabyBuddy(BaseHTTPRequestHandler):
    """Token check from the fake manage.py's users.json, like Baby Buddy's TokenAuthentication (inactive = refused)."""

    state_path = ""
    weights: list[dict] = []

    def log_message(self, *a):
        pass

    def _user(self):
        token = (self.headers.get("Authorization") or "").replace("Token ", "")
        try:
            with open(self.state_path, encoding="utf-8") as fh:
                users = json.load(fh)["users"]
        except (OSError, ValueError):
            users = [{"id": 1, "username": "admin", "is_staff": True, "is_active": True, "token": ADMIN_TOKEN}]
        return next((u for u in users if u.get("token") == token and u.get("is_active", True)), None)

    def _route(self, method):
        user = self._user()
        if user is None:
            return _send(self, 401, {"detail": "User inactive or deleted."})
        path = urlparse(self.path).path
        if path == "/api/profile":
            return _send(self, 200, {"user": {"id": user["id"], "username": user["username"], "first_name": user.get("first_name", ""), "last_name": "", "email": "", "is_staff": user.get("is_staff", False)}, "api_key": user["token"]})
        if path == "/api/children/":
            return _send(self, 200, {"count": 1, "next": None, "previous": None, "results": [{"id": 3, "first_name": "Ada", "last_name": "L"}]})
        if path == "/api/weight/" and method == "GET":
            return _send(self, 200, {"count": len(self.weights), "next": None, "previous": None, "results": list(self.weights)})
        if path == "/api/weight/" and method == "POST":
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            row = {"id": 100 + len(self.weights), **body, "tags": []}
            self.weights.append(row)
            return _send(self, 201, row)
        _send(self, 404, {"detail": "Not found."})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")


class PeopleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bb_srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeBabyBuddy)
        cls.hatch_srv = ThreadingHTTPServer(("127.0.0.1", 0), test_hatch.FakeHatch)
        for srv in (cls.bb_srv, cls.hatch_srv):
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        cls.logs = io.StringIO()
        cls.handler = logging.StreamHandler(cls.logs)
        cls.level = logging.getLogger("bramble").level
        logging.getLogger("bramble").addHandler(cls.handler)
        logging.getLogger("bramble").setLevel(logging.DEBUG)

    @classmethod
    def tearDownClass(cls):
        logging.getLogger("bramble").removeHandler(cls.handler)
        logging.getLogger("bramble").setLevel(cls.level)
        for srv in (cls.bb_srv, cls.hatch_srv):
            srv.shutdown()
            srv.server_close()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "babybuddy")
        os.makedirs(self.home)
        shutil.copy(FAKE_MANAGE, os.path.join(self.home, "manage.py"))
        FakeBabyBuddy.state_path = os.path.join(self.home, "users.json")
        FakeBabyBuddy.weights = []
        test_hatch.W.reset()
        self._env = {k: os.environ.get(k) for k in ("BABYBUDDY_HOME", "BABYBUDDY_PYTHON", "BABYBUDDY_USER", "BRAMBLE_PEOPLE_BRIDGE", "DJANGO_SETTINGS_MODULE")}
        os.environ["BABYBUDDY_HOME"] = self.home
        os.environ["BABYBUDDY_PYTHON"] = sys.executable
        os.environ["BRAMBLE_PEOPLE_BRIDGE"] = os.path.join(self.tmp.name, "no-bridge")
        for k in ("BABYBUDDY_USER", "DJANGO_SETTINGS_MODULE"):
            os.environ.pop(k, None)
        self.db = os.path.join(self.tmp.name, "t.db")
        self.srv = None
        self.boot()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.app.store.conn.close()
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def boot(self):
        if self.srv:
            self.srv.shutdown()
            self.srv.server_close()
            self.app.store.conn.close()
        self.app, _ = bs.build(self.db, os.path.join(self.tmp.name, "vapid"), f"http://127.0.0.1:{self.bb_srv.server_port}")
        self.app.hatch.base = f"http://127.0.0.1:{self.hatch_srv.server_port}"
        self.app.hatch.page_pause = 0
        self.srv = bs.serve("127.0.0.1", 0, self.app)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_port}"

    def call(self, method, path, body=None, token=ADMIN_TOKEN):
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

    def users(self) -> dict:
        if not os.path.exists(FakeBabyBuddy.state_path):  # nothing written yet: the fake's default household
            return {"admin": {"id": 1, "username": "admin", "is_staff": True, "is_superuser": True, "is_active": True, "token": ADMIN_TOKEN}}
        with open(FakeBabyBuddy.state_path, encoding="utf-8") as fh:
            return {u["username"]: u for u in json.load(fh)["users"]}

    def calls(self) -> list[dict]:
        with open(os.path.join(self.home, "calls.json"), encoding="utf-8") as fh:
            return json.load(fh)

    def add_mom(self, **extra):
        return self.call("POST", "/people", {"username": "mom", "password": MOM_PASSWORD, "role": "mom", "name": "Sara", **extra})

    # ---- availability
    def test_health_says_whether_people_management_works_and_names_what_to_set(self):
        status, body = self.call("GET", "/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(body["people"], {"available": True, "problem": None, "django": "5.2.fake"})
        self.assertNotIn("admin", json.dumps(body["people"]))
        os.environ["BABYBUDDY_HOME"] = os.path.join(self.tmp.name, "nowhere")
        self.app.people.django.status(refresh=True)
        body = self.call("GET", "/health", token=None)[1]
        self.assertFalse(body["people"]["available"])
        self.assertIn("BABYBUDDY_HOME", body["people"]["problem"])
        self.assertIn("/opt/bramble-server/data/env", body["people"]["problem"])
        os.environ.pop("BABYBUDDY_HOME")
        self.assertIn("manage.py was not found", self.app.people.django.status(refresh=True)["problem"])

    def test_a_broken_layout_is_explained_in_plain_language(self):
        with open(os.path.join(self.home, "broken"), "w") as fh:
            fh.write("")
        problem = self.app.people.django.status(refresh=True)["problem"]
        self.assertIn("cannot import Django", problem)
        self.assertIn("BABYBUDDY_PYTHON", problem)
        status, body = self.add_mom()
        self.assertEqual(status, 503)
        self.assertTrue(body["unavailable"])
        self.assertIn("BABYBUDDY_PYTHON", body["detail"])

    def test_layout_detection_prefers_overrides_then_the_usual_places(self):
        present = {"/opt/babybuddy/manage.py", "/opt/babybuddy/.venv/bin/python", "/opt/babybuddy/babybuddy/settings/production.py"}
        layout = people_mod.detect_layout({}, exists=lambda p: p in present, which=lambda n: None)
        self.assertEqual((layout["home"], layout["python"], layout["settings_module"], layout["problem"]), ("/opt/babybuddy", "/opt/babybuddy/.venv/bin/python", "babybuddy.settings.production", None))
        layout = people_mod.detect_layout({"BABYBUDDY_HOME": "/srv/bb", "BABYBUDDY_PYTHON": "/srv/bb/venv/bin/python3"}, exists=lambda p: p in present | {"/srv/bb/manage.py", "/srv/bb/venv/bin/python3"}, which=lambda n: None)
        self.assertEqual((layout["home"], layout["python"], layout["settings_module"], layout["problem"]), ("/srv/bb", "/srv/bb/venv/bin/python3", None, None))
        layout = people_mod.detect_layout({"BABYBUDDY_HOME": "/srv/bb"}, exists=lambda p: False, which=lambda n: None)
        self.assertIn("no manage.py in it", layout["problem"])
        layout = people_mod.detect_layout({}, exists=lambda p: p == "/opt/babybuddy/manage.py", which=lambda n: None)
        self.assertIn("BABYBUDDY_PYTHON", layout["problem"])
        # Baby Buddy owned by another user and no bridge: say so, rather than fail later with a permission error.
        layout = people_mod.detect_layout({"BABYBUDDY_USER": "www-data"}, exists=lambda p: p in present, which=lambda n: None)
        self.assertIn("people-bridge", layout["problem"])
        self.assertIn("www-data", layout["problem"])

    # ---- add / change / remove
    def test_admin_adds_a_person_who_can_then_sign_in_and_see_herself(self):
        status, body = self.add_mom()
        self.assertEqual(status, 201, body)
        self.assertEqual((body["username"], body["role"], body["name"], body["label"], body["active"], body["you"]), ("mom", "mom", "Sara", "Mom", True, False))
        mom = self.users()["mom"]
        self.assertEqual((mom["is_staff"], mom["is_superuser"], mom["is_active"], mom["first_name"]), (False, True, True, "Sara"))
        self.assertTrue(mom["token"], "the API token is created with the login")
        self.assertEqual(mom["password"], MOM_PASSWORD)
        # Mom's new token works against Baby Buddy, so it works for the companion too.
        status, listing = self.call("GET", "/people", token=mom["token"])
        self.assertEqual(status, 200)
        self.assertFalse(listing["canManage"])
        self.assertEqual(listing["you"], "mom")
        rows = {p["username"]: p for p in listing["people"]}
        self.assertTrue(rows["mom"]["you"])
        self.assertEqual(rows["admin"]["label"], "Admin")  # no role yet: the username, capitalised
        self.assertTrue(rows["admin"]["staff"])
        # The password went through the child's environment and stdin only.
        for call in self.calls():
            self.assertEqual(call["argv"], ["shell"])
            self.assertIn("BRAMBLE_PEOPLE_REQUEST", call["env_keys"])
            self.assertTrue(call["stdin_is_script"])
            self.assertNotIn(MOM_PASSWORD, json.dumps(call))
        self.assertNotIn(MOM_PASSWORD, self.logs.getvalue())
        self.assertNotIn(MOM_PASSWORD, json.dumps(body))
        self.assertNotIn(mom["token"], self.logs.getvalue())

    def test_the_listing_reuses_djangos_user_list_until_the_sheet_asks_for_a_fresh_one(self):
        self.call("GET", "/people")
        self.call("GET", "/people")
        lists = lambda: sum(1 for c in self.calls() if "stdin_is_script" in c)  # one Django run per list/probe  # noqa: E731
        before = lists()
        self.call("GET", "/people")
        self.assertEqual(lists(), before)  # Home, Reports and Stash reading names do not start Django
        self.call("GET", "/people?fresh=1")
        self.assertEqual(lists(), before + 1)
        self.add_mom()
        mom_token = self.users()["mom"]["token"]
        self.call("GET", "/people", token=mom_token)  # refills the list once after the change
        before = lists()
        self.call("GET", "/people?fresh=1", token=mom_token)
        self.assertEqual(lists(), before)  # only an admin can make the server start Django on demand
        # A fix on the server shows up when the sheet opens, not after the probe cache has run out.
        os.environ["BABYBUDDY_HOME"] = os.path.join(self.tmp.name, "nowhere")
        self.app.people.django.status(refresh=True)
        os.environ["BABYBUDDY_HOME"] = self.home
        self.assertFalse(self.call("GET", "/people")[1]["management"]["available"])
        self.assertTrue(self.call("GET", "/people?fresh=1")[1]["management"]["available"])

    def test_add_is_refused_for_bad_input_and_a_name_that_exists(self):
        self.assertEqual(self.add_mom(username="")[0], 400)
        self.assertEqual(self.add_mom(role="auntie")[0], 400)
        self.assertEqual(self.add_mom(role="other", name="")[0], 400)
        status, body = self.add_mom(password="short")
        self.assertEqual(status, 400)
        self.assertIn("at least 8 characters", body["detail"])
        status, body = self.add_mom(username="admin")
        self.assertEqual((status, body["detail"]), (409, "There is already a Baby Buddy login called admin."))
        status, body = self.add_mom(username="mom sara")
        self.assertEqual(status, 400)
        self.assertIn("no spaces", body["detail"])
        self.assertEqual(self.add_mom()[0], 201)
        status, body = self.add_mom()
        self.assertEqual((status, body["detail"]), (409, "mom is already in the household."))

    def test_only_an_admin_manages_people_but_anyone_can_change_their_own_name_and_password(self):
        self.add_mom()
        mom_token = self.users()["mom"]["token"]
        self.assertEqual(self.call("POST", "/people", {"username": "nanny", "password": "clover-meadow-12", "role": "nanny"}, token=mom_token)[0], 403)
        self.assertEqual(self.call("PATCH", "/people/admin", {"role": "dad"}, token=mom_token)[0], 403)
        self.assertEqual(self.call("DELETE", "/people/admin", token=mom_token)[0], 403)
        status, body = self.call("PATCH", "/people/mom", {"name": "Sarah", "password": "new-meadow-clover-9"}, token=mom_token)
        self.assertEqual((status, body["name"], body["label"]), (200, "Sarah", "Mom"))
        self.assertEqual(self.users()["mom"]["password"], "new-meadow-clover-9")
        self.assertEqual(self.users()["mom"]["first_name"], "Sarah")
        self.assertEqual(self.users()["mom"]["token"], mom_token)  # changing your own password keeps this phone signed in
        self.assertEqual(self.call("PATCH", "/people/mom", {"password": "x" * 129}, token=mom_token)[0], 400)
        # The admin resetting Mom's password (a lost phone) retires her token; she signs in again with the new one.
        status, body = self.call("PATCH", "/people/mom", {"password": "lost-phone-reset-4"})
        self.assertEqual(status, 200)
        self.assertNotEqual(self.users()["mom"]["token"], mom_token)
        self.assertTrue(self.users()["mom"]["token"])
        self.assertEqual(self.call("GET", "/people", token=mom_token)[0], 401)
        self.assertEqual(self.call("GET", "/people", token=self.users()["mom"]["token"])[0], 200)
        # The Django script enforces the same rule on its own, whatever the companion sends.
        proc = self._script({"op": "update", "caller": self.users()["mom"]["id"], "username": "admin", "is_active": False})
        self.assertEqual((proc["ok"], proc["error"]), (False, "not_allowed"))

    def test_roles_and_names_are_bramble_data_and_the_timeline_label_follows_them(self):
        status, body = self.call("PATCH", "/people/admin", {"role": "dad"})
        self.assertEqual((status, body["role"], body["label"], body["you"]), (200, "dad", "Dad", True))
        status, body = self.call("PATCH", "/people/admin", {"role": "other", "name": "Sam"})
        self.assertEqual((status, body["label"]), (200, "Sam"))
        self.assertEqual(self.call("PATCH", "/people/admin", {"role": "other", "name": ""})[0], 400)
        self.assertEqual(self.users()["admin"]["first_name"], "Sam")  # mirrored for Baby Buddy's own pages
        listing = self.call("GET", "/people")[1]
        self.assertEqual([p["username"] for p in listing["people"]][0], "admin")  # you first

    def test_grandparents_get_the_simple_screen_and_only_an_admin_changes_it(self):
        # A grandparent added with no screen named gets the simple one with both buttons; everyone else the full app.
        status, body = self.call("POST", "/people", {"username": "nana", "password": "clover-meadow-12", "role": "grandma"})
        self.assertEqual((status, body["screen"], body["simpleActions"]), (201, "simple", ["bottle", "diaper"]))
        self.assertEqual(self.add_mom()[1]["screen"], "full")
        nana_token = self.users()["nana"]["token"]
        listing = self.call("GET", "/people", token=nana_token)[1]
        me = next(p for p in listing["people"] if p["you"])
        self.assertEqual((me["username"], me["screen"]), ("nana", "simple"))
        # The admin narrows it to diapers only; the order is the screen's own, duplicates and case do not matter.
        status, body = self.call("PATCH", "/people/nana", {"simpleActions": ["DIAPER", "diaper"]})
        self.assertEqual((status, body["simpleActions"]), (200, ["diaper"]))
        self.assertEqual(self.call("PATCH", "/people/nana", {"simpleActions": []})[0], 400)
        self.assertEqual(self.call("PATCH", "/people/nana", {"simpleActions": ["laundry"]})[0], 400)
        self.assertEqual(self.call("PATCH", "/people/nana", {"screen": "tiny"})[0], 400)
        # A grandparent cannot take themselves out of it, nor can Mom (not an admin) change it.
        self.assertEqual(self.call("PATCH", "/people/nana", {"screen": "full"}, token=nana_token)[0], 403)
        self.assertEqual(self.call("PATCH", "/people/nana", {"screen": "full"}, token=self.users()["mom"]["token"])[0], 403)
        # The admin gives a confident grandparent the full app, and the simple screen to the nanny.
        self.assertEqual(self.call("PATCH", "/people/nana", {"screen": "full"})[1]["screen"], "full")
        self.assertEqual(self.call("PATCH", "/people/mom", {"role": "nanny", "screen": "simple", "simpleActions": ["bottle"]})[1]["simpleActions"], ["bottle"])
        rows = {p["username"]: p for p in self.call("GET", "/people")[1]["people"]}
        self.assertEqual((rows["nana"]["screen"], rows["mom"]["screen"], rows["admin"]["screen"]), ("full", "simple", "full"))
        # An admin cannot put their own phone on it: it has no Settings to come back from.
        self.assertEqual(self.call("PATCH", "/people/admin", {"screen": "simple"})[0], 403)

    def test_the_screen_columns_are_added_to_an_existing_people_table(self):
        store = self.app.store
        store.conn.executescript("DROP TABLE people; CREATE TABLE people (username TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'other', name TEXT NOT NULL DEFAULT '', user_id INTEGER, active INTEGER NOT NULL DEFAULT 1, staff INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, created_by INTEGER, updated TEXT NOT NULL);")
        store.x("INSERT INTO people (username, role, name, created, updated) VALUES ('papa', 'grandpa', '', 'x', 'x')")
        people = type(self.app.people)(store, self.app.people.django, self.app.people.now)
        cols = {r["name"] for r in store.q("PRAGMA table_info(people)")}
        self.assertTrue({"screen", "simple_actions"} <= cols)
        from people import screen_of
        self.assertEqual(screen_of(people.get("papa")), {"screen": "simple", "simpleActions": ["bottle", "diaper"]})

    def test_remove_deactivates_the_login_at_once_and_bring_back_restores_it(self):
        self.add_mom()
        mom_token = self.users()["mom"]["token"]
        self.assertEqual(self.call("GET", "/people", token=mom_token)[0], 200)
        status, body = self.call("DELETE", "/people/mom")
        self.assertEqual((status, body["active"]), (200, False))
        self.assertFalse(self.users()["mom"]["is_active"])
        # The companion's token cache is dropped with the change: her phone is signed out immediately, not in 10 minutes.
        self.assertEqual(self.call("GET", "/people", token=mom_token)[0], 401)
        status, body = self.add_mom()
        self.assertEqual(status, 409)
        self.assertIn("Bring them back", body["detail"])
        rows = {p["username"]: p for p in self.call("GET", "/people")[1]["people"]}
        self.assertFalse(rows["mom"]["active"])
        status, body = self.call("PATCH", "/people/mom", {"active": True})
        self.assertEqual((status, body["active"]), (200, True))
        self.assertTrue(self.users()["mom"]["is_active"])
        self.assertEqual(self.call("GET", "/people", token=mom_token)[0], 200)

    def test_a_removed_person_or_a_lost_phone_stops_getting_the_households_pushes(self):
        self.add_mom()
        self.call("POST", "/people", {"username": "nanny", "password": "clover-meadow-12", "role": "nanny"})
        users = self.users()
        mom_token, nanny_id, mom_id, admin_id = users["mom"]["token"], users["nanny"]["id"], users["mom"]["id"], users["admin"]["id"]
        sub = lambda endpoint, token: self.call("POST", "/push/subscribe", {"subscription": {"endpoint": endpoint, "keys": {"p256dh": "k", "auth": "a"}}}, token=token)  # noqa: E731
        self.assertEqual(sub("https://push.example/admin", ADMIN_TOKEN)[0], 200)
        self.assertEqual(sub("https://push.example/mom", mom_token)[0], 200)
        self.assertEqual(sub("https://push.example/nanny", users["nanny"]["token"])[0], 200)
        endpoints = lambda: {r["endpoint"]: r["user_id"] for r in self.app.store.q("SELECT endpoint, user_id FROM subscriptions")}  # noqa: E731
        self.assertEqual(endpoints(), {"https://push.example/admin": admin_id, "https://push.example/mom": mom_id, "https://push.example/nanny": nanny_id})
        # Removed: the nanny's phone is no longer on the push list (she cannot unsubscribe with a refused token).
        self.assertEqual(self.call("DELETE", "/people/nanny")[1]["active"], False)
        self.assertNotIn("https://push.example/nanny", endpoints())
        # Changing your own password keeps your phone; an admin's reset (a lost phone) takes it off the list.
        self.assertEqual(self.call("PATCH", "/people/mom", {"password": "new-meadow-clover-9"}, token=mom_token)[0], 200)
        self.assertIn("https://push.example/mom", endpoints())
        self.assertEqual(self.call("PATCH", "/people/mom", {"password": "lost-phone-reset-4"})[0], 200)
        self.assertEqual(endpoints(), {"https://push.example/admin": admin_id})
        # A role or name change touches nothing.
        self.assertEqual(self.call("PATCH", "/people/admin", {"role": "dad"})[0], 200)
        self.assertEqual(endpoints(), {"https://push.example/admin": admin_id})

    def test_the_username_in_the_path_is_percent_decoded(self):
        self.add_mom()
        status, body = self.call("PATCH", "/people/m%6Fm", {"name": "Sal"})  # the app sends encodeURIComponent(username)
        self.assertEqual((status, body["username"], body["name"]), (200, "mom", "Sal"))
        self.assertEqual(sorted(p["username"] for p in self.call("GET", "/people")[1]["people"]), ["admin", "mom"])

    def test_an_admin_cannot_remove_themselves(self):
        status, body = self.call("DELETE", "/people/admin")
        self.assertEqual(status, 403)
        self.assertIn("cannot remove yourself", body["detail"])
        self.assertTrue(self.users()["admin"]["is_active"])
        self.assertEqual(self.call("PATCH", "/people/admin", {"active": False})[0], 403)

    def test_without_the_django_channel_roles_still_work_and_passwords_say_what_to_set(self):
        self.add_mom()
        os.environ["BABYBUDDY_HOME"] = os.path.join(self.tmp.name, "nowhere")
        self.app.people.django.status(refresh=True)
        status, body = self.call("GET", "/people")
        self.assertEqual(status, 200)
        self.assertFalse(body["management"]["available"])
        self.assertIn("BABYBUDDY_HOME", body["management"]["problem"])
        self.assertEqual({p["username"] for p in body["people"]}, {"admin", "mom"})  # the table, plus you
        status, body = self.call("PATCH", "/people/mom", {"role": "grandma", "name": "Nana"})
        self.assertEqual((status, body["role"], body["label"]), (200, "grandma", "Grandma"))
        status, body = self.call("PATCH", "/people/admin", {"role": "dad"})
        self.assertEqual((status, body["staff"], body["user_id"], body["you"]), (200, True, 1, True))  # from the profile, not lost
        status, body = self.call("PATCH", "/people/mom", {"password": "another-long-one-5"})
        self.assertEqual(status, 503)
        self.assertIn("BABYBUDDY_HOME", body["detail"])
        self.assertEqual(self.call("DELETE", "/people/mom")[0], 503)
        self.assertEqual(self.call("POST", "/people", {"username": "gran", "password": "x" * 12, "role": "grandma"})[0], 503)

    # ---- the bridge wrapper (what install.sh writes): request on stdin, script by file, sudo when needed
    def test_the_bridge_wrapper_path_works_and_a_sudo_refusal_is_explained(self):
        bridge = os.path.join(self.tmp.name, "people-bridge")
        with open(bridge, "w", encoding="utf-8") as fh:
            fh.write("#!/bin/sh\n# written by install.sh\n")
            fh.write(f"BABYBUDDY_USER={people_mod.current_user()}\n")
            fh.write('REQ="$(cat)"\nexport BRAMBLE_PEOPLE_REQUEST="$REQ"\n')
            fh.write(f'exec "{sys.executable}" "{self.home}/manage.py" shell < "{HERE}/people_django.py"\n')
        os.chmod(bridge, stat.S_IRWXU)
        os.environ["BRAMBLE_PEOPLE_BRIDGE"] = bridge
        layout = self.app.people.django.layout()
        self.assertEqual((layout["bridge"], layout["user"], layout["problem"]), (bridge, people_mod.current_user(), None))
        self.assertTrue(self.app.people.django.status(refresh=True)["available"])
        self.assertEqual(self.add_mom()[0], 201)
        self.assertTrue(self.users()["mom"]["token"])
        for call in self.calls():
            self.assertNotIn(MOM_PASSWORD, json.dumps(call))
        with open(bridge, "w", encoding="utf-8") as fh:
            fh.write("#!/bin/sh\nBABYBUDDY_USER=www-data\necho 'sudo: a password is required' >&2\nexit 1\n")
        status = self.app.people.django.status(refresh=True)
        self.assertFalse(status["available"])
        self.assertIn("sudoers.d/bramble-people", status["problem"])
        self.assertIn("www-data", status["problem"])

    # ---- migration
    def test_caregiver_names_move_into_people_once_and_are_stripped_from_settings(self):
        self.app.store.x("INSERT INTO settings (child, blob) VALUES (3, ?)", (json.dumps({"dayStart": "07:00", "caregiverNames": {"admin": "Dad", "mom": "Mom", "jo": "Auntie Jo", "nan": "Nana"}}),))
        self.app.store.x("INSERT INTO settings (child, blob) VALUES (4, ?)", (json.dumps({"caregiverNames": {"admin": "Papa", "mom": "Mummy"}}),))
        self.boot()  # the migration runs at startup
        rows = {p["username"]: p for p in self.app.people.rows()}
        self.assertEqual({u: (p["role"], p["name"]) for u, p in rows.items()}, {"admin": ("dad", ""), "mom": ("mom", ""), "jo": ("other", "Auntie Jo"), "nan": ("grandma", "")})
        self.assertEqual(self.call("GET", "/settings/3")[1], {"dayStart": "07:00"})
        self.assertEqual(self.call("GET", "/settings/4")[1], {})
        # A phone with a stale local copy writes the old map back: it is dropped, the table is the only place.
        self.assertEqual(self.call("PUT", "/settings/3", {"dayStart": "06:00", "caregiverNames": {"admin": "Grandpa"}})[1], {"dayStart": "06:00"})
        self.assertEqual(self.app.people.get("admin")["role"], "dad")
        self.boot()
        self.assertEqual(self.app.people.get("admin")["role"], "dad")
        self.assertEqual(self.call("GET", "/settings/3")[1], {"dayStart": "06:00"})

    # ---- Hatch holds a person's token for its background writes
    def test_removing_the_person_hatch_signed_in_with_asks_for_a_new_sign_in(self):
        self.add_mom()
        mom_token = self.users()["mom"]["token"]
        self.call("PUT", "/settings/3", {"storageUnits": {"weight": "lb", "volume": "ml", "temp": "f", "length": "in"}})
        test_hatch.W.weigh(501, 2580, 2)
        status, body = self.call("POST", "/hatch/connect", {"email": test_hatch.EMAIL, "password": test_hatch.PASSWORD}, token=mom_token)
        self.assertEqual((status, body["connected"], body["imported"]), (200, True, 1))
        self.assertEqual(self.call("DELETE", "/people/mom")[0], 200)
        test_hatch.W.weigh(501, 2700, 0)
        self.app.hatch.run_once()
        problem = self.app.hatch.status()["problem"]
        self.assertEqual(problem["code"], "babybuddy_auth")  # the existing "sign in again" path, not a silent failure
        self.assertIn("needs refreshing", problem["message"])
        # The admin opening the Hatch sheet refreshes the token the sync writes with, as before.
        status, body = self.call("POST", "/hatch/sync")
        self.assertEqual((status, body["problem"], body["imported"]), (200, None, 2))

    # ---- the script on its own
    def _script(self, request: dict) -> dict:
        env = {**os.environ, "BRAMBLE_PEOPLE_REQUEST": json.dumps(request)}
        with open(os.path.join(HERE, "people_django.py"), encoding="utf-8") as fh:
            script = fh.read()
        proc = subprocess.run([sys.executable, os.path.join(self.home, "manage.py"), "shell"], input=script, capture_output=True, text=True, env=env, cwd=self.home, timeout=30)
        parsed = people_mod.Django._parse(proc.stdout)
        self.assertIsNotNone(parsed, proc.stderr)
        return parsed  # type: ignore[return-value]

    def test_the_django_script_compiles_and_answers_on_one_sentinel_line(self):
        with open(os.path.join(HERE, "people_django.py"), encoding="utf-8") as fh:
            compile(fh.read(), "people_django.py", "exec")
        self.assertEqual(self._script({"op": "probe"})["users"], 1)
        self.assertEqual(self._script({"op": "list", "caller": None})["error"], "not_allowed")
        self.assertEqual(self._script({"op": "nope"})["error"], "bad_request")
        answer = self._script({"op": "add", "caller": 1, "username": "dad", "password": "dad-dad-dad-dad", "first_name": ""})
        self.assertEqual((answer["ok"], answer["error"]), (False, "weak_password"))  # too similar to the username
        answer = self._script({"op": "add", "caller": 1, "username": "dad", "password": "quiet-harbour-31", "first_name": "Sam"})
        self.assertTrue(answer["ok"])
        self.assertNotIn("token", json.dumps(answer))
        self.assertNotIn("password", json.dumps(answer))
        self.assertEqual(self._script({"op": "update", "caller": 1, "username": "DAD", "is_active": False})["user"]["is_active"], False)
        self.assertEqual(self._script({"op": "update", "caller": 1, "username": "nobody", "first_name": "x"})["error"], "not_found")
        self.assertEqual(self._script({"op": "update", "caller": 1, "username": "admin", "is_active": False})["error"], "not_allowed")


if __name__ == "__main__":
    unittest.main()
