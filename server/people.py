"""People: one Baby Buddy login per caregiver, managed from Bramble's Settings.

Two halves:

  * The household's people table (`people`): username -> role (mom, dad, grandma, grandpa, nanny, other),
    display name, Baby Buddy user id, active. This is what the timeline and the duplicate warning use to
    turn a `caregiver:<username>` tag into "Mom". It replaced the per-child `caregiverNames` map in the
    shared child settings; `migrate_caregiver_names` moves what was there across once and strips it.

  * The channel to Baby Buddy's Django (`Django`): Baby Buddy's REST API has no user endpoint, so adding a
    person, changing a password and deactivating a login run `manage.py shell` with `people_django.py` on
    stdin, either directly (same user, or BABYBUDDY_* pointing at a layout we can run) or through the
    `people-bridge` wrapper install.sh writes, via sudo as Baby Buddy's own user. The request (with the
    password) travels in the child's environment, never on a command line, and is never logged. When the
    channel is not available the rest still works: roles and names can be assigned to logins that exist,
    and /health and the People sheet say what to set.
"""
from __future__ import annotations

import json
import logging
import os
import pwd
import shutil
import subprocess
import threading
import time

log = logging.getLogger("bramble")

ROLES = ("mom", "dad", "grandma", "grandpa", "nanny", "other")
ROLE_LABEL = {"mom": "Mom", "dad": "Dad", "grandma": "Grandma", "grandpa": "Grandpa", "nanny": "Nanny", "other": "Other"}
NAME_MAX = 60
PASSWORD_MAX = 128  # Django would hash anything; a bound keeps the request small and the hashing cheap
ENV_FILE = "/opt/bramble-server/data/env"
DEFAULT_BRIDGE = "/usr/local/libexec/bramble/people-bridge"  # root-owned; written by people-setup.sh
CANDIDATE_HOMES = ("/opt/babybuddy", "/srv/babybuddy", "/var/www/babybuddy", "/home/babybuddy/babybuddy", "/opt/babybuddy/babybuddy", "/app", "/usr/src/app")
VENV_PYTHONS = (".venv/bin/python", "venv/bin/python", ".venv/bin/python3", "venv/bin/python3", "env/bin/python", "virtualenv/bin/python")
SENTINEL = "@@BRAMBLE@@"
PROBE_TTL = 600  # seconds a probe answer is trusted
USERS_TTL = 600  # seconds the Django user list is reused; the People sheet asks for a fresh one when it opens
RUN_TIMEOUT = 90  # Django on a small container takes a few seconds to start
SET_HINT = f"Put BABYBUDDY_HOME=/path/to/babybuddy (the folder with manage.py) in {ENV_FILE} and run install.sh again (a deploy does)."

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
  username TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'other', name TEXT NOT NULL DEFAULT '',
  user_id INTEGER, active INTEGER NOT NULL DEFAULT 1, staff INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL, created_by INTEGER, updated TEXT NOT NULL);
"""

# The simple screen: a phone signed in as this person shows only big buttons for these actions, with the time
# always "now" (no pickers). Grandparents get it unless an admin says otherwise; anyone can be given it.
SCREENS = ("full", "simple")
SIMPLE_ACTIONS = ("bottle", "diaper")
SIMPLE_ROLES = ("grandma", "grandpa")
# Columns added to a live people table after it first shipped (ALTER TABLE ADD COLUMN at start-up).
ADDED_COLUMNS = (("screen", "TEXT"), ("simple_actions", "TEXT"))

# What the old free-text "Your name on the timeline" most likely meant, so the migration lands on a role.
ROLE_WORDS = {
    "mom": ("mom", "mum", "mommy", "mummy", "mama", "mother", "ma"),
    "dad": ("dad", "daddy", "papa", "father", "pa", "baba"),
    "grandma": ("grandma", "grandmother", "nana", "nanna", "granny", "gran", "nan", "oma", "abuela", "nani", "dadi"),
    "grandpa": ("grandpa", "grandfather", "granddad", "grandad", "gramps", "opa", "abuelo", "nanu", "dada"),
    "nanny": ("nanny", "sitter", "babysitter", "au pair"),
}


class PeopleError(Exception):
    """Plain language for the phone, with the HTTP status it deserves."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Unavailable(PeopleError):
    """The Django channel cannot be used right now; the message says what to set or fix."""

    def __init__(self, message: str):
        super().__init__(message, 503)


