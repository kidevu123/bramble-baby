"""Breast-milk stash: one row per labelled bag/bottle, expiry reminders, and direct label printing.

Flow ("scan in / scan out", the way hospital milk rooms work):
  * Printing a label from a pumping session creates a bag here (scan in). The label carries a QR
    code with the bag's short `code`.
  * Milk that already exists (brought home from the hospital, a friend's freezer) is added from the
    Stash tab through the same label sheet: no pumping entry, the real pumped time, where it is now,
    and a `client_key` so a retry never makes a second bag for one container.
  * A caregiver scans that QR with the phone camera inside Bramble when making a bottle (scan out):
    the bottle's amount is taken from the bag and the feeding is linked to that use. What is not
    poured stays in the stash (`remaining_ml`); the bag leaves the stash as `used` only when its
    balance reaches zero. Every take, hand correction and "used without a bottle" is one row in
    `milk_uses`, so Undo reverses the last one and the history is what actually happened. A bottle
    is on one bag at a time: saving it against another bag moves its take and the first bag gets
    its milk back.
  * Bags carry an expiry computed from where they are stored; the delivery thread's reminders warn
    before and at expiry, and are removed when the bag is used or discarded. A partial use does not
    move them.

Volumes are stored in millilitres (the companion is ours, so one canonical unit); phones convert.
`volume_ml` is what the label says (the physical bag); `remaining_ml` is what is still in it.
Standard library only, like the rest of the server. `brother_ql`/Pillow are optional, for printing.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

from zones import household_zone

log = logging.getLogger("bramble.milk")

SCHEMA = """
CREATE TABLE IF NOT EXISTS milk_bags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  pumped_at TEXT NOT NULL,
  volume_ml REAL NOT NULL,
  location TEXT NOT NULL DEFAULT 'fridge',
  thawed INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored',
  pumping_id INTEGER,
  feeding_id INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL,
  created_by INTEGER,
  used_at TEXT,
  used_by INTEGER,
  thawed_at TEXT,
  client_key TEXT,
  remaining_ml REAL
);
CREATE INDEX IF NOT EXISTS milk_bags_child ON milk_bags (child, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS milk_bags_pumping ON milk_bags (child, pumping_id) WHERE pumping_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS milk_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bag INTEGER NOT NULL,
  feeding_id INTEGER,
  amount_ml REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bottle',
  at TEXT NOT NULL,
  by_user INTEGER
);
CREATE INDEX IF NOT EXISTS milk_uses_bag ON milk_uses (bag, id);
-- Travel stickers: QR codes printed ahead at home and taken along, since the printer stays home. A code is
-- reserved here (no milk yet) and becomes a bag's code when the pumping it went on is logged. The same table
-- (and columns) an earlier, reverted build created, so a copy of it on the box keeps working.
CREATE TABLE IF NOT EXISTS milk_travel_labels (
  code TEXT PRIMARY KEY,
  child INTEGER NOT NULL,
  bag_id INTEGER UNIQUE,
  created TEXT NOT NULL,
  created_by INTEGER,
  assigned_at TEXT,
  batch_key TEXT
);
CREATE INDEX IF NOT EXISTS milk_travel_child ON milk_travel_labels (child, created DESC);
CREATE UNIQUE INDEX IF NOT EXISTS milk_uses_feeding ON milk_uses (bag, feeding_id) WHERE feeding_id IS NOT NULL;
"""

# Columns added after the table first shipped. A database that already has bags in it gets them in place
# (ALTER TABLE ... ADD COLUMN keeps every row; the new column is NULL on old bags).
# `out_at`: when a bag moved out onto the counter (a bag pumped straight onto it has none: its time out starts at the pump).
ADDED_COLUMNS = (("thawed_at", "TEXT"), ("client_key", "TEXT"), ("remaining_ml", "REAL"), ("kind", "TEXT"), ("spot", "INTEGER"), ("out_at", "TEXT"))
# The same for milk_uses: `into_bag` is the premade bottle a `combined` use poured the milk into.
USE_ADDED_COLUMNS = (("into_bag", "INTEGER"),)
# Indexes over added columns run after the columns exist: on an old table they would fail inside SCHEMA.
LATE_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS milk_bags_client_key ON milk_bags (child, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS milk_uses_by_feeding ON milk_uses (feeding_id) WHERE feeding_id IS NOT NULL;
"""
# Bags from before balances existed: a stored bag is still full, a used one is empty, a discarded one keeps
# everything (Undo on it puts the whole bag back, as it did before). Runs on every start; only NULLs change.
BACKFILL_REMAINING = "UPDATE milk_bags SET remaining_ml = CASE WHEN status='used' THEN 0 ELSE volume_ml END WHERE remaining_ml IS NULL"

LOCATIONS = ("room", "fridge", "freezer")
STATUSES = ("stored", "used", "discarded")
COLUMNS = ["id", "child", "code", "pumped_at", "volume_ml", "remaining_ml", "location", "thawed", "expires_at", "status", "pumping_id", "feeding_id", "notes", "created", "created_by", "used_at", "used_by", "thawed_at", "kind", "spot", "out_at"]
USE_COLUMNS = ["id", "bag", "feeding_id", "amount_ml", "kind", "at", "by_user", "into_bag"]
# What a use row records: a bottle made from the bag, milk used without a bottle (the rest of the bag), a hand
# correction of the balance (a spill, a syringe, a misread), whose amount is negative when milk came back, or
# milk poured into a premade bottle made ahead of time (`combined`, `into_bag` is that bottle), or the whole bag
# taken to the NICU for a baby who is fed there (`nicu`, Stash › Take to the NICU).
USE_KINDS = ("bottle", "elsewhere", "adjust", "combined", "nicu")
# Bags taken to the NICU in one trip.
NICU_MAX = 100
# Premade bottles: made ahead from stash bags and kept in numbered spots in the fridge (stickers 1 to SPOTS), so
# a night feed is "grab bottle 3". A bottle is a stash item of its own: `kind` 'bottle' (a pumped bag is 'bag').
SPOTS = 5
# Travel stickers printed in one go.
TRAVEL_MAX = 30
# Under this much left, the bag is empty: nobody pours half a millilitre.
EMPTY_ML = 1.0
# A bottle a hair bigger than the balance (4.1 oz typed for a 120 mL bag) takes the balance; more is a mistake.
OVER_TOLERANCE_ML = 3.0

# CDC storage windows for freshly expressed milk, and for milk that has been thawed (never refreeze).
FRESH_WINDOW = {"room": timedelta(hours=4), "fridge": timedelta(days=4), "freezer": timedelta(days=183)}
THAWED_WINDOW = {"room": timedelta(hours=2), "fridge": timedelta(hours=24)}
# How far ahead the "expiring" reminder fires, by location.
LEAD = {"room": timedelta(hours=1), "fridge": timedelta(hours=12), "freezer": timedelta(days=7)}

CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O/1/I: read off a smudged label without ambiguity
# A phone's clock may run a little ahead of the server's; anything further in the future is a mistake.
CLOCK_SKEW = timedelta(minutes=5)
CLIENT_KEY_ALPHABET = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")


class MilkError(ValueError):
    """A rule about the milk itself was broken. The message is plain language and goes to the caregiver as is."""


def new_code(length: int = 6) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat(timespec="seconds")


def expiry_for(pumped_at: datetime, location: str, thawed: bool, since: datetime | None = None, windows: dict | None = None) -> datetime:
    """When a bag stops being safe. Fresh milk counts from pumping; thawed milk counts from the thaw."""
    if thawed:
        base = since or pumped_at
        return base + THAWED_WINDOW.get(location, THAWED_WINDOW["fridge"])
    win = dict(FRESH_WINDOW)
    if windows:
        win.update(windows)
    return pumped_at + win.get(location, win["fridge"])


def _number(value) -> float:
    """A JSON number; `true` is not 1 and a string is not a number."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("not a number")
    return float(value)


def _flag(value, default: bool) -> bool:
    """A JSON boolean; "false" is not a flag that is off."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    raise ValueError("not a flag")


def _clean_ml(value) -> float:
    ml = _number(value)
    if not (ml > 0) or ml > 5000:
        raise ValueError("volume_ml out of range")
    return round(ml, 2)


def _clean_take(value) -> float:
    """A bottle's amount: zero is allowed (the feeding was deleted, its milk goes back)."""
    ml = _number(value)
    if not (ml >= 0) or ml > 5000:
        raise ValueError("amount_ml out of range")
    return round(ml, 2)


def _clean_left(value, volume: float) -> float:
    """A hand-set balance: nothing below empty, never more than the bag held."""
    ml = _number(value)
    if not (ml >= 0) or ml > volume + 0.01:
        raise ValueError("remaining_ml out of range")
    return round(min(ml, volume), 2)


def _clean_client_key(value) -> str | None:
    """The phone's one-per-container token (see MilkStore.create). Opaque; only its shape is checked."""
    if value in (None, ""):
        return None
    key = str(value)
    if not (8 <= len(key) <= 64) or not set(key) <= CLIENT_KEY_ALPHABET:
        raise ValueError("bad client_key")
    return key


