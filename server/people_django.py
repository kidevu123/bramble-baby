"""Runs inside Baby Buddy's Django (`manage.py shell`, fed on stdin by the Bramble companion or by the
people-bridge wrapper that install.sh writes). It is the only code that touches Baby Buddy's users.

The request is a JSON object in the BRAMBLE_PEOPLE_REQUEST environment variable of this process: never
on a command line, never in a log. The answer is one line on stdout, `@@BRAMBLE@@ {json}`, so anything
else Django prints is ignored. Every answer is `{"ok": true, ...}` or
`{"ok": false, "error": "<code>", "message": "<plain language for the phone>"}`.

Operations (`op`):
  probe                    Django version and the number of active users. No caller needed.
  list     caller          Every user: id, username, first_name, is_staff, is_active.
  add      caller, username, password, first_name
                           Create a regular Baby Buddy user (Baby Buddy's own convention: a user who can log
                           everything is `is_superuser=True`, `is_staff=False`; only staff can manage users)
                           and make sure its API token exists. The token never leaves Django.
  update   caller, username, [first_name], [password], [is_active], [rotate_token]
                           Change a person. Staff may change anyone; a person may change their own name and
                           password; nobody can deactivate themselves. `rotate_token` with a password set by
                           someone else retires the person's API token (their old phone is signed out).

`caller` is the Baby Buddy user id the companion authenticated (via /api/profile). The rule that only a
staff user manages people is enforced here as well as in the companion.
"""
import json
import os
import re
import sys

import django
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework.authtoken.models import Token

SENTINEL = "@@BRAMBLE@@"
USERNAME_RE = re.compile(r"^[\w.@+-]+$")
USERNAME_MAX = 150
PASSWORD_MAX = 128
User = get_user_model()


def _answer(payload):
    sys.stdout.write("\n" + SENTINEL + " " + json.dumps(payload) + "\n")
    sys.stdout.flush()


def _fail(code, message):
    _answer({"ok": False, "error": code, "message": message})


def _public(user):
    return {"id": user.pk, "username": user.username, "first_name": user.first_name or "", "is_staff": bool(user.is_staff), "is_active": bool(user.is_active)}


def _caller(req):
    """The authenticated user behind the request, or None when it is unknown or inactive."""
    caller_id = req.get("caller")
    if caller_id in (None, ""):
        return None
    caller = User.objects.filter(pk=int(caller_id)).first()
    return caller if caller and caller.is_active else None


def _find(username):
    return User.objects.filter(username__iexact=str(username or "").strip()).first()


def _validate_password(password, user):
    try:
        validate_password(password, user)
    except ValidationError as exc:
        return " ".join(str(m) for m in exc.messages)
    return None


def op_probe(req):
    _answer({"ok": True, "django": django.get_version(), "users": User.objects.filter(is_active=True).count()})


def op_list(req):
    if _caller(req) is None:
        return _fail("not_allowed", "Sign in again to see the household's accounts.")
    users = [_public(u) for u in User.objects.all().order_by("username")]
    _answer({"ok": True, "users": users})


def op_add(req):
    caller = _caller(req)
    if caller is None or not caller.is_staff:
        return _fail("not_allowed", "Only an admin can add a person.")
    username = str(req.get("username") or "").strip()
    password = req.get("password")
    first_name = str(req.get("first_name") or "").strip()[:150]
    if not username:
        return _fail("invalid", "A username is needed.")
    if len(username) > USERNAME_MAX or not USERNAME_RE.match(username):
        return _fail("invalid", "Usernames can only have letters, numbers and . @ + - _ (no spaces).")
    if not isinstance(password, str) or not password:
        return _fail("invalid", "A password is needed.")
    if len(password) > PASSWORD_MAX:
        return _fail("invalid", f"Keep the password under {PASSWORD_MAX} characters.")
    if _find(username) is not None:
        return _fail("taken", f"There is already a Baby Buddy login called {username}.")
    user = User(username=username, first_name=first_name, is_staff=False, is_superuser=True, is_active=True)
    problem = _validate_password(password, user)
    if problem:
        return _fail("weak_password", problem)
    with transaction.atomic():
        user.set_password(password)
        user.save()
        Token.objects.get_or_create(user=user)
    _answer({"ok": True, "user": _public(user)})


def op_update(req):
    caller = _caller(req)
    if caller is None:
        return _fail("not_allowed", "Sign in again to change people.")
    target = _find(req.get("username"))
    if target is None:
        return _fail("not_found", "That login does not exist in Baby Buddy.")
    self_change = target.pk == caller.pk
    if not caller.is_staff and not self_change:
        return _fail("not_allowed", "Only an admin can change another person.")
    changes = {}
    if "first_name" in req and req["first_name"] is not None:
        changes["first_name"] = str(req["first_name"]).strip()[:150]
    if "is_active" in req and req["is_active"] is not None:
        if self_change:
            return _fail("not_allowed", "You cannot remove yourself. Ask another admin, or use the Baby Buddy admin pages.")
        changes["is_active"] = bool(req["is_active"])
    password = req.get("password")
    if password is not None:
        if not isinstance(password, str) or not password or len(password) > PASSWORD_MAX:
            return _fail("invalid", "A password is needed." if not password else f"Keep the password under {PASSWORD_MAX} characters.")
        problem = _validate_password(password, target)
        if problem:
            return _fail("weak_password", problem)
    # A password set for someone else (a lost phone, usually) also retires their API token, so the old phone is
    # signed out everywhere; the person signs in again with the new password and gets a new token.
    rotate = password is not None and bool(req.get("rotate_token")) and not self_change
    if not changes and password is None:
        return _answer({"ok": True, "user": _public(target)})
    with transaction.atomic():
        for field, value in changes.items():
            setattr(target, field, value)
        if password is not None:
            target.set_password(password)
        target.save()
        if rotate:
            Token.objects.filter(user=target).delete()
        if changes.get("is_active") or rotate:
            Token.objects.get_or_create(user=target)
    _answer({"ok": True, "user": _public(target), "password_changed": password is not None, "token_rotated": rotate})


OPS = {"probe": op_probe, "list": op_list, "add": op_add, "update": op_update}


def main():
    try:
        req = json.loads(os.environ.get("BRAMBLE_PEOPLE_REQUEST") or "{}")
    except ValueError:
        return _fail("bad_request", "The request was not readable.")
    if not isinstance(req, dict):
        return _fail("bad_request", "The request was not readable.")
    handler = OPS.get(req.get("op"))
    if handler is None:
        return _fail("bad_request", f"Unknown operation {req.get('op')!r}.")
    try:
        handler(req)
    except Exception as exc:  # the companion shows this line; the traceback goes to stderr for the journal
        import traceback

        traceback.print_exc()
        _fail("django", f"{type(exc).__name__}: {exc}")


main()
