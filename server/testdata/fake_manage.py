#!/usr/bin/env python3
"""A stand-in for Baby Buddy's `manage.py shell` used by the companion tests and the isolated e2e stack.

Copied into a temporary "Baby Buddy home" as manage.py (so BABYBUDDY_HOME points at it). Like Django's
shell command it executes whatever arrives on stdin, with stub `django` / `rest_framework` modules on
sys.path that behave like the few pieces people_django.py uses. Users live in users.json next to this
file, so the mock Baby Buddy HTTP server (e2e/mock-babybuddy.mjs) and the tests can read the same state:
a login created here can sign in there.

It records what it was asked (argv, the names of the environment variables, whether the script came on
stdin) in calls.json so tests can assert that no password ever travelled on a command line. A file named
`broken` next to it makes it fail the way a mis-pointed layout would (Django not importable).
"""
import contextlib
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "users.json")
CALLS = os.path.join(HERE, "calls.json")
COMMON_PASSWORDS = {"password", "12345678", "qwerty123", "letmein1"}


def load_state():
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as fh:
            return json.load(fh)
    # The default household: the admin account every Baby Buddy starts with.
    return {"next_id": 2, "users": [{"id": 1, "username": "admin", "first_name": "", "is_staff": True, "is_superuser": True, "is_active": True, "password": "admin", "token": "mocktoken0000000000000000000000000000000"}]}


def save_state(state):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=1)
    os.replace(tmp, STATE)


def record_call(script):
    calls = []
    if os.path.exists(CALLS):
        with open(CALLS, encoding="utf-8") as fh:
            calls = json.load(fh)
    calls.append({"argv": sys.argv[1:], "env_keys": sorted(k for k in os.environ if k.startswith("BRAMBLE") or k.startswith("DJANGO")), "stdin_is_script": "@@BRAMBLE@@" in script, "cwd": os.getcwd()})
    with open(CALLS, "w", encoding="utf-8") as fh:
        json.dump(calls, fh)


STATE_DATA = load_state()


class ValidationError(Exception):
    def __init__(self, messages):
        super().__init__("; ".join(messages))
        self.messages = list(messages)


class QuerySet:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, **kw):
        def match(u):
            for key, value in kw.items():
                if key == "username__iexact":
                    if u.username.lower() != str(value).lower():
                        return False
                elif getattr(u, key) != value:
                    return False
            return True

        return QuerySet(u for u in self.rows if match(u))

    def first(self):
        return self.rows[0] if self.rows else None

    def count(self):
        return len(self.rows)

    def order_by(self, field):
        return QuerySet(sorted(self.rows, key=lambda u: getattr(u, field.lstrip("-")), reverse=field.startswith("-")))

    def all(self):
        return QuerySet(self.rows)

    def __iter__(self):
        return iter(self.rows)


class User:
    def __init__(self, username="", first_name="", is_staff=False, is_superuser=False, is_active=True, pk=None, password=None, token=None):
        self.pk = self.id = pk
        self.username, self.first_name = username, first_name
        self.is_staff, self.is_superuser, self.is_active = is_staff, is_superuser, is_active
        self.password, self.token = password, token

    def set_password(self, raw):
        self.password = raw  # plain text: this is a test double and the mock HTTP server checks logins against it

    def save(self):
        state = STATE_DATA
        if self.pk is None:
            self.pk = self.id = state["next_id"]
            state["next_id"] += 1
            state["users"].append(self._dict())
        else:
            state["users"] = [self._dict() if u["id"] == self.pk else u for u in state["users"]]
        save_state(state)

    def _dict(self):
        return {"id": self.pk, "username": self.username, "first_name": self.first_name, "is_staff": self.is_staff, "is_superuser": self.is_superuser, "is_active": self.is_active, "password": self.password, "token": self.token}


class UserManager:
    def _rows(self):
        return [User(u["username"], u.get("first_name", ""), u.get("is_staff", False), u.get("is_superuser", False), u.get("is_active", True), u["id"], u.get("password"), u.get("token")) for u in STATE_DATA["users"]]

    def all(self):
        return QuerySet(self._rows())

    def filter(self, **kw):
        return QuerySet(self._rows()).filter(**kw)


User.objects = UserManager()


class TokenManager:
    def get_or_create(self, user):
        if user.token:
            return (types.SimpleNamespace(key=user.token), False)
        user.token = "tok" + os.urandom(18).hex()
        user.save()
        return (types.SimpleNamespace(key=user.token), True)

    def filter(self, user):
        def delete():
            user.token = None
            user.save()

        return types.SimpleNamespace(delete=delete)


def validate_password(password, user=None):
    problems = []
    if len(password) < 8:
        problems.append("This password is too short. It must contain at least 8 characters.")
    if password.isdigit():
        problems.append("This password is entirely numeric.")
    if password.lower() in COMMON_PASSWORDS:
        problems.append("This password is too common.")
    if user is not None and user.username and user.username.lower() in password.lower():
        problems.append("The password is too similar to the username.")
    if problems:
        raise ValidationError(problems)


def install_stubs():
    django = types.ModuleType("django")
    django.get_version = lambda: "5.2.fake"
    contrib = types.ModuleType("django.contrib")
    auth = types.ModuleType("django.contrib.auth")
    auth.get_user_model = lambda: User
    pv = types.ModuleType("django.contrib.auth.password_validation")
    pv.validate_password = validate_password
    core = types.ModuleType("django.core")
    exceptions = types.ModuleType("django.core.exceptions")
    exceptions.ValidationError = ValidationError
    db = types.ModuleType("django.db")
    transaction = types.ModuleType("django.db.transaction")
    transaction.atomic = contextlib.nullcontext
    db.transaction = transaction
    rf = types.ModuleType("rest_framework")
    authtoken = types.ModuleType("rest_framework.authtoken")
    models = types.ModuleType("rest_framework.authtoken.models")
    models.Token = types.SimpleNamespace(objects=TokenManager())
    for name, mod in (("django", django), ("django.contrib", contrib), ("django.contrib.auth", auth), ("django.contrib.auth.password_validation", pv), ("django.core", core), ("django.core.exceptions", exceptions), ("django.db", db), ("django.db.transaction", transaction), ("rest_framework", rf), ("rest_framework.authtoken", authtoken), ("rest_framework.authtoken.models", models)):
        sys.modules[name] = mod


def main():
    if os.path.exists(os.path.join(HERE, "broken")):
        sys.stderr.write("Traceback (most recent call last):\n  File \"manage.py\", line 1, in <module>\nModuleNotFoundError: No module named 'django'\n")
        sys.exit(1)
    if sys.argv[1:] != ["shell"]:
        sys.stderr.write(f"fake manage.py: unexpected arguments {sys.argv[1:]}\n")
        sys.exit(2)
    script = sys.stdin.read()
    record_call(script)
    install_stubs()
    exec(compile(script, "people_django.py", "exec"), {"__name__": "__main__"})


if __name__ == "__main__":
    main()
