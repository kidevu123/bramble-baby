#!/usr/bin/env bash
# Lets the Bramble companion create and manage Baby Buddy logins (Settings › Household › People).
#
# Baby Buddy's REST API has no user endpoint, so the companion runs `manage.py shell` with people_django.py
# as Baby Buddy's own user. This script, run by install.sh as root, finds that Django, writes the
# people-bridge wrapper with the layout fixed in it, and the one sudo rule the `bramble` user needs to run
# exactly that wrapper. Nothing here is fatal: when the layout cannot be found it says what to put in
# /opt/bramble-server/data/env, and the rest of the companion keeps working (roles and names still work;
# /health and the People sheet say people management is unavailable and why).
#
# Overrides, read from /opt/bramble-server/data/env (the file the service reads too):
#   BABYBUDDY_HOME=/opt/babybuddy                  the folder with manage.py
#   BABYBUDDY_PYTHON=/opt/babybuddy/.venv/bin/python
#   BABYBUDDY_USER=www-data                        who owns Baby Buddy's database (Django runs as them)
#   DJANGO_SETTINGS_MODULE=babybuddy.settings.production
set -uo pipefail
ROOT=${ROOT:-/opt/bramble-server}
SERVICE_USER=${SERVICE_USER:-bramble}
SUDOERS=${SUDOERS:-/etc/sudoers.d/bramble-people}
# The wrapper and the Django script live in a root-owned directory the service user cannot write to or
# rename inside: the sudo rule names the wrapper, so nothing the `bramble` user owns may stand in for it.
LIBEXEC=${LIBEXEC:-/usr/local/libexec/bramble}
DROPIN=${DROPIN:-/etc/systemd/system/bramble-server.service.d/people.conf}
BRIDGE="$LIBEXEC/people-bridge"
SCRIPT="$LIBEXEC/people_django.py"
ENV_FILE="$ROOT/data/env"

note() { echo "  $*"; }

# Overrides come from a file the service user can write, so they are checked before they reach a shell
# line, a sudo rule or a root-run probe: plain absolute paths, a plain user that is not root, a module name.
valid_path() { [[ "$1" =~ ^/[A-Za-z0-9._/+-]+$ ]]; }
valid_user() { [[ "$1" =~ ^[a-z_][a-z0-9_-]*$ ]] && [ "$1" != "root" ] && id -u "$1" >/dev/null 2>&1 && [ "$(id -u "$1")" != "0" ]; }
valid_module() { [[ "$1" =~ ^[A-Za-z0-9_.]+$ ]]; }
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line; do
    key="${line%%=*}"; value="${line#*=}"
    case "$key" in
      BABYBUDDY_HOME|BABYBUDDY_PYTHON) valid_path "$value" && export "$key=$value" || note "ignoring $key in $ENV_FILE: not a plain absolute path" ;;
      BABYBUDDY_USER) valid_user "$value" && export "$key=$value" || note "ignoring BABYBUDDY_USER in $ENV_FILE: not an existing non-root user" ;;
      DJANGO_SETTINGS_MODULE|BABYBUDDY_SETTINGS) valid_module "$value" && export "DJANGO_SETTINGS_MODULE=$value" || note "ignoring $key in $ENV_FILE: not a module name" ;;
    esac
  done < "$ENV_FILE"
fi

# ---- where Baby Buddy is
home=""
for d in "${BABYBUDDY_HOME:-}" /opt/babybuddy /srv/babybuddy /var/www/babybuddy /home/babybuddy/babybuddy /opt/babybuddy/babybuddy /app /usr/src/app; do
  if [ -n "$d" ] && [ -f "$d/manage.py" ]; then home="${d%/}"; break; fi
done
if [ -z "$home" ]; then
  if [ -n "${BABYBUDDY_HOME:-}" ]; then
    note "BABYBUDDY_HOME is ${BABYBUDDY_HOME} but there is no manage.py there."
  else
    note "Baby Buddy's manage.py was not found in the usual places."
  fi
  note "Put BABYBUDDY_HOME=/path/to/babybuddy (the folder with manage.py) in $ENV_FILE and run install.sh again."
  rm -f "$BRIDGE" "$SUDOERS"
  exit 0