def current_user() -> str:
    try:
        return pwd.getpwuid(os.getuid()).pw_name
    except KeyError:  # pragma: no cover - uid without a passwd entry
        return str(os.getuid())


def detect_layout(env: dict | None = None, exists=os.path.exists, which=shutil.which) -> dict:
    """Where Baby Buddy's Django lives. Environment overrides first, then the usual places.

    Returns home, python, settings_module, bridge, user and problem (None when the layout can be run).
    """
    env = os.environ if env is None else env
    bridge = (env.get("BRAMBLE_PEOPLE_BRIDGE") or DEFAULT_BRIDGE).strip()
    bridge_ok = bool(bridge) and exists(bridge) and os.access(bridge, os.X_OK)
    home = (env.get("BABYBUDDY_HOME") or "").strip().rstrip("/") or None
    if home and not exists(os.path.join(home, "manage.py")):
        home_problem = f"BABYBUDDY_HOME is {home} but there is no manage.py in it. Fix the path in {ENV_FILE} and run install.sh again (a deploy does)."
    else:
        home_problem = None
        if not home:
            home = next((h for h in CANDIDATE_HOMES if exists(os.path.join(h, "manage.py"))), None)
    python = (env.get("BABYBUDDY_PYTHON") or "").strip() or None
    if python and not exists(python):
        python_problem = f"BABYBUDDY_PYTHON is {python} but that file does not exist. Fix it in {ENV_FILE}."
    else:
        python_problem = None
        if not python and home:
            python = next((os.path.join(home, p) for p in VENV_PYTHONS if exists(os.path.join(home, p))), None) or which("python3")
    settings_module = (env.get("DJANGO_SETTINGS_MODULE") or env.get("BABYBUDDY_SETTINGS") or "").strip() or None
    if not settings_module and home and exists(os.path.join(home, "babybuddy", "settings", "production.py")):
        settings_module = "babybuddy.settings.production"
    user = (env.get("BABYBUDDY_USER") or "").strip() or None
    me = current_user()

    problem = None
    if bridge_ok:
        user = user or _bridge_user(bridge)
    elif home_problem:
        problem = home_problem
    elif not home:
        problem = f"Baby Buddy's manage.py was not found (looked in {', '.join(CANDIDATE_HOMES[:4])}, …). {SET_HINT}"
    elif python_problem:
        problem = python_problem
    elif not python:
        problem = f"No Python for Baby Buddy was found next to {home} (no .venv or venv). Put BABYBUDDY_PYTHON=/path/to/python in {ENV_FILE}."
    elif user and user != me:
        problem = f"Baby Buddy runs as {user} but the companion runs as {me} and the people-bridge wrapper is missing. Run install.sh again (a deploy does) so it can write {bridge} and its sudo rule."
    return {"home": home, "python": python, "settings_module": settings_module, "bridge": bridge if bridge_ok else None, "user": user, "problem": problem}


