"""The household's time zone, for every clock the companion writes into a notification or a note.

Reminder moments are stored and compared in UTC, so they fire at the right instant whatever the zone; the
zone only decides the words ("Last session 2:30 PM"), local days (the evening summary, ages, supply days) and
quiet hours. It used to be the server's own zone, which on a container left in UTC put every time in a
notification 4 hours off for a family in New York (2026-10-25). Now an admin's phone records its zone in
`server_config.time_zone` (Settings › Notifications › Time zone), and the server's zone is only the fallback.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, tzinfo

KEY = "time_zone"
_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_+\-]*(/[A-Za-z0-9_+\-]+){0,2}$")


def zone_named(name) -> tzinfo | None:
    """A real (DST-aware) zone for an IANA name like "America/New_York", or None."""
    if not isinstance(name, str) or not _NAME.match(name.strip()):
        return None
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name.strip())
    except Exception:  # noqa: BLE001 - unknown name, no zone database
        return None


def local_zone() -> tzinfo:
    """The server's zone as a real zone (DST-aware) when it can be named, else today's fixed offset.

    `datetime.now().astimezone().tzinfo` is only the offset in force right now; captured once at start-up
    it would keep the summer offset through the winter."""
    name = os.environ.get("TZ") or ""
    if not name:
        link = os.path.realpath("/etc/localtime")
        if "/zoneinfo/" in link:
            name = link.split("/zoneinfo/", 1)[1]
    zone = zone_named(name) if name and not name.startswith(":") else None
    return zone or datetime.now().astimezone().tzinfo


def saved_zone_name(store) -> str | None:
    """The zone the household set, when it set one (and it still names a zone)."""
    try:
        rows = store.q("SELECT value FROM server_config WHERE key=?", (KEY,))
    except Exception:  # noqa: BLE001 - a store without the config table (tests, an old database)
        return None
    name = rows[0]["value"] if rows else None
    return name if zone_named(name) else None


def household_zone(store=None) -> tzinfo:
    """The family's zone: the one set from the app, else the server's."""
    name = saved_zone_name(store) if store is not None else None
    return zone_named(name) if name else local_zone()


def zone_name(zone: tzinfo) -> str:
    """"America/New_York", or the offset's own name for a fixed-offset fallback."""
    return getattr(zone, "key", None) or datetime.now(zone).tzname() or "UTC"