fi

python=""
for p in "${BABYBUDDY_PYTHON:-}" "$home/.venv/bin/python" "$home/venv/bin/python" "$home/.venv/bin/python3" "$home/venv/bin/python3" "$home/env/bin/python" "$home/virtualenv/bin/python"; do
  if [ -n "$p" ] && [ -x "$p" ]; then python="$p"; break; fi
done
if [ -z "$python" ]; then python="$(command -v python3 || true)"; fi
if [ -z "$python" ]; then
  note "No Python for Baby Buddy found next to $home. Put BABYBUDDY_PYTHON=/path/to/python in $ENV_FILE and run install.sh again."
  rm -f "$BRIDGE" "$SUDOERS"
  exit 0
fi

# ---- the environment Baby Buddy itself runs with: settings module, and uwsgi's env lines when it runs under uwsgi
settings_module="${DJANGO_SETTINGS_MODULE:-}"
if [ -z "$settings_module" ] && [ -f "$home/babybuddy/settings/production.py" ]; then settings_module="babybuddy.settings.production"; fi
ini=""
uwsgi_uid=""
# uwsgi lets a value refer to another key as %(key) (the Debian ini has `project = babybuddy` and
# `env = DJANGO_SETTINGS_MODULE=%(project).settings.production`); expand those from the same file.
expand_ini_vars() {
  local value="$1" name repl i
  for i in 1 2 3 4; do
    case "$value" in *'%('*')'*) ;; *) break ;; esac
    name="${value#*%(}"; name="${name%%)*}"
    repl="$(grep -E "^[[:space:]]*${name}[[:space:]]*=" "$ini" | head -1 | sed 's/^[^=]*=[[:space:]]*//' | tr -d '[:space:]')"
    [ -n "$repl" ] || break
    value="${value//%($name)/$repl}"
  done
  printf '%s' "$value"
}
for candidate in /etc/uwsgi/apps-enabled/*.ini /etc/uwsgi/apps-available/babybuddy.ini /etc/uwsgi/babybuddy.ini "$home/uwsgi.ini"; do
  [ -f "$candidate" ] || continue
  if grep -qi babybuddy "$candidate" 2>/dev/null; then ini="$candidate"; break; fi
done
if [ -n "$ini" ]; then
  while IFS= read -r line; do
    kv="${line#*=}"; kv="${kv#"${kv%%[![:space:]]*}"}"
    case "$kv" in
      DJANGO_SETTINGS_MODULE=*)
        if [ -z "${DJANGO_SETTINGS_MODULE:-}" ]; then
          value="$(expand_ini_vars "${kv#*=}")"
          # A placeholder that did not expand (%(something) unknown) is no module name: keep the detected default.
          case "$value" in *'%('*) ;; *) settings_module="$value" ;; esac
        fi ;;
    esac
  done < <(grep -E '^[[:space:]]*env[[:space:]]*=' "$ini" || true)
  uwsgi_uid="$(grep -E '^[[:space:]]*uid[[:space:]]*=' "$ini" | head -1 | sed 's/^[^=]*=[[:space:]]*//' | tr -d '[:space:]')"
fi

owner_of() { python3 - "$1" <<'PY' 2>/dev/null
import os, pwd, sys
print(pwd.getpwuid(os.stat(sys.argv[1]).st_uid).pw_name)
PY
}