class MilkStore:
    """Bag CRUD on the shared Store plus the reminders that go with each bag."""

    def __init__(self, store, parse_iso, utc_iso, now_iso):
        self.store = store
        self.parse_iso, self.utc_iso, self.now_iso = parse_iso, utc_iso, now_iso
        store.conn.executescript(SCHEMA)
        self._migrate()

    def zone(self):
        """The household's zone for clocks written into reminders and notes (zones.py)."""
        return household_zone(self.store)

    def resync_reminders(self, child: int | None = None) -> int:
        """Write every stored bag's reminders again (their words carry clocks: after the zone changes)."""
        rows = self.store.q("SELECT id FROM milk_bags WHERE status='stored'" + (" AND child=?" if child is not None else ""), (child,) if child is not None else ())
        for r in rows:
            bag = self.get(r["id"])
            if bag:
                self.sync_reminders(bag)  # type: ignore[arg-type]
        return len(rows)

    def _migrate(self) -> None:
        """Bring a milk_bags table from any earlier release up to date in place, keeping its rows."""
        cols = {r["name"] for r in self.store.q("PRAGMA table_info(milk_bags)")}
        for name, decl in ADDED_COLUMNS:
            if name not in cols:
                self.store.x(f"ALTER TABLE milk_bags ADD COLUMN {name} {decl}")
        travel_cols = {r["name"] for r in self.store.q("PRAGMA table_info(milk_travel_labels)")}
        if "batch_key" not in travel_cols:
            self.store.x("ALTER TABLE milk_travel_labels ADD COLUMN batch_key TEXT")
        use_cols = {r["name"] for r in self.store.q("PRAGMA table_info(milk_uses)")}
        for name, decl in USE_ADDED_COLUMNS:
            if name not in use_cols:
                self.store.x(f"ALTER TABLE milk_uses ADD COLUMN {name} {decl}")
        self.store.conn.executescript(LATE_INDEXES)
        self.store.x(BACKFILL_REMAINING)

    # ---- rows
    def _row(self, r: dict, uses: list[dict] | None = None) -> dict:
        out = {k: r.get(k) for k in COLUMNS}
        out["thawed"] = bool(out["thawed"])
        out["kind"] = out["kind"] or "bag"
        if out["remaining_ml"] is None:  # a row written before the backfill ran (never after a start)
            out["remaining_ml"] = 0 if out["status"] == "used" else out["volume_ml"]
        out["uses"] = uses if uses is not None else self._uses(out["id"])
        return out

    @staticmethod
    def _use_row(r: dict) -> dict:
        return {k: r.get(k) for k in USE_COLUMNS}

    def _uses(self, bag_id: int) -> list[dict]:
        return [self._use_row(r) for r in self.store.q("SELECT * FROM milk_uses WHERE bag=? ORDER BY id", (bag_id,))]

    def _rows(self, rows: list[dict], child: int) -> list[dict]:
        """Bags of one child with their uses, fetched in one query rather than one per bag."""
        uses: dict[int, list[dict]] = {}
        for u in self.store.q("SELECT u.* FROM milk_uses u JOIN milk_bags b ON b.id=u.bag WHERE b.child=? ORDER BY u.id", (child,)):
            uses.setdefault(u["bag"], []).append(self._use_row(u))
        return [self._row(r, uses.get(r["id"], [])) for r in rows]

    def list(self, child: int, status: str | None = None) -> list[dict]:
        if status and status not in STATUSES:
            raise ValueError("bad status")
        if status:
            rows = self.store.q("SELECT * FROM milk_bags WHERE child=? AND status=? ORDER BY expires_at, id", (child, status))
        else:
            rows = self.store.q("SELECT * FROM milk_bags WHERE child=? ORDER BY status='stored' DESC, expires_at, id LIMIT 500", (child,))
        return self._rows(rows, child)

    def get(self, bag_id: int) -> dict | None:
        rows = self.store.q("SELECT * FROM milk_bags WHERE id=?", (bag_id,))
        return self._row(rows[0]) if rows else None

    def by_code(self, code: str) -> dict | None:
        rows = self.store.q("SELECT * FROM milk_bags WHERE code=?", (code.strip().upper(),))
        return self._row(rows[0]) if rows else None

    def by_pumping(self, child: int, pumping_id: int) -> dict | None:
        rows = self.store.q("SELECT * FROM milk_bags WHERE child=? AND pumping_id=? ORDER BY id DESC LIMIT 1", (child, pumping_id))
        return self._row(rows[0]) if rows else None

    def by_client_key(self, child: int, client_key: str) -> dict | None:
        rows = self.store.q("SELECT * FROM milk_bags WHERE child=? AND client_key=?", (child, client_key))
        return self._row(rows[0]) if rows else None

    def for_feeding(self, feeding_id: int) -> dict:
        """Every bag a feeding was poured from, oldest take first: {"takes": [{"bag", "use"}], "total_ml"}.

        `bag` and `use` are the most recent take (what a one-bag bottle is), kept for the callers that
        think in one bag; both None when the bottle was not from the stash."""
        rows = self.store.q("SELECT * FROM milk_uses WHERE feeding_id=? ORDER BY id", (feeding_id,))
        takes = [{"bag": self.get(r["bag"]), "use": self._use_row(r)} for r in rows]
        takes = [t for t in takes if t["bag"]]
        latest = takes[-1] if takes else {"bag": None, "use": None}
        return {"bag": latest["bag"], "use": latest["use"], "takes": takes, "total_ml": round(sum(t["use"]["amount_ml"] for t in takes), 2)}

    def _fresh_code(self) -> str:
        """A code no bag and no travel sticker has."""
        for _ in range(20):
            code = new_code()
            if not self.by_code(code) and not self.store.q("SELECT 1 FROM milk_travel_labels WHERE code=?", (code,)):
                return code
        raise MilkError("Could not make a new code; try again.")

    # ---- travel stickers
    @staticmethod
    def _travel_row(r: dict) -> dict:
        return {"code": r["code"], "child": r["child"], "bag_id": r["bag_id"], "created": r["created"], "assigned_at": r["assigned_at"], "status": "assigned" if r["bag_id"] else "unused"}

    def travel_list(self, child: int) -> list[dict]:
        rows = self.store.q("SELECT * FROM milk_travel_labels WHERE child=? ORDER BY created DESC, code LIMIT 200", (child,))
        return [self._travel_row(r) for r in rows]

    def travel_get(self, code: str) -> dict | None:
        rows = self.store.q("SELECT * FROM milk_travel_labels WHERE code=?", (str(code).strip().upper(),))
        return self._travel_row(rows[0]) if rows else None

    def reserve_travel(self, child: int, count, user_id: int | None, client_key=None) -> list[dict]:
        """`count` new codes for blank travel stickers; no milk, nothing in the stash. Sent again with the same
        `client_key` (a retry), the same codes come back, so a reprint never makes a second set."""
        try:
            n = int(count)
        except (TypeError, ValueError):
            raise ValueError("bad count")
        if not 1 <= n <= TRAVEL_MAX:
            raise MilkError(f"Print 1 to {TRAVEL_MAX} travel stickers at a time.")
        key = _clean_client_key(client_key)
        with self.store.atomic():
            if key:
                again = self.store.q("SELECT * FROM milk_travel_labels WHERE child=? AND batch_key=? ORDER BY rowid", (child, key))
                if again:
                    return [self._travel_row(r) for r in again]
            now = self.now_iso()
            codes = []
            for _ in range(n):
                code = self._fresh_code()
                self.store.x("INSERT INTO milk_travel_labels (code, child, created, created_by, batch_key) VALUES (?,?,?,?,?)", (code, child, now, user_id, key))
                codes.append(code)
            return [self.travel_get(c) for c in codes]  # type: ignore[misc]

    def _claim_travel(self, child: int, code: str, bag_id: int | None) -> str:
        """Checks a travel sticker can go on this bag (ours, not on other milk) and returns its code."""
        code = str(code or "").strip().upper()
        sticker = self.travel_get(code)
        if not sticker:
            raise MilkError(f"{code or 'That'} is not a travel sticker. Print travel stickers in Settings › Milk labels & printer.")
        if sticker["child"] != child:
            raise MilkError(f"Travel sticker {code} belongs to another child.")
        if sticker["bag_id"] and sticker["bag_id"] != bag_id:
            raise MilkError(f"Travel sticker {code} is already on other milk.")
        taken = self.by_code(code)
        if taken and taken["id"] != bag_id:
            raise MilkError(f"Travel sticker {code} is already on other milk.")
        return code

    def _recode(self, bag: dict, code: str) -> None:
        """The bag takes a travel sticker's code (its milk went on that sticker); the sticker is marked used."""
        code = self._claim_travel(bag["child"], code, bag["id"])
        # A bag moved from one sticker to another frees the first (bag_id is unique on the stickers).
        self.store.x("UPDATE milk_travel_labels SET bag_id=NULL, assigned_at=NULL WHERE bag_id=? AND code<>?", (bag["id"], code))
        self.store.x("UPDATE milk_bags SET code=? WHERE id=?", (code, bag["id"]))
        self.store.x("UPDATE milk_travel_labels SET bag_id=?, assigned_at=? WHERE code=?", (bag["id"], self.now_iso(), code))

    def create(self, data: dict, user_id: int | None, windows: dict | None = None) -> dict:
        """One new bag. Expiry always counts from the real pumped time (or the real thaw time), never from now.

        The same container is never registered twice:
          * `pumping_id`: one bag per pumping entry (printing its label again returns the same bag);
          * `client_key`: milk with no pumping entry. The phone makes one key per container, so a retry,
            a double tap or a reopened sheet returns the first bag, while a second bottle with the same
            volume and time (its own key) is a second bag.
        """
        missing = [k for k in ("child", "pumped_at", "volume_ml") if data.get(k) in (None, "")]
        if missing:
            raise ValueError(f"missing: {', '.join(missing)}")
        child = int(data["child"])
        pumping_id = int(data["pumping_id"]) if data.get("pumping_id") not in (None, "") else None
        client_key = _clean_client_key(data.get("client_key"))
        pumped = self.parse_iso(str(data["pumped_at"]))
        location = str(data.get("location") or "fridge")
        if location not in LOCATIONS:
            raise ValueError("bad location")
        volume = _clean_ml(data["volume_ml"])
        latest = datetime.now(timezone.utc) + CLOCK_SKEW
        if pumped > latest:
            raise MilkError("The pumped time cannot be in the future.")
        thawed = _flag(data.get("thawed"), False)
        thawed_at = None
        if thawed:
            if location == "freezer":
                raise MilkError("Thawed milk cannot go back in the freezer.")
            # The thaw clock is a real moment the caregiver gives; it is never assumed to be "now".
            if data.get("thawed_at") in (None, ""):
                raise ValueError("missing: thawed_at")
            thawed_at = self.parse_iso(str(data["thawed_at"]))
            if thawed_at < pumped or thawed_at > latest:
                raise MilkError("The thaw time has to be after the milk was pumped and not in the future.")
        expires = expiry_for(pumped, location, thawed, since=thawed_at, windows=windows)
        now = self.now_iso()
        # On a travel sticker printed ahead: the bag takes the sticker's code (checked inside the lock below).
        travel = str(data.get("travel_code") or "").strip().upper() or None
        # The lookups run inside the write transaction (two phones, or one phone twice, cannot both miss)
        # and a unique index backs each of them up.
        with self.store.atomic():
            if pumping_id is not None:
                existing = self.by_pumping(child, pumping_id)
                if existing:
                    if travel and existing["code"] != travel:
                        self._recode(existing, travel)  # the session's milk went on a travel sticker after all
                        existing = self.get(existing["id"])
                        self.sync_reminders(existing)  # type: ignore[arg-type]
                    return existing  # type: ignore[return-value]
            if client_key is not None:
                existing = self.by_client_key(child, client_key)
                if existing:
                    return existing
            code = self._claim_travel(child, travel, None) if travel else self._fresh_code()
            cur = self.store.x(
                "INSERT INTO milk_bags (child, code, pumped_at, volume_ml, remaining_ml, location, thawed, thawed_at, expires_at, status, pumping_id, client_key, notes, created, created_by)"
                " VALUES (?,?,?,?,?,?,?,?,?,'stored',?,?,?,?,?)",
                (child, code, _iso(pumped), volume, volume, location, 1 if thawed else 0, _iso(thawed_at) if thawed_at else None, _iso(expires), pumping_id, client_key, str(data.get("notes") or ""), now, user_id),
            )
            if travel:
                self.store.x("UPDATE milk_travel_labels SET bag_id=?, assigned_at=? WHERE code=?", (cur.lastrowid, now, code))
            bag = self.get(cur.lastrowid)  # type: ignore[arg-type]
            self.sync_reminders(bag)  # type: ignore[arg-type]
        return bag  # type: ignore[return-value]

    def patch(self, bag_id: int, data: dict, user_id: int | None, windows: dict | None = None) -> dict | None:
        """Move, thaw, correct, discard, mark used, set what is left, or undo (`status: 'stored'`).

        Undo on a used bag reverses its last use (the bottle that emptied it, or a hand correction to
        zero) and keeps the earlier ones; a bag used before balances existed comes back whole. Undo on
        a discarded bag puts it back with the balance it had."""
        with self.store.atomic():
            return self._patch(bag_id, data, user_id, windows)

    def _patch(self, bag_id: int, data: dict, user_id: int | None, windows: dict | None) -> dict | None:
        bag = self.get(bag_id)
        if not bag:
            return None
        updates: dict = {}
        volume, remaining = bag["volume_ml"], bag["remaining_ml"]
        # (feeding_id, amount, kind) rows to write; a reversed use is deleted instead.
        new_uses: list[tuple] = []
        uses_changed = False
        if "volume_ml" in data:
            volume = _clean_ml(data["volume_ml"])
            updates["volume_ml"] = volume
            # A corrected label volume carries the balance with it: an untouched bag stays full, a part-used
            # one keeps what was taken out of it.
            remaining = max(0.0, min(volume, round(remaining + volume - bag["volume_ml"], 2)))
            # The new balance decides whether the bag is still in the stash (no use row: nothing was poured).
            if "status" not in data and "remaining_ml" not in data and bag["status"] != "discarded":
                data = {**data, "status": "used" if remaining < EMPTY_ML else "stored", "_from_volume": True}
        if "notes" in data:
            updates["notes"] = str(data.get("notes") or "")
        if "pumped_at" in data and data["pumped_at"]:
            pumped_new = self.parse_iso(str(data["pumped_at"]))
            if pumped_new > datetime.now(timezone.utc) + CLOCK_SKEW:  # the same rule as create: expiry never counts from a future moment
                raise MilkError("The pumped time cannot be in the future.")
            updates["pumped_at"] = _iso(pumped_new)
        location = str(data.get("location") or bag["location"])
        if location not in LOCATIONS:
            raise ValueError("bad location")
        thawed = _flag(data.get("thawed"), bool(bag["thawed"]))
        if bag["thawed"] and not thawed:
            # Thawed milk never becomes fresh again: un-thawing it would re-date it (24 h → 4 days) and let it
            # back into the freezer.
            raise MilkError("Thawed milk stays thawed: it keeps 24 hours in the fridge and is never refrozen.")
        moved = location != bag["location"] or thawed != bag["thawed"] or "pumped_at" in updates
        # When the bag really changed place: now, or a moment the caregiver gives ("it went in the fridge at 7:05").
        moved_at = None
        if data.get("moved_at"):
            moved_at = self.parse_iso(str(data["moved_at"]))
            if moved_at > datetime.now(timezone.utc) + CLOCK_SKEW or moved_at < self.parse_iso(bag["pumped_at"]) - CLOCK_SKEW:
                raise MilkError("The time it was moved has to be after the milk was pumped and not in the future.")
        if location != bag["location"] and "pumped_at" not in updates:
            # A move never brings milk back from past its window: the place it was in decided how long it kept, so
            # it must have left that place in time. Without this, moving an expired bag re-dated it from the pump
            # (room milk out 5 hours would read as 4 days in the fridge). A corrected pumped time is a correction,
            # not a move, and is judged by the new dates.
            deadline = self.parse_iso(bag["expires_at"])
            when = moved_at or datetime.now(timezone.utc)
            if when > deadline + timedelta(minutes=1):
                place = {"room": "out at room temperature", "fridge": "in the fridge", "freezer": "in the freezer"}[bag["location"]]
                raise MilkError(f"It was {place} past {deadline.astimezone(self.zone()).strftime('%-I:%M %p')}, the end of its window there, so it cannot be moved now. Milk past its window should be thrown away.")
        if moved:
            if bag["location"] == "freezer" and location != "freezer":
                thawed = True  # out of the freezer means thawed: 24 h in the fridge, never refreeze
            if thawed and location == "freezer":
                # Covers both "put thawed milk back in the freezer" and "mark it thawed while it is still frozen".
                raise ValueError("thawed milk cannot be refrozen")
            pumped = self.parse_iso(updates.get("pumped_at", bag["pumped_at"]))
            # The thaw clock starts once and is stored; it is never derived from expires_at.
            thawed_at = None
            if thawed:
                thawed_at = self.parse_iso(bag["thawed_at"]) if bag["thawed"] and bag.get("thawed_at") else (moved_at or datetime.now(timezone.utc))
                if "pumped_at" in updates and thawed_at < pumped:
                    raise MilkError("The thaw time has to be after the milk was pumped and not in the future.")
                updates["thawed_at"] = _iso(thawed_at)
            updates["location"] = location
            if moved_at is not None and location != bag["location"]:
                # A move dated by hand stays on record beside the bag.
                put = {"room": "Out on the counter", "fridge": "In the fridge", "freezer": "In the freezer"}[location]
                said = f"{put} from {moved_at.astimezone(self.zone()).strftime('%a %-I:%M %p')} (time set by hand)"
                notes = str(updates.get("notes", bag.get("notes") or ""))
                updates["notes"] = f"{notes}\n{said}".strip()
            updates["thawed"] = 1 if thawed else 0
            expires = expiry_for(pumped, location, thawed, since=thawed_at, windows=windows)
            if location == "room" and bag["location"] != "room" and "pumped_at" not in updates:
                # Out of the fridge onto the counter: its room hours start now (or when it really came out), and it
                # never keeps longer than it would have where it was. Counted from the pump, a 26-hour-old fridge
                # bag was expired the moment it moved, and could not even go back.
                out = moved_at or datetime.now(timezone.utc)
                updates["out_at"] = _iso(out)
                expires = min(self.parse_iso(bag["expires_at"]), expiry_for(out, "room", thawed, since=out if thawed else None, windows=windows))
            updates["expires_at"] = _iso(expires)
        # expires_at is always computed from pumped_at / thawed_at and the location; it is not writable.
        status = str(data.get("status") or bag["status"])
        if status not in STATUSES:
            raise ValueError("bad status")
        feeding_id = int(data["feeding_id"]) if data.get("feeding_id") not in (None, "") else None
        if "remaining_ml" in data:
            # What is left, set by hand (a spill, a syringe, a misread): the difference is on record as a
            # correction. Zero means used; anything left on a used-up bag brings it back into the stash.
            target = _clean_left(data["remaining_ml"], volume)
            if abs(target - remaining) >= 0.01:
                new_uses.append((None, round(remaining - target, 2), "adjust"))
                remaining = target
            if "status" not in data and bag["status"] != "discarded":
                status = "used" if remaining < EMPTY_ML else "stored"
        undo = status == "stored" and bag["status"] == "used" and "remaining_ml" not in data and not data.get("_from_volume")
        if status != bag["status"]:
            updates["status"] = status
            if status == "used":
                # Marked used from the stash ("used without a bottle", or an old phone's whole-bag scan out):
                # everything still in it is one use.
                if feeding_id is not None:  # a feeding is on at most one bag (same rule as `use`)
                    for other in self.store.q("SELECT * FROM milk_uses WHERE feeding_id=? AND bag<>?", (feeding_id, bag_id)):
                        self._give_back(other)
                if remaining >= EMPTY_ML:
                    new_uses.append((feeding_id, remaining, "bottle" if feeding_id is not None else "nicu" if data.get("_to_nicu") else "elsewhere"))
                remaining = 0.0
                updates["used_at"] = self.now_iso()
                updates["used_by"] = user_id
            elif status == "discarded":
                updates["used_at"] = self.now_iso()
                updates["used_by"] = user_id
            else:
                updates["used_at"] = None
                updates["used_by"] = None
        if undo:
            last = self.store.q("SELECT * FROM milk_uses WHERE bag=? ORDER BY id DESC LIMIT 1", (bag_id,))
            # 'prepared' is the reverted outside build's word for the same pour (5ef72ae, its own bottles table).
            if last and last[0]["kind"] in ("combined", "prepared"):
                # That milk is in a premade bottle now; putting it back here as well would count it twice.
                into = self.get(last[0]["into_bag"]) if last[0].get("into_bag") else None
                where = f"the premade bottle in spot {into['spot']}" if into and into.get("spot") else "a premade bottle"
                raise MilkError(f"The last of this bag went into {where}. Feed or discard that bottle instead.")
            if last:
                self.store.x("DELETE FROM milk_uses WHERE id=?", (last[0]["id"],))
                remaining = max(0.0, min(volume, round(remaining + last[0]["amount_ml"], 2)))
                uses_changed = True
            else:
                remaining = volume  # used before balances existed: the whole bag comes back
                uses_changed = True  # the bag's feeding link goes with it
        if remaining < EMPTY_ML and status != "discarded":
            remaining = 0.0
        for fid, amount, kind in new_uses:
            # One use per feeding per bag: a whole-bag scan out replayed for a feeding that already took from
            # this bag grows that use rather than adding a second row.
            if fid is not None and self.store.x("UPDATE milk_uses SET amount_ml=amount_ml+?, by_user=? WHERE bag=? AND feeding_id=?", (amount, user_id, bag_id, fid)).rowcount:
                uses_changed = True
                continue
            self.store.x("INSERT INTO milk_uses (bag, feeding_id, amount_ml, kind, at, by_user) VALUES (?,?,?,?,?,?)", (bag_id, fid, amount, kind, self.now_iso(), user_id))
            uses_changed = True
        if abs(remaining - bag["remaining_ml"]) >= 0.005:
            updates["remaining_ml"] = round(remaining, 2)
        if uses_changed:
            updates["feeding_id"] = self._latest_feeding(bag_id)
        elif "feeding_id" in data:
            updates["feeding_id"] = feeding_id
        if "pumping_id" in data:
            pid = int(data["pumping_id"]) if data["pumping_id"] not in (None, "") else None
            if pid is not None and pid != bag["pumping_id"]:
                taken = self.by_pumping(bag["child"], pid)
                if taken and taken["id"] != bag_id:
                    raise MilkError(f"That pumping session already has bag {taken['code']}.")
            updates["pumping_id"] = pid
        if data.get("travel_code") and str(data["travel_code"]).strip().upper() != bag["code"]:
            if bag["status"] != "stored":
                # An empty or thrown-away bag has nothing to carry the sticker; it would only use one up.
                raise MilkError(f"Bag {bag['code']} is no longer in the stash, so it cannot go on a travel sticker.")
            self._recode(bag, str(data["travel_code"]))
            if not updates:
                fresh = self.get(bag_id)
                self.sync_reminders(fresh)  # type: ignore[arg-type]
                return fresh
        if not updates:
            return bag
        sets = ", ".join(f"{k}=?" for k in updates)
        self.store.x(f"UPDATE milk_bags SET {sets} WHERE id=?", [*updates.values(), bag_id])
        fresh = self.get(bag_id)
        self.sync_reminders(fresh)  # type: ignore[arg-type]
        return fresh

    def to_nicu(self, child: int, bag_ids, user_id: int | None) -> list[dict]:
        """Bags taken to the NICU (a baby fed there): each leaves the home stash whole, as one `nicu` use, so the
        hospital's freezer is not counted as home milk. Every bag is checked before anything is written. Undo on a
        bag (`status: 'stored'`) brings it back, like any other use."""
        if not isinstance(bag_ids, list) or not bag_ids:
            raise ValueError("missing: bags")
        if len(bag_ids) > NICU_MAX:
            raise MilkError(f"At most {NICU_MAX} bags at a time.")
        ids: list[int] = []
        for raw in bag_ids:
            if isinstance(raw, bool) or not isinstance(raw, (int, str)) or not str(raw).isdigit():
                raise ValueError("bad bag id")
            if int(raw) not in ids:
                ids.append(int(raw))
        now = datetime.now(timezone.utc)
        with self.store.atomic():
            for bag_id in ids:
                bag = self.get(bag_id)
                if not bag or bag["child"] != child:
                    raise MilkError(f"Bag {bag_id} is not in the stash.")
                if bag["status"] != "stored":
                    raise MilkError(f"Bag {bag['code']} is no longer in the stash.")
                if bag.get("kind") == "bottle":
                    raise MilkError(f"Premade bottle {bag.get('spot') or ''} is for feeding at home; undo it to send its milk.".replace("bottle  is", "bottle is"))
                if self.parse_iso(bag["expires_at"]) <= now:
                    raise MilkError(f"Bag {bag['code']} is past its window; discard it rather than take it in.")
            for bag_id in ids:
                self._patch(bag_id, {"status": "used", "_to_nicu": True}, user_id, None)
            return [self.get(i) for i in ids]  # type: ignore[misc]

    def _latest_feeding(self, bag_id: int) -> int | None:
        """The feeding of the most recent bottle made from this bag (what `feeding_id` on the bag means)."""
        rows = self.store.q("SELECT feeding_id FROM milk_uses WHERE bag=? AND feeding_id IS NOT NULL ORDER BY id DESC LIMIT 1", (bag_id,))
        return rows[0]["feeding_id"] if rows else None

    def use(self, bag_id: int, amount_ml, feeding_id: int | None, user_id: int | None) -> dict | None:
        """A bottle of `amount_ml` poured from the bag (scan out), linked to `feeding_id`.

        One use per feeding, on one bag: saving the same feeding again does not take the milk twice,
        saving it with a new amount adjusts what that feeding took, up or down, even on a bag it had
        emptied, and saving it against another bag moves the take (the first bag gets its milk back,
        and comes back into the stash if that bottle had emptied it). Zero removes the feeding's use
        (the feeding was deleted). More than what is left is refused in plain words, and a refused
        move changes nothing; a hair over (display rounding) takes the balance. Under EMPTY_ML left,
        the bag leaves the stash as used."""
        amount = _clean_take(amount_ml)
        if not self.get(bag_id):
            return None
        if feeding_id is not None:
            # The one-bag case of set_takes: this bag and no other.
            self.set_takes(feeding_id, [{"bag": bag_id, "amount_ml": amount}], user_id)
            return self.get(bag_id)
        with self.store.atomic():
            bag = self.get(bag_id)
            if not bag:
                return None
            self._check_take(bag, amount, None)
            self._apply_take(bag, amount, None, user_id)
            fresh = self.get(bag_id)
            self.sync_reminders(fresh)  # type: ignore[arg-type]
            return fresh

    def set_takes(self, feeding_id: int, takes: list[dict], user_id: int | None) -> dict:
        """One bottle poured from several bags: the feeding's whole allocation, set at once.

        `takes` is [{"bag", "amount_ml"}]; a bag of the feeding's that is not in the list gets its milk
        back (and comes back into the stash if that bottle had emptied it), a listed bag's take is set to
        the amount (up or down, even on a bag it had emptied), and zero drops the take. Every take is
        checked before anything is written, so a refusal changes nothing. An empty list is "the bottle
        was deleted" or "no longer from the stash"."""
        wanted: list[tuple[dict, float]] = []
        seen: set[int] = set()
        for t in takes:
            if not isinstance(t, dict):
                raise ValueError("missing: takes")
            bag_id = int(t.get("bag"))  # type: ignore[arg-type]
            if bag_id in seen:
                raise ValueError("a bag is listed twice")
            seen.add(bag_id)
            bag = self.get(bag_id)
            if not bag:
                raise MilkError(f"Bag {bag_id} is not in the stash.")
            wanted.append((bag, _clean_take(t.get("amount_ml", 0))))
        with self.store.atomic():
            # Judged on the bags as they are now, inside the lock: another phone's bottle from the same bag may
            # have landed since the read above, and a stale balance would pass here and be clamped quietly later.
            fresh = [(self.get(bag["id"]), bag, amount) for bag, amount in wanted]
            for now_bag, bag, _ in fresh:
                if not now_bag:
                    raise MilkError(f"Bag {bag['code']} is not in the stash.")
            wanted = [(now_bag, amount) for now_bag, _, amount in fresh]
            for bag, amount in wanted:
                self._check_take(bag, amount, feeding_id)
            # (`NOT IN ()` is not SQL, and `NOT IN (NULL)` matches nothing: an empty list is spelled out.)
            others = (
                self.store.q("SELECT * FROM milk_uses WHERE feeding_id=?", (feeding_id,))
                if not seen
                else self.store.q(f"SELECT * FROM milk_uses WHERE feeding_id=? AND bag NOT IN ({','.join('?' for _ in seen)})", (feeding_id, *seen))
            )
            for other in others:
                self._give_back(other)
            for bag, amount in wanted:
                self._apply_take(self.get(bag["id"]), amount, feeding_id, user_id)  # type: ignore[arg-type]
                self.sync_reminders(self.get(bag["id"]))  # type: ignore[arg-type]
            return self.for_feeding(feeding_id)

    def _existing_use(self, bag_id: int, feeding_id: int | None) -> dict | None:
        if feeding_id is None:
            return None
        rows = self.store.q("SELECT * FROM milk_uses WHERE bag=? AND feeding_id=?", (bag_id, feeding_id))
        return rows[0] if rows else None

    def _check_take(self, bag: dict, amount: float, feeding_id: int | None) -> None:
        """Refuses in plain words before anything is written."""
        existing = self._existing_use(bag["id"], feeding_id)
        # A bottle already poured from a bag that was discarded afterwards can still be corrected downwards (or
        # kept as it is): nothing new comes out of the bag. Only a new or larger take is refused.
        if bag["status"] == "discarded" and (existing is None or amount > existing["amount_ml"] + 0.01):
            raise MilkError(f"Bag {bag['code']} was discarded.")
        if bag["status"] == "used" and existing is None:
            raise MilkError(f"Bag {bag['code']} is already used up.")
        available = round(bag["remaining_ml"] + (existing["amount_ml"] if existing else 0), 2)
        if amount > available + OVER_TOLERANCE_ML:
            raise MilkError(f"Only {describe_ml(available)} is left in bag {bag['code']}.")
        if bag.get("kind") == "bottle" and amount > 0 and amount < available - OVER_TOLERANCE_ML:
            # A premade bottle is fed whole (what she leaves is thrown away). An older phone that knows nothing of
            # premade bottles would otherwise take part of one and leave a bottle in its spot holding less than it says.
            raise MilkError(f"Premade bottle {bag.get('spot') or ''} is fed whole: update Bramble on this phone (tap the update banner) to feed from it.".replace("bottle  is", "bottle is"))

    def _apply_take(self, bag: dict, amount: float, feeding_id: int | None, user_id: int | None) -> None:
        """Writes one bag's take for a feeding (already checked): the use row and the bag's balance and status."""
        bag_id = bag["id"]
        existing = self._existing_use(bag_id, feeding_id)
        available = round(bag["remaining_ml"] + (existing["amount_ml"] if existing else 0), 2)
        take = round(min(amount, available), 2)
        remaining = round(available - take, 2)
        now = self.now_iso()
        if existing:
            if take <= 0:
                self.store.x("DELETE FROM milk_uses WHERE id=?", (existing["id"],))
            else:
                self.store.x("UPDATE milk_uses SET amount_ml=?, by_user=? WHERE id=?", (take, user_id, existing["id"]))
        elif take > 0:
            self.store.x("INSERT INTO milk_uses (bag, feeding_id, amount_ml, kind, at, by_user) VALUES (?,?,?,'bottle',?,?)", (bag_id, feeding_id, take, now, user_id))
        updates: dict = {"feeding_id": self._latest_feeding(bag_id)}
        if bag["status"] == "discarded":
            updates["remaining_ml"] = remaining  # a discarded bag keeps its balance on record and stays discarded
        elif remaining < EMPTY_ML:
            updates.update(remaining_ml=0.0, status="used", used_at=bag["used_at"] or now, used_by=bag["used_by"] if bag["status"] == "used" else user_id)
        else:
            updates.update(remaining_ml=remaining, status="stored", used_at=None, used_by=None)
        sets = ", ".join(f"{k}=?" for k in updates)
        self.store.x(f"UPDATE milk_bags SET {sets} WHERE id=?", [*updates.values(), bag_id])

    def _give_back(self, use: dict) -> None:
        """A bottle's take leaves the bag it was on (the bottle moved to another bag): the milk is back in
        it, a bag that bottle had emptied is stored again, and a discarded bag keeps its balance on record."""
        bag = self.get(use["bag"])
        self.store.x("DELETE FROM milk_uses WHERE id=?", (use["id"],))
        if not bag:
            return
        remaining = max(0.0, min(bag["volume_ml"], round(bag["remaining_ml"] + use["amount_ml"], 2)))
        updates: dict = {"remaining_ml": remaining, "feeding_id": self._latest_feeding(bag["id"])}
        if bag["status"] == "used" and remaining >= EMPTY_ML:
            updates.update(status="stored", used_at=None, used_by=None)
        sets = ", ".join(f"{k}=?" for k in updates)
        self.store.x(f"UPDATE milk_bags SET {sets} WHERE id=?", [*updates.values(), bag["id"]])
        self.sync_reminders(self.get(bag["id"]))  # type: ignore[arg-type]

    def make_bottles(self, child: int, bottles: list, user_id: int | None, windows: dict | None = None) -> list[dict]:
        """Premade bottles poured ahead of time from stash bags, each into a numbered fridge spot (1 to SPOTS).

        `bottles` is [{"spot", "takes": [{"bag", "amount_ml"}], "client_key"}]. The milk leaves the
        bags now (a `combined` use on each, `into_bag` the bottle), and the bottle is a stash item of its own,
        dated from its oldest milk (and its earliest thaw), the way a combined container is labelled. A feed
        from it later is an ordinary take. Everything is checked before anything is written, so a refusal
        changes nothing; a bottle sent again with its `client_key` (a retry) is returned, not made twice."""
        if not isinstance(bottles, list) or not bottles:
            raise ValueError("missing: bottles")
        if len(bottles) > SPOTS:
            raise MilkError(f"There are {SPOTS} spots, so at most {SPOTS} bottles at a time.")
        plan: list[tuple[int, list[tuple[int, float]], str | None, str]] = []
        spots: set[int] = set()
        for b in bottles:
            if not isinstance(b, dict):
                raise ValueError("missing: bottles")
            try:
                spot = int(b.get("spot"))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                raise ValueError("bad spot")
            if not 1 <= spot <= SPOTS:
                raise MilkError(f"The spots are numbered 1 to {SPOTS}.")
            if spot in spots:
                raise MilkError(f"Two bottles cannot go in spot {spot}.")
            spots.add(spot)
            takes = b.get("takes")
            if not isinstance(takes, list):
                raise ValueError("missing: takes")
            parsed: list[tuple[int, float]] = []
            seen: set[int] = set()
            for t in takes:
                if not isinstance(t, dict):
                    raise ValueError("missing: takes")
                try:
                    bag_id = int(t.get("bag"))  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    raise ValueError("bad bag")
                if bag_id in seen:
                    raise ValueError("a bag is listed twice")
                seen.add(bag_id)
                amount = _clean_take(t.get("amount_ml", 0))
                if amount > 0:
                    parsed.append((bag_id, amount))
            if not parsed:
                raise MilkError(f"The bottle for spot {spot} has no milk in it.")
            # The spots are in the fridge. (Out on the counter, a bottle of older fridge milk would be past its
            # room window from the start: the room clock counts from the oldest milk's pumping.)
            if str(b.get("location") or "fridge") != "fridge":
                raise MilkError("Premade bottles go in the fridge spots.")
            plan.append((spot, parsed, _clean_client_key(b.get("client_key")), "fridge"))
        now = datetime.now(timezone.utc)
        with self.store.atomic():
            made: list[dict] = []
            todo = []
            for spot, parsed, key, location in plan:
                existing = self.by_client_key(child, key) if key else None
                if existing:
                    made.append(existing)  # sent again: the milk already moved
                else:
                    todo.append((spot, parsed, key, location))
            if not todo:
                return made
            taken = {r["spot"]: r for r in self.store.q("SELECT spot, remaining_ml FROM milk_bags WHERE child=? AND kind='bottle' AND status='stored' AND spot IS NOT NULL", (child,))}
            need: dict[int, float] = {}
            for spot, parsed, _, _ in todo:
                if spot in taken:
                    raise MilkError(f"Spot {spot} already has a bottle ({describe_ml(taken[spot]['remaining_ml'])}). Feed it or discard it first.")
                for bag_id, amount in parsed:
                    need[bag_id] = round(need.get(bag_id, 0.0) + amount, 2)
            bags: dict[int, dict] = {}
            for bag_id, amount in need.items():
                bag = self.get(bag_id)
                if not bag or bag["child"] != child:
                    raise MilkError(f"Bag {bag_id} is not in the stash.")
                code = bag["code"]
                if bag["kind"] == "bottle":
                    raise MilkError("A premade bottle cannot be poured into another bottle.")
                if bag["status"] != "stored":
                    raise MilkError(f"Bag {code} is {'already used up' if bag['status'] == 'used' else 'discarded'}.")
                if bag["location"] == "freezer":
                    raise MilkError(f"Bag {code} is in the freezer. Thaw it in the fridge first.")
                if self.parse_iso(bag["expires_at"]) <= now:
                    raise MilkError(f"Bag {code} is past its storage window. Discard it instead.")
                if amount > bag["remaining_ml"] + OVER_TOLERANCE_ML:
                    raise MilkError(f"Only {describe_ml(bag['remaining_ml'])} is left in bag {code}.")
                bags[bag_id] = bag
            for spot, parsed, key, location in todo:
                sources = [(self.get(bag_id), amount) for bag_id, amount in parsed]
                pours = [(bag, round(min(amount, bag["remaining_ml"]), 2)) for bag, amount in sources if bag]  # type: ignore[index]
                pours = [(bag, ml) for bag, ml in pours if ml > 0]
                if not pours:
                    raise MilkError(f"The bottle for spot {spot} has no milk in it.")
                pumped = min(self.parse_iso(bag["pumped_at"]) for bag, _ in pours)
                thawed_from = [self.parse_iso(bag["thawed_at"]) for bag, _ in pours if bag["thawed"] and bag.get("thawed_at")]
                thawed = any(bag["thawed"] for bag, _ in pours)
                thawed_at = min(thawed_from) if thawed_from else (pumped if thawed else None)
                volume = round(sum(ml for _, ml in pours), 2)
                expires = expiry_for(pumped, location, thawed, since=thawed_at, windows=windows)
                code = self._fresh_code()
                notes = "From " + ", ".join(f"{describe_ml(ml)} of bag {bag['code']}" for bag, ml in pours)
                stamp = self.now_iso()
                cur = self.store.x(
                    "INSERT INTO milk_bags (child, code, pumped_at, volume_ml, remaining_ml, location, thawed, thawed_at, expires_at, status, client_key, notes, created, created_by, kind, spot)"
                    " VALUES (?,?,?,?,?,?,?,?,?,'stored',?,?,?,?,'bottle',?)",
                    (child, code, _iso(pumped), volume, volume, location, 1 if thawed else 0, _iso(thawed_at) if thawed_at else None, _iso(expires), key, notes, stamp, user_id, spot),
                )
                bottle_id = cur.lastrowid
                for bag, ml in pours:
                    fresh = self.get(bag["id"])
                    left = round(fresh["remaining_ml"] - ml, 2)  # type: ignore[index]
                    self.store.x("INSERT INTO milk_uses (bag, feeding_id, amount_ml, kind, at, by_user, into_bag) VALUES (?,?,?,'combined',?,?,?)", (bag["id"], None, ml, stamp, user_id, bottle_id))
                    if left < EMPTY_ML:
                        self.store.x("UPDATE milk_bags SET remaining_ml=0, status='used', used_at=?, used_by=? WHERE id=?", (stamp, user_id, bag["id"]))
                    else:
                        self.store.x("UPDATE milk_bags SET remaining_ml=? WHERE id=?", (left, bag["id"]))
                    self.sync_reminders(self.get(bag["id"]))  # type: ignore[arg-type]
                bottle = self.get(bottle_id)  # type: ignore[arg-type]
                self.sync_reminders(bottle)  # type: ignore[arg-type]
                made.append(bottle)  # type: ignore[arg-type]
            return made

    def move_bottle(self, bottle_id: int, spot) -> list[dict] | None:
        """A premade bottle moved to another fridge spot (the family rearranged the fridge). A bottle already in that
        spot takes this one's old spot, in one step, so two bottles never share a spot. Reminders are written again,
        since they name the spot. Returns the bottles that moved; None for a missing id."""
        if isinstance(spot, bool) or not isinstance(spot, (int, str)) or not str(spot).isdigit():
            raise ValueError("bad spot")
        spot = int(spot)
        if not 1 <= spot <= SPOTS:
            raise MilkError(f"The spots are numbered 1 to {SPOTS}.")
        with self.store.atomic():
            bottle = self.get(bottle_id)
            if not bottle:
                return None
            if bottle.get("kind") != "bottle" or bottle["status"] != "stored":
                raise MilkError("Only a premade bottle that is still in the fridge can change spots.")
            if bottle.get("spot") == spot:
                return [bottle]
            other = self.store.q("SELECT id FROM milk_bags WHERE child=? AND kind='bottle' AND status='stored' AND spot=? AND id<>?", (bottle["child"], spot, bottle_id))
            moved = [bottle_id]
            if other:
                self.store.x("UPDATE milk_bags SET spot=? WHERE id=?", (bottle.get("spot"), other[0]["id"]))
                moved.append(other[0]["id"])
            self.store.x("UPDATE milk_bags SET spot=? WHERE id=?", (spot, bottle_id))
            fresh = [self.get(i) for i in moved]
            for b in fresh:
                self.sync_reminders(b)  # type: ignore[arg-type]
            return fresh  # type: ignore[return-value]

    def unmake_bottle(self, bottle_id: int) -> list[dict] | None:
        """Undo a premade bottle that was not really made (or made from the wrong bags): every bag it was poured
        from gets its milk back (`_give_back`: the `combined` use goes, a bag the pour had emptied is stored
        again), and the bottle leaves the stash and frees its spot. Refused once any of it was fed or adjusted:
        that milk is gone, so the bottle is fed or discarded instead. Returns the bags as they are now."""
        with self.store.atomic():
            bottle = self.get(bottle_id)
            if not bottle:
                return None
            name = f"Premade bottle {bottle['spot']}" if bottle.get("spot") else "This bottle"
            if bottle.get("kind") != "bottle":
                raise MilkError("Only a premade bottle can be undone this way.")
            if bottle["status"] != "stored":
                raise MilkError(f"{name} is already {'fed' if bottle['status'] == 'used' else 'discarded'}, so its milk cannot go back in the bags.")
            if self.store.q("SELECT 1 FROM milk_uses WHERE bag=? LIMIT 1", (bottle_id,)):
                raise MilkError(f"{name} was already fed from, so its milk cannot go back in the bags. Feed or discard it instead.")
            pours = self.store.q("SELECT * FROM milk_uses WHERE into_bag=? AND kind='combined' ORDER BY id", (bottle_id,))
            for use in pours:
                self._give_back(use)
            self._delete_rows(bottle_id)
            return [b for b in (self.get(u["bag"]) for u in pours) if b]

    def delete(self, bag_id: int) -> bool:
        with self.store.atomic():
            return self._delete_rows(bag_id)

    def _delete_rows(self, bag_id: int) -> bool:
        """A bag and everything hanging off it; the caller holds the transaction."""
        self.store.x("DELETE FROM reminders WHERE tag=? AND sent=0", (f"milk:{bag_id}",))
        self.store.x("DELETE FROM milk_uses WHERE bag=?", (bag_id,))
        try:
            self.store.x("UPDATE milk_travel_labels SET bag_id=NULL, assigned_at=NULL WHERE bag_id=?", (bag_id,))
        except Exception:  # a database from before travel stickers
            pass
        return self.store.x("DELETE FROM milk_bags WHERE id=?", (bag_id,)).rowcount > 0

    # ---- reminders
    def sync_reminders(self, bag: dict) -> None:
        """Replace the unsent reminders for this bag: one 'expiring soon' and one 'expired' while stored.

        Only moments still ahead are scheduled. A bag entered late in its life (pumped days ago) gets no
        push for an "expiring soon" moment that has already passed, and one entered past its window gets
        none at all: the phone shows its state at entry, and a late push would only be noise."""
        tag = f"milk:{bag['id']}"
        self.store.x("DELETE FROM reminders WHERE tag=? AND sent=0", (tag,))
        if bag["status"] != "stored":
            return
        expires = self.parse_iso(bag["expires_at"])
        now = datetime.now(timezone.utc)
        volume = describe_ml(bag["remaining_ml"])  # what is still in it, which is what the push is about
        pumped = self.parse_iso(bag["pumped_at"]).astimezone(self.zone()).strftime("%a %b %-d, %-I:%M %p")
        where = {"room": "at room temperature", "fridge": "in the fridge", "freezer": "in the freezer"}[bag["location"]]
        soon_at = expires - LEAD[bag["location"]]
        until = expires.astimezone(self.zone()).strftime("%-I:%M %p")
        # A premade bottle is found by its spot, not its code.
        name = f"premade bottle {bag['spot']}" if bag.get("kind") == "bottle" and bag.get("spot") else bag["code"]
        rows = []
        if bag["location"] == "room" and not bag["thawed"]:
            # Fresh milk kept out on purpose (a bottle due soon needs no warming): the useful push is the fridge
            # deadline, not "expiring". Moving the bag to the fridge in Bramble replaces both of these.
            # Out since the pump, or since it came out of the fridge (`out_at`): a bag moved out a day after pumping
            # was told "out since it was pumped, keeps 30 hours" (sweep 2026-10-27).
            moved = self.parse_iso(bag["out_at"]) if bag.get("out_at") else None
            since = moved or self.parse_iso(bag["pumped_at"])
            hours = round((expires - since).total_seconds() / 3600, 1)
            out = f"{hours:g} hour{'' if hours == 1 else 's'}"
            since_text = f"since {since.astimezone(self.zone()).strftime('%a %-I:%M %p')}" if moved else f"since it was pumped ({pumped})"
            if soon_at > now:
                rows.append((soon_at, f"Fridge the milk by {until} · {volume} ({name})", f"Out at room temperature {since_text}. It keeps {out} out: put it in the fridge or feed it by {until}, then tap Move to fridge in Bramble."))
            if expires > now:
                rows.append((expires, f"Milk out too long · {volume} ({name})", f"At room temperature {since_text}, past {out}. Discard it in Bramble."))
        else:
            if soon_at > now:
                rows.append((soon_at, f"Milk expiring soon · {volume} ({name})", f"Pumped {pumped}, {where}. Good until {expires.astimezone(self.zone()).strftime('%a %-I:%M %p')}. Use it first."))
            if expires > now:
                rows.append((expires, f"Milk expired · {volume} ({name})", f"Pumped {pumped}, {where}. Past its storage window: discard it in Bramble."))
        for at, title, body in rows:
            self.store.x(
                "INSERT INTO reminders (child, at, title, body, tag, source, sent, created) VALUES (?,?,?,?,?,'milk',0,?)",
                (bag["child"], _iso(at), title, body, tag, self.now_iso()),
            )