def _bridge_user(bridge: str) -> str | None:
    """The `BABYBUDDY_USER=` line install.sh wrote into the wrapper: who Django must run as."""
    try:
        with open(bridge, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("BABYBUDDY_USER="):
                    return line.split("=", 1)[1].strip().strip("'\"") or None
    except OSError:
        pass
    return None


class Django:
    """The channel to Baby Buddy's Django: runs people_django.py and parses its one-line answer."""

    def __init__(self, env: dict | None = None, here: str | None = None, run=subprocess.run):
        self.env = os.environ if env is None else env
        self.here = here or os.path.dirname(os.path.abspath(__file__))
        self._run = run
        self._probe: dict | None = None
        self._probe_at = 0.0
        self._lock = threading.Lock()  # the cached probe answer
        self._probe_lock = threading.Lock()  # one probe at a time; readers of a fresh answer never wait on it

    def layout(self) -> dict:
        return detect_layout(self.env)

    # ---- availability, for /health and the People sheet
    def _cached(self, refresh: bool) -> dict | None:
        with self._lock:
            if not refresh and self._probe and time.monotonic() - self._probe_at < PROBE_TTL:
                return dict(self._probe)
            return None

    def status(self, refresh: bool = False) -> dict:
        """{"available": bool, "problem": str | None, "django": version | None}. Probes at most every PROBE_TTL."""
        cached = self._cached(refresh)
        if cached is not None:
            return cached
        with self._probe_lock:
            cached = self._cached(refresh)  # another thread may have just probed
            if cached is not None:
                return cached
            layout = self.layout()
            if layout["problem"]:
                result = {"available": False, "problem": layout["problem"], "django": None}
            else:
                try:
                    answer = self._call({"op": "probe"}, layout)
                    result = {"available": True, "problem": None, "django": answer.get("django")}
                except PeopleError as exc:
                    result = {"available": False, "problem": str(exc), "django": None}
            with self._lock:
                self._probe, self._probe_at = result, time.monotonic()
            log.info("people management %s%s", "available" if result["available"] else "unavailable", f": {result['problem']}" if result["problem"] else "")
            return dict(result)

    def last_available(self) -> bool:
        with self._lock:
            return bool(self._probe and self._probe["available"])

    def warm(self) -> None:
        """Probe in the background at startup so the first /health is instant."""
        threading.Thread(target=self.status, name="bramble-people-probe", daemon=True).start()

    # ---- one request
    def run(self, request: dict) -> dict:
        """Run one operation; returns the script's payload. Raises Unavailable (channel) or PeopleError (refused)."""
        layout = self.layout()
        if layout["problem"]:
            raise Unavailable(layout["problem"])
        try:
            answer = self._call(request, layout)
        except Unavailable:
            with self._lock:  # the next /health re-probes instead of trusting a stale "available"
                self._probe = None
            raise
        return answer

    def _call(self, request: dict, layout: dict) -> dict:
        payload = json.dumps(request)
        env = {k: v for k, v in self.env.items() if k in ("PATH", "LANG", "LC_ALL", "HOME", "TMPDIR")}
        env.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
        if layout["bridge"]:
            # The wrapper reads the request from its stdin, exports it, and feeds the script to Django.
            cmd = [layout["bridge"]]
            run_as = layout["user"]
            if run_as and run_as != current_user():
                cmd = ["sudo", "-n", "-u", run_as] + cmd
            stdin, cwd = payload, None
        else:
            with open(os.path.join(self.here, "people_django.py"), encoding="utf-8") as fh:
                script = fh.read()
            cmd = [layout["python"], os.path.join(layout["home"], "manage.py"), "shell"]
            env["BRAMBLE_PEOPLE_REQUEST"] = payload
            if layout["settings_module"]:
                env["DJANGO_SETTINGS_MODULE"] = layout["settings_module"]
            stdin, cwd = script, layout["home"]
        started = time.monotonic()
        try:
            proc = self._run(cmd, input=stdin, capture_output=True, text=True, timeout=RUN_TIMEOUT, env=env, cwd=cwd)
        except subprocess.TimeoutExpired:
            raise Unavailable(f"Baby Buddy's Django did not answer within {RUN_TIMEOUT} seconds.") from None
        except OSError as exc:
            raise Unavailable(f"Could not start Baby Buddy's Django ({cmd[0]}): {exc.strerror or exc}.") from None
        ms = int((time.monotonic() - started) * 1000)
        answer = self._parse(proc.stdout or "")
        if answer is None:
            raise Unavailable(self._describe_failure(proc, layout))
        log.info("people %s %s -> %s (%d ms)", request.get("op"), request.get("username") or "", "ok" if answer.get("ok") else answer.get("error"), ms)
        if not answer.get("ok"):
            status = {"not_allowed": 403, "not_found": 404, "taken": 409, "django": 502}.get(str(answer.get("error")), 400)
            raise PeopleError(str(answer.get("message") or "Baby Buddy refused the change."), status)
        return answer

    @staticmethod
    def _parse(stdout: str) -> dict | None:
        for line in reversed(stdout.splitlines()):
            if line.startswith(SENTINEL):
                try:
                    data = json.loads(line[len(SENTINEL):].strip())
                except ValueError:
                    return None
                return data if isinstance(data, dict) else None
        return None

    @staticmethod
    def _describe_failure(proc, layout: dict) -> str:
        err = (proc.stderr or "").strip()
        last = err.splitlines()[-1].strip() if err else ""
        if "sudo" in (last or "").lower() or proc.returncode == 1 and ("password" in last.lower() or "not allowed" in last.lower()):
            who = layout.get("user") or "Baby Buddy's user"
            return f"The companion is not allowed to run Baby Buddy's Django as {who} (sudo: {last or 'refused'}). Run install.sh again (a deploy does) so it writes /etc/sudoers.d/bramble-people, or add it by hand."
        if "ModuleNotFoundError" in err or "ImportError" in err:
            return f"Baby Buddy's Python at {layout.get('python')} cannot import Django ({last}). Set BABYBUDDY_PYTHON in {ENV_FILE} to the interpreter of Baby Buddy's virtualenv."
        if "ImproperlyConfigured" in err or "settings" in last.lower():
            return f"Baby Buddy's settings could not be loaded ({last}). Set DJANGO_SETTINGS_MODULE in {ENV_FILE} to what Baby Buddy itself runs with (usually babybuddy.settings.production)."
        if "OperationalError" in err or "no such table" in err or "readonly database" in err:
            return f"Baby Buddy's database could not be used ({last}). Django must run as the user who owns the database and its folder must be open to the companion's service: set BABYBUDDY_USER in {ENV_FILE} and run install.sh again (it writes the sudo rule and the systemd drop-in with the database folder)."
        return f"Baby Buddy's Django did not answer (exit {proc.returncode}{': ' + last if last else ''})."


def guess_role(text: str) -> tuple[str, str]:
    """"Mom" -> (mom, ""), "Nana" -> (grandma, ""), "Auntie Jo" -> (other, "Auntie Jo")."""
    clean = (text or "").strip()
    key = clean.lower().rstrip(".!")
    for role, words in ROLE_WORDS.items():
        if key in words:
            return role, ""
    return "other", clean[:NAME_MAX]


def label(person: dict) -> str:
    """What the timeline shows for a person."""
    role = person.get("role")
    if role and role != "other":
        return ROLE_LABEL[role]
    name = (person.get("name") or "").strip()
    if name:
        return name
    username = str(person.get("username") or "")
    return username[:1].upper() + username[1:]


def screen_of(person: dict) -> dict:
    """What a phone signed in as this person shows: the screen set for them, else the simple one for a
    grandparent and the full app for everyone else; the simple screen's actions, else all of them."""
    screen = person.get("screen") if person.get("screen") in SCREENS else ("simple" if person.get("role") in SIMPLE_ROLES else "full")
    actions = person.get("simple_actions") or list(SIMPLE_ACTIONS)
    return {"screen": screen, "simpleActions": [a for a in SIMPLE_ACTIONS if a in actions]}


def _screen_fields(data: dict) -> dict:
    """`screen` and `simpleActions` from a request, checked; {} when neither is there."""
    out: dict = {}
    if "screen" in data:
        screen = str(data.get("screen") or "").strip().lower()
        if screen not in SCREENS:
            raise PeopleError("Pick the full app or the simple screen.")
        out["screen"] = screen
    if "simpleActions" in data:
        raw = data.get("simpleActions")
        if not isinstance(raw, list) or not all(isinstance(a, str) for a in raw):
            raise PeopleError("Pick what the simple screen shows: bottle, diaper or both.")
        actions = [a for a in SIMPLE_ACTIONS if a in {x.strip().lower() for x in raw}]
        if not actions:
            raise PeopleError("The simple screen needs at least one button: bottle or diaper.")
        out["simple_actions"] = actions
    return out


class People:
    def __init__(self, store, django: Django, now_iso):
        self.store = store
        self.django = django
        self.now = now_iso
        store.conn.executescript(SCHEMA)
        have = {r["name"] for r in store.q("PRAGMA table_info(people)")}
        for column, kind in ADDED_COLUMNS:
            if column not in have:
                store.conn.execute(f"ALTER TABLE people ADD COLUMN {column} {kind}")
        self._users: list[dict] | None = None
        self._users_at = 0.0
        self._users_lock = threading.Lock()
        self.migrate_caregiver_names()

    # ---- migration from the per-child caregiverNames map
    def migrate_caregiver_names(self) -> int:
        moved = 0
        for row in self.store.q("SELECT child, blob FROM settings"):
            try:
                blob = json.loads(row["blob"])
            except ValueError:
                continue
            names = blob.pop("caregiverNames", None) if isinstance(blob, dict) else None
            if names is None:
                continue
            if isinstance(names, dict):
                for username, text in names.items():
                    if not isinstance(username, str) or not username.strip() or not isinstance(text, str) or not text.strip():
                        continue
                    if self.get(username) is None:
                        role, name = guess_role(text)
                        self._upsert(username.strip(), role=role, name=name)
                        moved += 1
            self.store.x("UPDATE settings SET blob=? WHERE child=?", (json.dumps(blob), row["child"]))
        if moved:
            log.info("people: moved %d caregiver names from child settings", moved)
        return moved

    @staticmethod
    def strip_settings(blob: dict) -> dict:
        """Settings PUT from a phone that still carries the old map: the people table is the only place now."""
        if isinstance(blob, dict) and "caregiverNames" in blob:
            return {k: v for k, v in blob.items() if k != "caregiverNames"}
        return blob

    # ---- table
    def get(self, username: str) -> dict | None:
        rows = self.store.q("SELECT * FROM people WHERE username=? COLLATE NOCASE", (username.strip(),))
        return self._row(rows[0]) if rows else None

    def rows(self) -> list[dict]:
        return [self._row(r) for r in self.store.q("SELECT * FROM people ORDER BY username")]

    @staticmethod
    def _row(r: dict) -> dict:
        out = dict(r)
        out["active"] = bool(out["active"])
        out["staff"] = bool(out["staff"])
        try:
            actions = json.loads(out.get("simple_actions") or "null")
        except ValueError:
            actions = None
        out["simple_actions"] = [a for a in actions if a in SIMPLE_ACTIONS] if isinstance(actions, list) else None
        return out

    def _upsert(self, username: str, **fields) -> dict:
        now = self.now()
        existing = self.get(username)
        if existing is None:
            self.store.x(
                "INSERT INTO people (username, role, name, user_id, active, staff, created, created_by, updated) VALUES (?,?,?,?,?,?,?,?,?)",
                (username, fields.get("role", "other"), fields.get("name", ""), fields.get("user_id"), int(fields.get("active", True)), int(fields.get("staff", False)), now, fields.get("created_by"), now),
            )
            return self.get(username)  # type: ignore[return-value]
        allowed = {k: v for k, v in fields.items() if k in ("role", "name", "user_id", "active", "staff", "screen", "simple_actions")}
        if "simple_actions" in allowed:
            allowed["simple_actions"] = json.dumps(allowed["simple_actions"]) if allowed["simple_actions"] is not None else None
        if not allowed:
            return existing
        sets = ", ".join(f"{k}=?" for k in allowed) + ", updated=?"
        values = [int(v) if k in ("active", "staff") else v for k, v in allowed.items()] + [now, existing["username"]]
        self.store.x(f"UPDATE people SET {sets} WHERE username=?", values)
        return self.get(username)  # type: ignore[return-value]

    # ---- Django's user list, reused for a short while
    def django_users(self, caller_id: int, refresh: bool = False) -> list[dict] | None:
        """Baby Buddy's accounts when the channel works, else None. Never raises."""
        with self._users_lock:
            if not refresh and self._users is not None and time.monotonic() - self._users_at < USERS_TTL:
                return list(self._users)
            try:
                users = self.django.run({"op": "list", "caller": caller_id}).get("users")
            except PeopleError:
                return None
            if not isinstance(users, list):
                return None
            self._users, self._users_at = [u for u in users if isinstance(u, dict)], time.monotonic()
            return list(self._users)

    def forget_users(self) -> None:
        with self._users_lock:
            self._users = None

    # ---- what the sheet shows
    def listing(self, caller: dict, fresh: bool = False) -> dict:
        """What the sheet shows. `fresh` (admins only: each one starts Django) asks Baby Buddy again instead of reusing its last user list."""
        fresh = fresh and bool(caller.get("is_staff"))
        # Opening the sheet after a fix should not wait out the probe cache: re-probe when the last answer was "no".
        management = self.django.status(refresh=fresh and not self.django.last_available())
        people = {p["username"].lower(): p for p in self.rows()}
        if management["available"]:
            for u in self.django_users(caller["id"], refresh=fresh) or []:
                key = str(u.get("username", "")).lower()
                if not key:
                    continue
                row = people.get(key)
                if row is None:
                    people[key] = {"username": u["username"], "role": None, "name": u.get("first_name") or "", "user_id": u.get("id"), "active": bool(u.get("is_active", True)), "staff": bool(u.get("is_staff"))}
                else:
                    changed = {}
                    if row.get("user_id") != u.get("id"):
                        changed["user_id"] = u.get("id")
                    if row["active"] != bool(u.get("is_active", True)):
                        changed["active"] = bool(u.get("is_active", True))
                    if row["staff"] != bool(u.get("is_staff")):
                        changed["staff"] = bool(u.get("is_staff"))
                    if changed:
                        people[key] = self._upsert(row["username"], **changed)
        me = caller["username"].lower()
        if me not in people:
            people[me] = {"username": caller["username"], "role": None, "name": "", "user_id": caller["id"], "active": True, "staff": bool(caller.get("is_staff"))}
        out = []
        for p in people.values():
            person = {k: p.get(k) for k in ("username", "role", "name", "user_id", "active", "staff")}
            person.update(screen_of(p))
            person["label"] = label(person)
            person["you"] = person["username"].lower() == me
            out.append(person)
        out.sort(key=lambda p: (not p["you"], not p["active"], (p["role"] or "zz") == "other", p["label"].lower()))
        return {"people": out, "you": caller["username"], "canManage": bool(caller.get("is_staff")), "management": {"available": management["available"], "problem": management["problem"]}}

    # ---- http
    def http(self, method: str, parts: list[str], data: dict, caller: dict, on_change=None, query: dict | None = None):
        try:
            if len(parts) == 1:
                if method == "GET":
                    return 200, self.listing(caller, fresh=str((query or {}).get("fresh", "")).lower() in ("1", "true", "yes"))
                if method == "POST":
                    person = self.add(data, caller)
                    if on_change:
                        on_change()
                    return 201, person
                return 405, {"detail": "Method not allowed."}
            if len(parts) == 2:
                username = parts[1]
                if method == "PATCH":
                    person = self.change(username, data, caller)
                elif method == "DELETE":
                    person = self.change(username, {"active": False}, caller)
                else:
                    return 405, {"detail": "Method not allowed."}
                if on_change:
                    on_change()
                return 200, person
            return 404, {"detail": "Not found."}
        except PeopleError as exc:
            return exc.status, {"detail": str(exc), "unavailable": isinstance(exc, Unavailable)}

    def _person(self, username: str, caller: dict) -> dict:
        row = self.get(username) or {"username": username, "role": None, "name": "", "user_id": None, "active": True, "staff": False}
        person = {k: row.get(k) for k in ("username", "role", "name", "user_id", "active", "staff")}
        person.update(screen_of(row))
        person["label"] = label(person)
        person["you"] = person["username"].lower() == caller["username"].lower()
        return person

    @staticmethod
    def _role(value) -> str:
        role = str(value or "").strip().lower()
        if role not in ROLES:
            raise PeopleError("Pick a role: Mom, Dad, Grandma, Grandpa, Nanny or Other.")
        return role

    @staticmethod
    def _name(value) -> str:
        return str(value or "").strip()[:NAME_MAX]

    @staticmethod
    def _password(value) -> str:
        if not isinstance(value, str) or not value:
            raise PeopleError("A password is needed.")
        if len(value) > PASSWORD_MAX:
            raise PeopleError(f"Keep the password under {PASSWORD_MAX} characters.")
        return value

    def add(self, data: dict, caller: dict) -> dict:
        if not caller.get("is_staff"):
            raise PeopleError("Only an admin can add a person.", 403)
        username = str(data.get("username") or "").strip()
        if not username:
            raise PeopleError("A username is needed.")
        role = self._role(data.get("role"))
        name = self._name(data.get("name"))
        if role == "other" and not name:
            raise PeopleError("Give the person a name so the timeline can show it.")
        password = self._password(data.get("password"))
        screen = _screen_fields(data)
        existing = self.get(username)
        if existing and existing["active"]:
            raise PeopleError(f"{existing['username']} is already in the household.", 409)
        if existing and not existing["active"]:
            raise PeopleError(f"{existing['username']} was removed earlier. Bring them back from their row instead of adding them again.", 409)
        answer = self.django.run({"op": "add", "caller": caller["id"], "username": username, "password": password, "first_name": name or ROLE_LABEL[role]})
        user = answer.get("user") or {}
        self._upsert(str(user.get("username") or username), role=role, name=name, user_id=user.get("id"), active=True, staff=bool(user.get("is_staff")), created_by=caller["id"])
        if screen:
            self._upsert(str(user.get("username") or username), **screen)
        self.forget_users()
        return self._person(username, caller)

    def change(self, username: str, data: dict, caller: dict) -> dict:
        username = username.strip()
        if not username:
            raise PeopleError("A username is needed.")
        is_self = username.lower() == caller["username"].lower()
        if not caller.get("is_staff") and not is_self:
            raise PeopleError("Only an admin can change another person.", 403)
        fields: dict = {}
        if "role" in data:
            fields["role"] = self._role(data["role"])
        if "name" in data:
            fields["name"] = self._name(data["name"])
        if fields.get("role") == "other" and "name" in fields and not fields["name"]:
            raise PeopleError("Give the person a name so the timeline can show it.")
        screen = _screen_fields(data)
        if screen and not caller.get("is_staff"):
            # The simple screen is a limit set for someone, so only an admin changes it (a grandparent cannot leave it).
            raise PeopleError("Only an admin can change which screen a person sees.", 403)
        if screen.get("screen") == "simple" and is_self:
            # The simple screen has no Settings: an admin putting their own phone on it could not get back.
            raise PeopleError("You cannot put your own phone on the simple screen: it has no Settings to come back from.", 403)
        fields.update(screen)
        django_req: dict = {}
        if data.get("password") is not None:
            django_req["password"] = self._password(data["password"])
            # An admin resetting someone else's password is usually about a lost phone: that phone's token goes too.
            # Changing your own keeps this phone signed in.
            django_req["rotate_token"] = not is_self
        if "active" in data:
            if is_self:
                raise PeopleError("You cannot remove yourself. Another admin can, or use the Baby Buddy admin pages.", 403)
            if not caller.get("is_staff"):
                raise PeopleError("Only an admin can remove a person.", 403)
            django_req["is_active"] = bool(data["active"])
        if django_req:
            # A password or a removal needs Baby Buddy's Django; the name goes along for Baby Buddy's own pages.
            if fields.get("name"):
                django_req["first_name"] = fields["name"]
            answer = self.django.run({"op": "update", "caller": caller["id"], "username": username, **django_req})
            user = answer.get("user") or {}
            if "is_active" in django_req:
                fields["active"] = bool(user.get("is_active", django_req["is_active"]))
            if user.get("id") is not None:
                fields["user_id"] = user["id"]
                fields["staff"] = bool(user.get("is_staff"))
            if django_req.get("is_active") is False or django_req.get("rotate_token"):
                # A removed person, or a phone given up as lost, stops getting the household's pushes: delivery
                # sends to every subscription, and the person can no longer unsubscribe with a refused token.
                uid = user.get("id") if user.get("id") is not None else (self.get(username) or {}).get("user_id")
                if uid is not None:
                    self.store.x("DELETE FROM subscriptions WHERE user_id=?", (int(uid),))
            self.forget_users()
        elif fields.get("name") and self.django.status()["available"]:
            # Role and name are Bramble's own; mirroring the name into Baby Buddy is nice, not required.
            try:
                self.django.run({"op": "update", "caller": caller["id"], "username": username, "first_name": fields["name"]})
                self.forget_users()
            except PeopleError as exc:
                log.info("people: name for %s not mirrored into Baby Buddy: %s", username, exc)
        if fields:
            if is_self and self.get(username) is None:
                # First row for the caller themselves: what the profile already told us, so the admin pill
                # does not vanish when the Django list is not there to put it back.
                fields.setdefault("user_id", caller["id"])
                fields.setdefault("staff", bool(caller.get("is_staff")))
            self._upsert(username, **fields)
        return self._person(username, caller)