# ---- who Django must run as: the owner of the database (asked from Django itself, as the user Baby Buddy runs as)
bbuser="${BABYBUDDY_USER:-}"
probe_user="${bbuser:-${uwsgi_uid:-$(owner_of "$home/manage.py")}}"
if [ -z "$bbuser" ]; then
  db=""
  probe_env=()
  [ -n "$settings_module" ] && probe_env+=("DJANGO_SETTINGS_MODULE=$settings_module")
  if [ -n "$ini" ]; then
    while IFS= read -r line; do kv="${line#*=}"; kv="${kv#"${kv%%[![:space:]]*}"}"; case "$kv" in *=*) probe_env+=("$kv") ;; esac; done < <(grep -E '^[[:space:]]*env[[:space:]]*=' "$ini" || true)
  fi
  answer="$(cd "$home" && printf 'from django.conf import settings\nprint("@@DB@@" + str(settings.DATABASES["default"].get("NAME", "")))\n' | sudo -n -u "$probe_user" -- env ${probe_env[@]+"${probe_env[@]}"} "$python" manage.py shell 2>/dev/null | grep '@@DB@@' | tail -1)" || true
  db="${answer#*@@DB@@}"
  if [ -n "$db" ] && [ -f "$db" ]; then
    bbuser="$(owner_of "$db")"
    note "Baby Buddy's database is $db, owned by $bbuser"
  else
    for d in "$home/data/db.sqlite3" /opt/data/db.sqlite3 "$home/db.sqlite3" /var/lib/babybuddy/db.sqlite3; do
      if [ -f "$d" ]; then bbuser="$(owner_of "$d")"; note "Baby Buddy's database looks like $d, owned by $bbuser"; break; fi
    done
  fi
  [ -n "$bbuser" ] || bbuser="$probe_user"
fi
if [ "$bbuser" = "root" ] || [ "$(id -u "$bbuser" 2>/dev/null || echo 0)" = "0" ]; then
  note "Baby Buddy's database is owned by root; the companion will not be given a root sudo rule. Set BABYBUDDY_USER to the user Baby Buddy runs as in $ENV_FILE (chown the database to it) and run install.sh again."
  rm -f "$BRIDGE" "$SUDOERS"
  exit 0
fi
for v in "$home" "$python"; do
  if ! valid_path "$v"; then note "refusing to write the wrapper: $v is not a plain absolute path"; rm -f "$BRIDGE" "$SUDOERS"; exit 0; fi
done
note "Baby Buddy: $home · python $python · settings ${settings_module:-default} · runs as $bbuser${ini:+ · uwsgi $ini}"

# ---- the wrapper: fixed layout, request on stdin, script by file. In a root-owned directory so only root changes it.
umask 022
mkdir -p "$LIBEXEC"
chown root:root "$LIBEXEC" 2>/dev/null || true
chmod 0755 "$LIBEXEC"
install -m 0644 -o root -g root "$ROOT/people_django.py" "$SCRIPT" 2>/dev/null || install -m 0644 "$ROOT/people_django.py" "$SCRIPT"
{
  echo '#!/bin/bash'
  echo '# Written by Bramble'"'"'s install.sh (server/people-setup.sh). Runs people_django.py inside Baby Buddy'"'"'s Django as'
  echo '# Baby Buddy'"'"'s own user. The companion calls it with the request JSON on stdin and no arguments; the request'
  echo '# travels to Django in the environment of this process only. Re-run install.sh after moving Baby Buddy.'
  printf 'BABYBUDDY_USER=%q\n' "$bbuser"
  printf 'BABYBUDDY_HOME=%q\n' "$home"
  printf 'BABYBUDDY_PYTHON=%q\n' "$python"
  printf 'UWSGI_INI=%q\n' "$ini"
  [ -n "$settings_module" ] && printf 'export DJANGO_SETTINGS_MODULE=%q\n' "$settings_module"
  cat <<'WRAP'
set -e
if [ -n "$UWSGI_INI" ] && [ -f "$UWSGI_INI" ]; then
  # The env Baby Buddy itself runs with (SECRET_KEY, DB_*, …) stays in uwsgi's ini; it is read here, not copied.
  # Values with an unexpanded uwsgi placeholder (%(project)…) are skipped, and the settings module the
  # installer resolved wins over the ini's copy of it.
  while IFS= read -r line; do
    kv="${line#*=}"; kv="${kv#"${kv%%[![:space:]]*}"}"
    case "$kv" in
      *'%('*) ;;
      DJANGO_SETTINGS_MODULE=*) [ -n "${DJANGO_SETTINGS_MODULE:-}" ] || export "$kv" ;;
      *=*) export "$kv" ;;
    esac
  done < <(grep -E '^[[:space:]]*env[[:space:]]*=' "$UWSGI_INI" || true)