def describe_ml(ml: float) -> str:
    oz = ml / 29.5735
    return f"{round(ml)} mL ({oz:.1f} oz)"


# --------------------------------------------------------------------------- printing


class PrinterError(Exception):
    pass


NIIMBOT_WIDTH = {"b1": 384, "b18": 384, "b21": 384, "d11": 96, "d110": 96}


class Printer:
    """Direct label printing from the server, so no phone app is involved.

    BRAMBLE_PRINTER selects the backend:
      niimbot://bluetooth/AA:BB:CC:DD:EE:FF?model=b1&density=3  Niimbot B1/B21/D11 over the server's Bluetooth (niimprint)
      niimbot://usb?model=b1  or  niimbot://usb/dev/ttyACM0      the same printer on a USB cable to the server
      bridge://192.0.2.190:8110?token=SECRET                   forward to print_bridge.py on the Proxmox host (the LXC
                                                                  cannot open Bluetooth sockets; the host can)
      brother_ql://tcp/192.0.2.50?model=QL-810W&label=29x62    Brother QL over Wi-Fi/Ethernet (brother_ql + Pillow)
      zebra://192.0.2.2:9100?darkness=20&rotate=0               Zebra ZPL printer (GK420d, ZD series…) on its raw port,
                                                                  directly or through a print server. The label is sent as
                                                                  a native 203 dpi bitmap, so the size chosen in Settings
                                                                  › Milk labels is exactly what prints (Pillow only)
      file:///some/dir                                            writes PNGs to a folder (tests, or a CUPS hot folder)
    """

    KINDS = ("niimbot", "brother_ql", "bridge", "zebra", "file")
    # How many finished print jobs are kept for /print/job/<id>; the phone polls for a few seconds at most.
    JOBS_KEPT = 20
    # Through the AP1 print server the Zebra's ~HS answer takes 2–9 s to come back, and it only comes back on
    # the connection that wrote to the printer (measured 2026-10-06: a ~HS on its own connection right after a
    # print went unanswered three times; sent together with the ZPL it was answered). So the question rides
    # along with the label, the print socket stays open for CHECK_WINDOW, and "still printing" is asked again.
    CHECK_WINDOW = 10.0
    # What a job says per backend when the backend has no printer state to report (file, bridge, niimbot, brother).
    SENT_DETAIL = {
        "file": "Saved as a file on the server (file:// printer); nothing was printed.",
        "bridge": "Handed to the print bridge on the Proxmox host, which printed it.",
        "niimbot": "The Niimbot accepted the label.",
        "brother_ql": "The Brother printer accepted the label.",
    }

    def __init__(self, spec: str | None, niimbot_factory=None, role: str = "companion", zebra_send=None, zebra_query=None, check_pause: float = 0.5):
        self.role = role  # "companion" (inside the LXC) or "bridge" (on the host next to the adapter): changes the hints
        self.spec = (spec or "").strip()
        # Not urlparse: "brother_ql" has an underscore, which is not a legal URL scheme character.
        self.kind = self.spec.split("://", 1)[0].lower() if "://" in self.spec else None
        self._niimbot_factory = niimbot_factory  # tests inject a fake (transport, client) builder
        self._zebra_send = zebra_send  # tests capture the ZPL instead of opening a socket
        self._zebra_query = zebra_query  # tests answer ~HS instead of the printer
        self._check_pause = check_pause  # between two "still printing" answers
        self._jobs: dict[int, dict] = {}
        self._jobs_lock = threading.Lock()
        self._next_job = 1
        self._checks: list[threading.Thread] = []
        self._public: tuple[float, dict] | None = None  # (monotonic time, answer) of public_status for a bridge
        self._public_lock = threading.Lock()

    # ---- print jobs: what each request did, so the phone can show it and the journal can answer "did it print?"
    def print_label(self, png: bytes, code: str | None = None, background: bool = True) -> dict:
        """print_png plus a job record and an INFO line (backend, bag code, result, duration; never the image).

        On a Zebra the job then listens for the printer's own answer (~HS) in the background and updates
        itself; `background=False` does that inline (tests). Other backends have no state to ask for: their
        job is final at once with a plain-language note of what "sent" means there."""
        bag = code if isinstance(code, str) and 0 < len(code) <= 12 and code.isalnum() else None
        started = time.monotonic()
        try:
            result, link = self._print(png)
        except PrinterError as exc:
            log.warning("print failed: backend=%s bag=%s after %dms: %s", self.kind, bag or "-", (time.monotonic() - started) * 1000, exc)
            raise
        ms = int((time.monotonic() - started) * 1000)
        checking = self.kind == "zebra"
        job = {
            "id": 0,
            "backend": self.kind,
            "bag": bag,
            "state": "sent",
            "checking": checking,
            "detail": "Sent to the Zebra. Waiting for the printer to answer…" if checking else self.SENT_DETAIL.get(self.kind or "", "The printer accepted the label."),
            "sent_at": _iso(datetime.now(timezone.utc)),
            "checked_at": None,
        }
        with self._jobs_lock:
            job["id"] = self._next_job
            self._next_job += 1
            self._jobs[job["id"]] = job
            for old in sorted(self._jobs)[: -self.JOBS_KEPT]:
                del self._jobs[old]
        log.info("print job %d: backend=%s bag=%s result=%s in %dms", job["id"], self.kind, bag or "-", result.get("printed"), ms)
        if checking:
            if background:
                t = threading.Thread(target=self._check_zebra, args=(job["id"], link), name=f"zebra-check-{job['id']}", daemon=True)
                self._checks = [c for c in self._checks if c.is_alive()] + [t]
                t.start()
            else:
                self._check_zebra(job["id"], link)
        elif link:
            link.close()
        return {**result, "job": self.job(job["id"])}

    def job(self, job_id: int) -> dict | None:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def wait_for_checks(self, timeout: float) -> None:
        """Tests: block until the background printer checks have finished."""
        for t in list(self._checks):
            t.join(timeout)

    def _update_job(self, job_id: int, **changes) -> None:
        with self._jobs_lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(changes)

    def _check_zebra(self, job_id: int, link: "ZebraLink | None") -> None:
        """Read the Zebra's ~HS answer on the print socket until it is no longer busy or the window is up."""
        try:
            _, addr, port = self._zebra_addr()
        except PrinterError:  # the label went out, so the address parsed; never let the check thread die on it
            return
        deadline = time.monotonic() + self.CHECK_WINDOW
        fields = None
        state, detail = "no_answer", NO_ANSWER_DETAIL
        asked = link is not None  # the first ~HS went out together with the label
        try:
            while True:
                wait = max(0.5, deadline - time.monotonic())
                try:
                    if self._zebra_query:
                        raw = self._zebra_query(addr, port, b"~HS", wait)
                    else:
                        link = link or ZebraLink(addr, port)
                        if not asked:
                            link.send(b"~HS")
                        raw = link.read(wait)
                except OSError as exc:
                    raw = b""
                    log.warning("print job %d: status check failed: %s", job_id, exc)
                asked = False
                fields = parse_host_status(raw)
                state, detail = describe_host_status(fields) if fields else ("no_answer", NO_ANSWER_DETAIL)
                again = state == "busy" and time.monotonic() < deadline
                self._update_job(job_id, state=state, detail=detail, checking=again, checked_at=_iso(datetime.now(timezone.utc)))
                if not again:
                    break
                time.sleep(self._check_pause)
        finally:
            if link:
                link.close()
        log.info("print job %d: Zebra answered %s%s", job_id, state, f" ({fields['raw']})" if fields else "")

    @property
    def configured(self) -> bool:
        return self.kind in self.KINDS

    def _zebra_addr(self) -> tuple[str, str, int]:
        """(host as written, address, port) of a zebra:// spec. A typo is a printer problem in plain words."""
        host, _, _ = self._opts()
        if not host:
            raise PrinterError("zebra:// needs the printer's address, e.g. zebra://<printer-ip>:9100.")
        addr, _, port = host.partition(":")
        try:
            number = int(port) if port else 9100
        except ValueError:
            number = 0
        if not addr or not 0 < number < 65536:
            raise PrinterError(f"BRAMBLE_PRINTER zebra port {port!r} is not a port number (usually 9100), e.g. zebra://<printer-ip>:9100.")
        return host, addr, number

    def _opts(self) -> tuple[str, str, dict]:
        """(transport, target, options) from the spec, e.g. niimbot://bluetooth/AA:..?model=b1 → ("bluetooth", "AA:..", {...})."""
        rest = self.spec.split("://", 1)[1] if "://" in self.spec else ""
        u = urlparse("bq://" + rest)
        opts = {k: v[-1] for k, v in parse_qs(u.query).items()}
        return u.netloc, u.path.lstrip("/"), opts

    def status(self) -> dict:
        if not self.configured:
            if self.role == "bridge":
                detail = "No printer set on the print bridge yet. On the Proxmox host: pair the Niimbot with bluetoothctl, then set BRAMBLE_PRINTER=niimbot://bluetooth/<MAC>?model=b1 in /opt/bramble-bridge/data/env and restart bramble-print-bridge."
            else:
                detail = "No printer set yet. An admin sets it in Settings › Milk labels & printer, or on the server with BRAMBLE_PRINTER (zebra://<ip>:9100, brother_ql://tcp/<ip>?model=QL-810W&label=29x62, bridge://<host>:8110?token=…)."
            return {"configured": False, "kind": None, "detail": detail}
        detail = None
        if self.kind == "zebra":
            try:
                self._zebra_addr()
            except PrinterError as exc:
                detail = str(exc)
            else:
                try:
                    import PIL  # type: ignore  # noqa: F401
                except Exception as exc:  # pragma: no cover
                    detail = f"Pillow not installed on the server ({exc}). Re-run install.sh."
        if self.kind == "brother_ql":
            try:
                import brother_ql  # type: ignore  # noqa: F401
                import PIL  # type: ignore  # noqa: F401
            except Exception as exc:  # pragma: no cover
                detail = f"brother_ql/Pillow not installed on the server ({exc}). Re-run install.sh."
        if self.kind == "bridge":
            try:
                remote = self._bridge_request("GET", "/status")
            except PrinterError as exc:
                return {"configured": False, "kind": "bridge", "detail": str(exc), "target": self.spec.split("?")[0]}
            return {"configured": bool(remote.get("configured")), "kind": "bridge", "detail": remote.get("detail"), "target": f"{self.spec.split('?')[0]} → {remote.get('target') or remote.get('kind') or 'no printer set on the bridge'}"}
        if self.kind == "niimbot" and self._niimbot_factory is None:
            transport, _, opts = self._opts()
            try:
                import niimbot_proto  # noqa: F401
                import PIL  # type: ignore  # noqa: F401
            except Exception as exc:  # pragma: no cover
                detail = f"Niimbot driver/Pillow not installed on the server ({exc}). Re-run install.sh."
            if detail is None and transport not in ("bluetooth", "usb"):
                detail = "niimbot:// needs bluetooth/<MAC> or usb[/dev/tty…]."
            if detail is None and opts.get("model", "b1").lower() not in NIIMBOT_WIDTH:
                detail = f"Unknown Niimbot model {opts.get('model')!r}; one of {', '.join(NIIMBOT_WIDTH)}."
            if detail is None and transport == "bluetooth":
                adapters = os.listdir("/sys/class/bluetooth") if os.path.isdir("/sys/class/bluetooth") else []
                if not adapters:
                    detail = "No Bluetooth adapter is visible to the companion (no /sys/class/bluetooth/hci*)."
        return {"configured": detail is None, "kind": self.kind, "detail": detail, "target": self.spec.split("?")[0]}

    # The unauthenticated /health shows this; a bridge is asked at most this often from it.
    PUBLIC_STATUS_TTL = 60.0

    def public_status(self) -> dict:
        """What the public /health may show: configured, kind and a detail with no address or target in it.

        A bridge:// printer is a request to the Proxmox host, so it is cached for PUBLIC_STATUS_TTL; anyone
        reaching /health would otherwise make the companion call the host (6 s each while it is down)."""
        if self.kind != "bridge":
            full = self.status()
            return {"configured": full["configured"], "kind": full["kind"], "detail": full["detail"]}
        with self._public_lock:
            now = time.monotonic()
            if self._public and now - self._public[0] < self.PUBLIC_STATUS_TTL:
                return dict(self._public[1])
            try:
                remote = self._bridge_request("GET", "/status")
                answer = {"configured": bool(remote.get("configured")), "kind": "bridge", "detail": remote.get("detail")}
            except PrinterError:
                answer = {"configured": False, "kind": "bridge", "detail": "The print bridge is not reachable. Is bramble-print-bridge running on the Proxmox host?"}
            self._public = (now, answer)
            return dict(answer)

    def print_png(self, png: bytes) -> dict:
        result, link = self._print(png)
        if link:
            link.close()
        return result

    def _print(self, png: bytes) -> "tuple[dict, ZebraLink | None]":
        """One label out; on a Zebra also the still-open print socket, which carries the printer's answer."""
        if not self.configured:
            raise PrinterError(self.status()["detail"])
        if self.kind == "file":
            directory = urlparse(self.spec).path or "."  # file:///dir parses fine
            os.makedirs(directory, exist_ok=True)
            name = os.path.join(directory, f"label-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.png")
            with open(name, "wb") as fh:
                fh.write(png)
            return {"ok": True, "printed": name}, None
        if self.kind == "niimbot":
            return self._niimbot(png), None
        if self.kind == "bridge":
            return self._bridge_request("POST", "/print", {"png": base64.b64encode(png).decode()}), None
        if self.kind == "zebra":
            return self._zebra(png)
        return self._brother(png), None

    def _zebra(self, png: bytes) -> "tuple[dict, ZebraLink | None]":
        """ZPL printer on its raw port. The PNG is already at the printer's 203 dpi, so one pixel is one dot."""
        host, addr, port = self._zebra_addr()
        _, _, opts = self._opts()
        try:
            from PIL import Image  # type: ignore
        except Exception as exc:
            raise PrinterError(f"Pillow not installed on the server ({exc}).")
        rotate = _opt_int(opts, "rotate", 0)
        darkness = _opt_int(opts, "darkness", None)
        image = _open_label(Image, png, "L")
        if rotate:
            image = image.rotate(-rotate, expand=True)
        zpl = zebra_label(image, darkness=darkness)
        link = None
        try:
            if self._zebra_send:
                self._zebra_send(addr, port, zpl)
            else:
                # The host-status question goes out with the label on the same socket: through a print server
                # the printer's answer only comes back to the connection that wrote (see CHECK_WINDOW).
                # ~PS first: a paused printer (after a jam, a head-open or a calibration) resumes on its own
                # instead of asking the owner to find the feed button.
                link = ZebraLink(addr, port)
                link.send(b"~PS" + zpl + b"~HS")
        except OSError as exc:
            if link:
                link.close()
            raise PrinterError(f"Could not reach the Zebra at {host}: {exc}. Is it on and on the network?")
        return {"ok": True, "printed": f"zebra {host}", "width": image.width, "height": image.height}, link

    def _bridge_request(self, method: str, path: str, body: dict | None = None) -> dict:
        """Talk to print_bridge.py (same Printer class, running where the Bluetooth adapter is)."""
        import urllib.error
        import urllib.request

        host, _, opts = self._opts()
        token = opts.get("token", "")
        if not host:
            raise PrinterError("bridge:// needs host:port.")
        req = urllib.request.Request(f"http://{host}{path}", data=json.dumps(body).encode() if body is not None else None, method=method)
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60 if method == "POST" else 6) as res:
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode()).get("detail")
            except Exception:
                detail = None
            raise PrinterError(detail or f"Print bridge answered {exc.code}.")
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise PrinterError(f"Print bridge at {host} is not reachable ({getattr(exc, 'reason', exc)}). Is bramble-print-bridge running on the Proxmox host?")

    def _niimbot(self, png: bytes) -> dict:
        """Niimbot B1-class printer over RFCOMM Bluetooth or USB serial, via the open-source niimprint protocol."""
        transport_kind, target, opts = self._opts()
        model = opts.get("model", "b1").lower()
        density = max(1, min(5, _opt_int(opts, "density", 3) or 3))
        if model in ("b18", "d11", "d110"):
            density = min(density, 3)
        rotate = _opt_int(opts, "rotate", 0)
        max_w = NIIMBOT_WIDTH.get(model)
        if not max_w:
            raise PrinterError(f"Unknown Niimbot model {model!r}.")
        try:
            from PIL import Image  # type: ignore
        except Exception as exc:
            raise PrinterError(f"Pillow not installed on the server ({exc}).")
        image = _open_label(Image, png, "L")
        if rotate:
            image = image.rotate(-rotate, expand=True)
        # The head is 384 dots (48 mm) on a B1: a 50 × 30 label renders 400 px wide, so scale to fit,
        # then hard-threshold to pure black and white; thermal heads print no greys.
        if image.width > max_w:
            image = image.resize((max_w, max(1, round(image.height * max_w / image.width))), Image.LANCZOS)
        image = image.point(lambda p: 0 if p < 160 else 255, mode="L").convert("1")
        try:
            if self._niimbot_factory:
                client = self._niimbot_factory(transport_kind, target)
            else:
                from niimbot_proto import BluetoothTransport, PrinterClient, SerialTransport

                transport = BluetoothTransport(target.upper()) if transport_kind == "bluetooth" else SerialTransport(port=target or "auto")
                client = PrinterClient(transport)
            client.print_image(image, density=density)
        except PrinterError:
            raise
        except OSError as exc:
            where = f"Bluetooth {target.upper()}" if transport_kind == "bluetooth" else f"USB {target or 'auto'}"
            raise PrinterError(f"Could not reach the Niimbot over {where}: {exc}. Is it on, paired with the server, and in range?")
        except Exception as exc:
            raise PrinterError(f"Niimbot print failed: {exc}")
        return {"ok": True, "printed": f"niimbot {model} via {transport_kind} {target}".strip(), "model": model, "width": image.width, "height": image.height, "density": density}

    def _brother(self, png: bytes) -> dict:
        # Re-parse under a legal scheme name so netloc/path/query come out right.
        u = urlparse("bq://" + self.spec.split("://", 1)[1])
        opts = {k: v[-1] for k, v in parse_qs(u.query).items()}
        model = opts.get("model", "QL-810W")
        label = opts.get("label", "29x62")
        # brother_ql://tcp/192.0.2.50:9100 → backend "network", identifier "tcp://192.0.2.50:9100"
        transport = u.netloc or "tcp"
        target = u.path.lstrip("/")
        identifier = f"{transport}://{target}" if transport in ("tcp", "usb") else target
        try:
            from PIL import Image  # type: ignore
            from brother_ql.backends.helpers import send  # type: ignore
            from brother_ql.conversion import convert  # type: ignore
            from brother_ql.raster import BrotherQLRaster  # type: ignore
        except Exception as exc:
            raise PrinterError(f"brother_ql/Pillow not installed on the server ({exc}).")
        try:
            image = _open_label(Image, png, "RGB")
            qlr = BrotherQLRaster(model)
            qlr.exception_on_warning = True
            instructions = convert(qlr=qlr, images=[image], label=label, rotate="auto", threshold=70.0, dither=False, compress=False, red=False, dpi_600=False, hq=True, cut=True)
            send(instructions=instructions, printer_identifier=identifier, backend_identifier="network" if transport == "tcp" else "pyusb", blocking=True)
        except PrinterError:
            raise
        except Exception as exc:
            raise PrinterError(f"Printer {identifier} refused the label: {exc}")
        return {"ok": True, "printed": identifier, "model": model, "label": label}


