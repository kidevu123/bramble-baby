# Bramble companion server

Small stdlib Python service beside Baby Buddy that stores what Baby Buddy can't
(contractions, activities, milestones, per-child shared settings, reminders) and
delivers Web Push notifications with VAPID.

- Listens on `127.0.0.1:8100`; nginx mounts it at `/bramble/` (see `nginx-location.conf`).
- Auth: `Authorization: Token <Baby Buddy API key>`, validated against `/api/profile` (cached 10 min).
- Reminders are delivered by a 15 s loop; `POST /push/schedule` replaces all unsent auto reminders
  for a child (used for nap window predictions). Stale reminders (>6 h) are dropped, dead
  subscriptions (404/410) are removed.
- Push requires `pywebpush` + `py-vapid` + `cryptography` in the venv; without them the service
  still runs and `/health` reports `push: false` with a `problem` string. `/health` also reports
  `subscriptions` and the last push error; `POST /push/test {endpoint?}` returns `sent`, `subscriptions`
  and `errors`; `POST /push/status {endpoint}` says whether a device is registered.
- Timestamps (`at`, `start`, `end`) are normalised to UTC on write so SQL string comparison is chronological.
- Reminders go to every registered phone in the household (the payload carries `child`).
- The VAPID private key is never regenerated while it exists (rotating it breaks every subscription);
  a missing public key is re-derived from it.
- Environment: `BABYBUDDY_URL`, `BABYBUDDY_HOST` (Host header for the token check, needed when
  `ALLOWED_HOSTS` excludes 127.0.0.1), `BRAMBLE_VAPID_SUB` (contact in the VAPID JWT), `BRAMBLE_PRINTER`. The systemd
  unit reads `/opt/bramble-server/data/env`.
- Household setup from the app (`server_config`): `GET /config` (anyone signed in: printer address with any token
  masked, push contact, where each is set, whether the caller is an admin), `PUT /config {printer?, pushContact?}`
  (Baby Buddy staff only). A value set there wins over the environment; `null` clears it (back to the environment);
  `printer: "none"` means no printer whatever the environment says. Printers set from the app are `zebra://`,
  `brother_ql://`, `bridge://` or `niimbot://` (never `file://`, which writes to a path); a masked bridge token sent
  back is kept.

- People (`people.py`): one Baby Buddy login per caregiver with a role for the timeline. `GET /people` (everyone;
  `?fresh=1` re-reads Baby Buddy's users), `POST /people` (staff only: creates the Baby Buddy user and its API
  token), `PATCH /people/<username>` (role/name: staff or self; `password`: staff or self; `active`: staff, never
  self), `DELETE /people/<username>` (deactivate). Baby Buddy's REST API has no user endpoint, so the companion runs
  `manage.py shell` with `people_django.py` on stdin: directly when it can, otherwise through
  `/usr/local/libexec/bramble/people-bridge`, a root-owned wrapper `install.sh` (`people-setup.sh`) writes with the
  detected layout (values from `data/env` are validated before they reach it), run with `sudo -u <Baby Buddy's user>`
  under `/etc/sudoers.d/bramble-people` (`bramble ALL=(www-data) NOPASSWD: /usr/local/libexec/bramble/people-bridge ""`);
  a drop-in `bramble-server.service.d/people.conf` opens the database folder and `/run/sudo` under
  `ProtectSystem=strict`. The request (with the password) travels in the child's environment only and is never logged.
  An admin resetting someone else's password also retires that person's API token. `/health` has `people: {available, problem}`; when
  the layout is not found the problem names `BABYBUDDY_HOME` (also `BABYBUDDY_PYTHON`, `BABYBUDDY_USER`,
  `DJANGO_SETTINGS_MODULE`) in `/opt/bramble-server/data/env`, and roles/names still work for existing logins.
  The old per-child `caregiverNames` map is migrated into the `people` table at startup and stripped on PUT.
  On the owner's container this resolves to `/opt/babybuddy` + `/opt/babybuddy/.venv/bin/python` +
  `babybuddy.settings.production` (also from the uwsgi ini), database `/opt/data/db.sqlite3` owned by `www-data`, so
  the rule is `bramble ALL=(www-data) NOPASSWD: /usr/local/libexec/bramble/people-bridge ""` and the drop-in opens
  `/opt/data`. `BABYBUDDY_SETTINGS` is accepted as an alias of `DJANGO_SETTINGS_MODULE`.

Install on the host: `sudo server/install.sh`. Test locally:
`python3 -m unittest server/test_server.py server/test_hatch.py server/test_people.py server/test_nudges.py` (the people tests run the real
`people_django.py` inside `testdata/fake_manage.py`, a stand-in for Baby Buddy's Django).