fi
REQ="$(cat)"
export BRAMBLE_PEOPLE_REQUEST="$REQ"
cd "$BABYBUDDY_HOME"
WRAP
  echo "exec \"\$BABYBUDDY_PYTHON\" manage.py shell < \"$SCRIPT\""
} > "$BRIDGE.tmp"
mv "$BRIDGE.tmp" "$BRIDGE"
chown root:root "$BRIDGE" "$SCRIPT" 2>/dev/null || true
chmod 0755 "$BRIDGE"
chmod 0644 "$SCRIPT"
rm -f "$ROOT/people-bridge"  # an older build wrote the wrapper next to the service files

# ---- the sudo rule: exactly that wrapper, no arguments, as Baby Buddy's user
if [ "$bbuser" != "$SERVICE_USER" ] && [ "$(id -u)" = "0" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sudo >/dev/null 2>&1 || true
  fi
  mkdir -p "$(dirname "$SUDOERS")"
  printf '%s ALL=(%s) NOPASSWD: %s ""\n' "$SERVICE_USER" "$bbuser" "$BRIDGE" > "$SUDOERS.tmp"
  chmod 0440 "$SUDOERS.tmp"
  if visudo -c -f "$SUDOERS.tmp" >/dev/null 2>&1; then
    mv "$SUDOERS.tmp" "$SUDOERS"
  else
    rm -f "$SUDOERS.tmp"
    note "could not write a valid sudoers rule; add by hand to $SUDOERS:"
    note "  $SERVICE_USER ALL=($bbuser) NOPASSWD: $BRIDGE \"\""
  fi
else
  rm -f "$SUDOERS"
fi

# ---- the unit keeps ProtectSystem=strict; Django (started under it) must still write Baby Buddy's database, and
#      sudo its timestamp directory, so those paths are opened in a drop-in. Paths that do not exist are skipped (-).
if [ "$(id -u)" = "0" ]; then
  db_dirs=()
  [ -n "${db:-}" ] && valid_path "$db" && db_dirs+=("$(dirname "$db")")
  for d in "$home/data" /opt/data /var/lib/babybuddy; do valid_path "$d" && db_dirs+=("$d"); done
  mkdir -p "$(dirname "$DROPIN")"
  {
    echo "# Written by Bramble's install.sh (server/people-setup.sh): where Baby Buddy's Django may write when the"
    echo "# companion creates a login, plus sudo's timestamp directory. Re-run install.sh after moving the database."
    echo "[Service]"
    printf 'ReadWritePaths=-/run/sudo'
    for d in "${db_dirs[@]}"; do printf ' -%s' "$d"; done
    echo
  } > "$DROPIN.tmp"
  mv "$DROPIN.tmp" "$DROPIN"
  chmod 0644 "$DROPIN"
  systemctl daemon-reload 2>/dev/null || true
fi

# ---- try it the way the service will
if [ "$(id -u)" = "0" ]; then
  if [ "$bbuser" != "$SERVICE_USER" ]; then
    result="$(printf '{"op":"probe"}' | sudo -n -u "$SERVICE_USER" -- sudo -n -u "$bbuser" "$BRIDGE" 2>&1 | grep '@@BRAMBLE@@' | tail -1)" || true
  else
    result="$(printf '{"op":"probe"}' | sudo -n -u "$SERVICE_USER" -- "$BRIDGE" 2>&1 | grep '@@BRAMBLE@@' | tail -1)" || true
  fi
  if [ -n "$result" ]; then
    note "people management works: ${result#@@BRAMBLE@@ }"
  else
    note "people management does not work yet; after the service restarts, curl -s http://127.0.0.1:8100/health | grep -o '\"people\":{[^}]*}' says why."
    note "If it names sudo: check $SUDOERS. If it names Django: set BABYBUDDY_PYTHON / DJANGO_SETTINGS_MODULE in $ENV_FILE and run install.sh again."
  fi
fi