class ZebraLink:
    """One raw-port connection kept open from the label to the printer's ~HS answer, so a slow reply is not lost."""

    def __init__(self, addr: str, port: int):
        import socket

        self.sock = socket.create_connection((addr, port), timeout=10)
        self.sock.settimeout(0.5)
        self.buf = b""

    def send(self, data: bytes) -> None:
        self.sock.sendall(data)

    def ask(self, wait: float) -> bytes:
        """~HS, then its answer."""
        self.send(b"~HS")
        return self.read(wait)

    def read(self, wait: float) -> bytes:
        """The first complete three-line ~HS reply within `wait` seconds, else b""."""
        import socket

        end = time.monotonic() + wait
        while time.monotonic() < end and self.buf.count(b"\x03") < 3:
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout:
                continue
            if not chunk:
                break
            self.buf += chunk
        parts = self.buf.split(b"\x03")
        if len(parts) < 4:
            return b""
        self.buf = b"\x03".join(parts[3:])  # a later reply, if one is already queued, is read next time
        return b"\x03".join(parts[:3]) + b"\x03"

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


def zebra_label(image, darkness: int | None = None) -> bytes:
    """One label as ZPL: ^PW/^LL from the image, the pixels as an uncompressed ^GFA bitmap (1 bit = black)."""
    width, height = image.size
    # Thermal heads print no greys: hard threshold, black pixels become 1 bits (PIL's "1" mode stores white as 1).
    bits = image.point(lambda p: 255 if p < 160 else 0, mode="L").convert("1")
    bytes_per_row = (width + 7) // 8
    data = bits.tobytes()  # rows padded to whole bytes with 0 bits, exactly what ^GF wants
    total = bytes_per_row * height
    head = [b"^XA", b"^CI28", b"^PW%d" % width, b"^LL%d" % height, b"^LH0,0"]
    if darkness is not None:
        head.append(b"~SD%02d" % max(0, min(30, darkness)))
    body = b"^FO0,0^GFA,%d,%d,%d,%s^FS" % (total, total, bytes_per_row, data.hex().upper().encode())
    return b"".join(head) + body + b"^PQ1^XZ"


NO_ANSWER_DETAIL = "The printer did not answer within a few seconds, which happens through the print server. The label usually prints anyway."

# Plain language for what the Zebra said about itself, by the state it is in. Nothing here claims "printed":
# ~HS reports the printer's condition and what is in its buffer, not that paper came out.
HOST_STATUS_DETAIL = {
    "head_open": "The printer answered: its lid is open. Close it and the label prints.",
    "paper_out": "The printer answered: out of labels. It prints this label as soon as new labels are loaded.",
    "paused": "The printer answered: paused, and did not resume on its own. Press the round feed button on top of the Zebra once.",
    "temperature": "The printer answered: its print head is too hot or too cold. It prints when it has settled.",
    "busy": "The printer answered: it has the label and is printing it.",
    "ready": "The printer answered: done, nothing left to print. The label should be out.",
}


def parse_host_status(raw: bytes) -> dict | None:
    """The Zebra ~HS reply (ZPL manual: three STX…ETX lines) → the flags that matter here, or None if unusable."""
    lines = [part.split(b"\x03", 1)[0] for part in raw.split(b"\x02")[1:]]
    if len(lines) < 2:
        return None
    try:
        first = [int(v) for v in lines[0].decode("ascii").split(",")]
        second = [int(v) for v in lines[1].decode("ascii").split(",")]
    except (UnicodeDecodeError, ValueError):
        return None
    if len(first) < 12 or len(second) < 9:
        return None
    return {
        "paper_out": first[1] == 1,
        "paused": first[2] == 1,
        "buffered": first[4],  # formats waiting in the receive buffer
        "buffer_full": first[5] == 1,
        "temperature": first[10] == 1 or first[11] == 1,
        "head_open": second[2] == 1,
        "remaining": second[8],  # labels left in the current batch
        "raw": ",".join(str(v) for v in first[:12]) + " / " + ",".join(str(v) for v in second[:9]),
    }


def describe_host_status(fields: dict) -> tuple[str, str]:
    """(state, plain-language detail) for a parsed ~HS reply; the first problem that stops printing wins."""
    for state in ("head_open", "paper_out", "paused", "temperature"):
        if fields[state]:
            return state, HOST_STATUS_DETAIL[state]
    if fields["buffered"] or fields["remaining"] or fields["buffer_full"]:
        return "busy", HOST_STATUS_DETAIL["busy"]
    return "ready", HOST_STATUS_DETAIL["ready"]


def _opt_int(opts: dict, key: str, default):
    """A numeric option from BRAMBLE_PRINTER; a typo there is the server's problem, not the phone's."""
    raw = opts.get(key)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError:
        raise PrinterError(f"BRAMBLE_PRINTER option {key}={raw!r} is not a whole number.")


def _open_label(Image, png: bytes, mode: str):
    """The label image, or a printer error the phone can show (a corrupt PNG is not an internal error)."""
    try:
        return Image.open(io.BytesIO(png)).convert(mode)
    except Exception as exc:  # noqa: BLE001 - Pillow raises its own families for bad data
        raise PrinterError(f"The label image could not be read ({exc.__class__.__name__}).")


def decode_png_field(data: dict) -> bytes:
    raw = str(data.get("png") or "")
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        png = base64.b64decode(raw, validate=True)
    except Exception:
        raise ValueError("missing: png")
    if not png.startswith(b"\x89PNG") or len(png) > 4 * 1024 * 1024:
        raise ValueError("missing: png")
    return png
