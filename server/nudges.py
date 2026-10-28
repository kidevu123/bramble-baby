"""Data-driven reminders ("nudges") computed from fresh Baby Buddy data.

The delivery thread in bramble_server.py sends whatever is in the `reminders` table when its moment
comes. This module decides what should be in that table, from what the household has logged:

  * feed    – the child usually eats about now (median gap between recent feeds, kept inside the
              age-typical range), anchored on the last feed; silent while nothing has been logged,
              cancelled the moment a feed is logged, one push per gap.
  * pump    – same idea for pumping, anchored on the last session, sent to the person who pumps
              (the caregiver tagged on the pumping entries, else the person with the Mom role, else
              every phone). The cadence can be fixed from Settings instead of measured.
  * diaper  – the one safety nudge: no wet diaper for longer than 1.5x the typical interval for
              the child's age (the same per-day-of-life numbers as the Home card). Ignores quiet hours.
  * summary – one evening line per thing: feeds, diapers, sleep, pumping, stash.
  * weight  – when a Hatch weighing lands in Baby Buddy (hook called by hatch.py), with the change
              since the previous weighing. Never for the backlog of a first import.
  * activity – a ping to the other caregivers' phones when someone logs something ("Tom logged a bottle:
              60 mL at 1:27 PM"), from the caregiver tag on the entry; never to the person who logged it,
              never in quiet hours, off by default. A ledger of seen entries (`nudge_seen`) makes the first
              poll silent and every later entry a ping once; nothing is a burst.
  * supply  – pumping is down: each of the last three full days came in under 85 % of the daily average
              of the eleven days before (days with nothing logged are missing, not zero, so a forgotten day
              never reads as a drop). Sent to the pumper's phone, deferred through quiet hours, and at most
              once every three days while it stays low; the tap opens Reports.
  * milk    – the expiry reminders milk.py already schedules; this module only routes their tap to the
              Stash tab and honours the on/off switch. A feed nudge names the bag to use first when one
              expires within the day, so there is no separate "use first" push.

Every poll (`run_once`) recomputes from scratch and *replaces* the unsent rows of each kind, so the
table always holds at most one upcoming row per kind and child, a logged feed makes its row vanish,
and a row that already went out for the same anchor (the feed it was computed from, the day, the
weighing) is never inserted again. Nothing here is a burst: a first run over a full history plans one
moment per kind, in the future or at once, never one per past gap.

Settings live in `nudge_settings` (one JSON blob per child, written from Settings › Notifications),
and the caregiver's Baby Buddy token used for polling is kept like the Hatch one (0600 file, never
returned). Every push is worded in the second person with the numbers that matter, in the household's
units, no exclamation marks, no emoji.
"""
from __future__ import annotations

import json
import logging
import os
import statistics
import threading
from datetime import date, datetime, timedelta, timezone

import hatch as hatch_mod
from zones import household_zone, local_zone  # noqa: F401 - local_zone kept importable from here

log = logging.getLogger("bramble.nudges")

POLL_SECONDS = 120
FIRST_POLL_SECONDS = 20
HISTORY_HOURS = 48
CADENCE_HOURS = 24
# A moment that passed more than this long ago is dropped rather than sent late; the next anchor resets it.
LATE_GRACE = timedelta(minutes=60)
# A ledger last written longer ago than this was not polled: catch up quietly (see _ledger).
LEDGER_GAP = timedelta(minutes=15)
# Pumping cadence stays inside these bounds whatever the median says (a 20 min gap is one session logged twice).
PUMP_BOUNDS_H = (1.5, 6.0)
ML_PER_OZ = 29.5735
G_PER_OZ = 28.3495
G_PER_LB = 453.592

# The supply watch: the last SUPPLY_RECENT_DAYS full days against the days before them, back to SUPPLY_DAYS.
SUPPLY_DAYS = 14
SUPPLY_RECENT_DAYS = 3
SUPPLY_MIN_BASE_DAYS = 5
SUPPLY_DROP = 0.85
SUPPLY_REPEAT = timedelta(days=3)

SOURCE = "nudge"
KINDS = ("feed", "pump", "diaper", "summary", "weight", "supply", "activity")

DEFAULTS: dict = {
    "feed": True,
    "pump": True,
    "pumpEveryMinutes": None,  # null = measured from the last sessions
    "milk": True,
    "diaper": True,
    "summary": True,
    "summaryAt": "20:00",
    "weight": True,
    "supply": True,
    "activity": False,  # opt-in: pings to the other phones when someone logs something
    "quietStart": "22:00",
    "quietEnd": "07:00",
    "units": None,  # {"volume": "ml"|"oz", "weight": "lb"|"kg"}: the phone that last saved Settings
}

# Feeds per day by age (AAP HealthyChildren / CDC, the same table as src/lib/science/feeding.ts):
# (min_months, max_months, day_range, feeds_per_day). The feed gap stays between 24/hi and 24/lo hours.
FEEDS_PER_DAY = [
    (0, 0.25, (0, 2), (8, 12)),
    (0, 0.5, (3, 14), (8, 12)),
    (0.5, 1, None, (8, 12)),
    (1, 2, None, (7, 9)),
    (2, 4, None, (6, 8)),
    (4, 6, None, (5, 7)),
    (6, 9, None, (4, 6)),
    (9, 12, None, (3, 5)),
    (12, 24, None, (2, 4)),
]
# Wet diapers per day, low end, by day of life (src/lib/science/diapers.ts).
WET_PER_DAY_LO = [(0, 1, 1), (2, 2, 2), (3, 3, 3), (4, 4, 4), (5, 42, 6), (43, 182, 5), (183, 365, 5), (366, 10**6, 4)]
DIAPER_FACTOR = 1.5

SCHEMA = """
CREATE TABLE IF NOT EXISTS nudge_settings (child INTEGER PRIMARY KEY, blob TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nudge_seen (child INTEGER NOT NULL, kind TEXT NOT NULL, entry_id INTEGER NOT NULL, PRIMARY KEY (child, kind, entry_id));
"""
# The ledger row that says "this child's window has been read once": the first poll is silent even when the
# window was empty, and the one after it pings (an empty ledger alone cannot tell the two apart).
LEARNED = "_learned"
# Columns added to the live reminders table (the delivery thread reads them through Nudges.route).
ADDED_COLUMNS = (("url", "TEXT"), ("user_id", "INTEGER"), ("anchor", "TEXT"))

PROBLEMS = {
    "needs_login": "Open Settings › Notifications on any phone once so Bramble can read Baby Buddy again.",
    "babybuddy": "Baby Buddy did not answer; Bramble will try again in a couple of minutes.",
}


# --------------------------------------------------------------------------- pure helpers


def feed_gap_bounds(age_months: float, day_of_life: int) -> tuple[float, float]:
    """(min_hours, max_hours) between feeds that is typical at this age."""
    for lo_m, hi_m, days, (lo, hi) in FEEDS_PER_DAY:
        if days and days[0] <= day_of_life <= days[1]:
            return 24 / hi, 24 / lo
    for lo_m, hi_m, days, (lo, hi) in FEEDS_PER_DAY:
        if not days and lo_m <= age_months < hi_m:
            return 24 / hi, 24 / lo
    # Day 15 is 0.49 months: below the first month row, so it is the newborn band, never the toddler one
    # (the same fallback as feedingNormFor in src/lib/science/feeding.ts).
    general = [r for r in FEEDS_PER_DAY if not r[2]]
    lo, hi = (general[0] if age_months < general[0][0] else general[-1])[3]
    return 24 / hi, 24 / lo


# A baby born early (Settings › Born early, src/lib/preterm.ts): the weeks at birth and the NICU stay, kept in
# the child's shared settings. Feeds are paced by the corrected age (from the due date, until two years);
# diapers by the real day of life (milk output follows the birth). In the NICU the nurses feed and change him,
# so the feed and wet-diaper reminders stay quiet.
TERM_DAYS = 280
BORN_EARLY_DAYS = (22 * 7, 37 * 7)
CORRECT_UNTIL_MONTHS = 24


def _ymd(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def age_basis(birth: date, today: date, child_settings: dict | None) -> dict:
    """{hold: 'nicu' | 'before-term' | None, age_days, age_months (corrected), real_days}."""
    cs = child_settings if isinstance(child_settings, dict) else {}
    born_at = cs.get("bornAtDays")
    if not (isinstance(born_at, int) and not isinstance(born_at, bool) and BORN_EARLY_DAYS[0] <= born_at < BORN_EARLY_DAYS[1]):
        born_at = None
    nicu = cs.get("nicu") if isinstance(cs.get("nicu"), dict) else {}
    since, home = _ymd(nicu.get("since")), _ymd(nicu.get("home"))
    in_nicu = bool(since and since <= today and (not home or today < home))
    due = birth + timedelta(days=TERM_DAYS - born_at) if born_at is not None else None
    hold = "nicu" if in_nicu else "before-term" if due and today < due else None
    months = (today.year - birth.year) * 12 + today.month - birth.month - (1 if today.day < birth.day else 0)
    origin = due if due and months < CORRECT_UNTIL_MONTHS else birth
    age_days = max(0, (today - origin).days)
    return {"hold": hold, "age_days": age_days, "age_months": age_days / 30.4375, "real_days": (today - birth).days}


def wet_threshold_hours(day_of_life: int) -> float:
    """Hours without a wet diaper that is clearly below typical: 1.5x the typical interval, at most a day."""
    wet_lo = next((lo for d0, d1, lo in WET_PER_DAY_LO if d0 <= day_of_life <= d1), WET_PER_DAY_LO[-1][2])
    return min(24.0, round(DIAPER_FACTOR * 24 / wet_lo * 2) / 2)  # to the half hour, so the title reads "7 h", not "7 h 12 min"


def cadence(starts: list[datetime], now: datetime, bounds_h: tuple[float, float]) -> tuple[timedelta | None, int]:
    """Median gap between consecutive starts in the last 24 h (48 h when that holds fewer than three),
    clamped to bounds. Returns (gap, number of starts used); gap is None below two starts."""
    starts = sorted(s for s in starts if s <= now)
    recent = [s for s in starts if s >= now - timedelta(hours=CADENCE_HOURS)]
    if len(recent) < 3:
        recent = [s for s in starts if s >= now - timedelta(hours=HISTORY_HOURS)]
    if len(recent) < 2:
        return None, len(recent)
    gaps = [(b - a).total_seconds() / 3600 for a, b in zip(recent, recent[1:]) if b > a]
    if not gaps:
        return None, len(recent)
    hours = min(max(statistics.median(gaps), bounds_h[0]), bounds_h[1])
    return timedelta(hours=hours), len(recent)


def parse_clock(text: str, fallback: str) -> tuple[int, int]:
    try:
        h, m = str(text).split(":")
        h, m = int(h), int(m)
        if 0 <= h < 24 and 0 <= m < 60:
            return h, m
    except (ValueError, AttributeError):
        pass
    h, m = fallback.split(":")
    return int(h), int(m)


def in_quiet_hours(local: datetime, start: str, end: str) -> bool:
    """Is this local time inside the quiet window? The window may wrap midnight; start == end disables it."""
    sh, sm = parse_clock(start, DEFAULTS["quietStart"])
    eh, em = parse_clock(end, DEFAULTS["quietEnd"])
    s, e, t = sh * 60 + sm, eh * 60 + em, local.hour * 60 + local.minute
    if s == e:
        return False
    return s <= t < e if s < e else t >= s or t < e


def quiet_end_after(local: datetime, start: str, end: str) -> datetime:
    """The first moment at or after `local` that is outside quiet hours."""
    if not in_quiet_hours(local, start, end):
        return local
    eh, em = parse_clock(end, DEFAULTS["quietEnd"])
    candidate = local.replace(hour=eh, minute=em, second=0, microsecond=0)
    return candidate if candidate > local else candidate + timedelta(days=1)


def clock(dt: datetime, tz) -> str:
    return dt.astimezone(tz).strftime("%-I:%M %p")


def stamp(dt: datetime, now: datetime, tz) -> str:
    """"1:00 PM" today, "4:30 PM yesterday" / "4:30 PM Monday" otherwise: a clock alone read as today
    (2026-10-25: a session logged two days late pinged as "Pumped 45 mL at 6:30 PM")."""
    word = day_word(dt, now, tz)
    return clock(dt, tz) if word == "today" else f"{clock(dt, tz)} {word}"


def ago(delta: timedelta) -> str:
    minutes = max(0, int(delta.total_seconds() // 60))
    h, m = divmod(minutes, 60)
    if h and m:
        return f"{h} h {m} min"
    if h:
        return f"{h} h"
    return f"{m} min"


def duration(seconds: float) -> str:
    return ago(timedelta(seconds=seconds))


def format_volume(amount: float, display: str) -> str:
    """`amount` in millilitres -> "60 mL" / "2.0 oz"."""
    if display == "oz":
        return f"{amount / ML_PER_OZ:.1f} oz"
    return f"{round(amount)} mL"


def to_ml(amount: float, storage: str) -> float:
    return amount * ML_PER_OZ if storage == "oz" else amount


def format_weight(grams: float, display: str) -> str:
    if display == "kg":
        return f"{grams / 1000:.2f} kg"
    lb, oz = divmod(grams / G_PER_OZ, 16)
    oz = round(oz)
    if oz == 16:
        lb, oz = lb + 1, 0
    return f"{int(lb)} lb {oz} oz"


def format_weight_delta(grams: float, display: str) -> str:
    word = "up" if grams >= 0 else "down"
    if display == "kg":
        return f"{word} {abs(round(grams))} g"
    return f"{word} {abs(grams) / G_PER_OZ:.1f} oz"


def day_word(dt: datetime, now: datetime, tz) -> str:
    d, n = dt.astimezone(tz).date(), now.astimezone(tz).date()
    days = (n - d).days
    if days == 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return dt.astimezone(tz).strftime("%A")
    return dt.astimezone(tz).strftime("%b %-d")


def parse_dt(value) -> datetime | None:
    if not isinstance(value, str) or len(value) < 16:
        return None
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def caregiver_of(entry: dict) -> str | None:
    for tag in entry.get("tags") or []:
        name = tag.get("name") if isinstance(tag, dict) else tag
        if isinstance(name, str) and name.startswith("caregiver:"):
            return name[len("caregiver:"):]
    return None


def clean_settings(data: dict) -> dict:
    """Only known keys, typed; unknown ones are dropped so a bad phone cannot grow the blob."""
    out: dict = {}
    for key, default in DEFAULTS.items():
        if key not in data:
            continue
        value = data[key]
        if isinstance(default, bool):
            out[key] = bool(value)
        elif key == "pumpEveryMinutes":
            out[key] = int(value) if isinstance(value, (int, float)) and 30 <= value <= 720 else None
        elif key in ("summaryAt", "quietStart", "quietEnd"):
            h, m = parse_clock(value, default)
            out[key] = f"{h:02d}:{m:02d}"
        elif key == "units":
            if isinstance(value, dict):
                vol = value.get("volume") if value.get("volume") in ("ml", "oz") else None
                wt = value.get("weight") if value.get("weight") in ("lb", "kg") else None
                out[key] = {"volume": vol or "ml", "weight": wt or "lb"} if (vol or wt) else None
            else:
                out[key] = None
    return out


# --------------------------------------------------------------------------- scheduler



def _utc_text(when: datetime) -> str:
    """A moment in the form milk.py stores `expires_at` in, so the two compare as text in SQL."""
    return when.astimezone(timezone.utc).isoformat(timespec="seconds")

class Nudges:
    def __init__(self, store, babybuddy_url: str, host_header: str | None = None, data_dir: str | None = None, tz=None):
        self.store = store
        store.conn.executescript(SCHEMA)
        self._migrate()
        self.bb = hatch_mod.BabyBuddy(babybuddy_url, host_header)
        self.secrets = hatch_mod.Secrets(os.path.join(data_dir or os.path.dirname(os.path.abspath(store.path)), "nudges.json"))
        self._auto_tz = None if tz else household_zone(store)
        self.tz = tz or self._auto_tz
        self.last_run: str | None = None
        self.problem: dict | None = None
        self.status_notes: dict[int, dict] = {}  # child -> {kind: {"at": iso|None, "note": str, ...}}
        self.caught_up: dict[int, int] = {}  # child -> entries the last poll learned quietly after a gap
        self._lock = threading.Lock()
        self._wake, self._stop = threading.Event(), threading.Event()
        self._thread = threading.Thread(target=self._loop, name="bramble-nudges", daemon=True)

    def _migrate(self) -> None:
        have = {r["name"] for r in self.store.q("PRAGMA table_info(reminders)")}
        for col, typ in ADDED_COLUMNS:
            if col not in have:
                self.store.x(f"ALTER TABLE reminders ADD COLUMN {col} {typ}")
        # Every poll asks "was this anchor already planned/sent?" per kind and per entry; after the columns exist.
        self.store.x("CREATE INDEX IF NOT EXISTS reminders_anchor ON reminders (child, tag, anchor)")

    # ---- thread
    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def trigger(self) -> None:
        """Settings changed or the app just logged something: recompute now rather than at the next poll."""
        if self._thread.is_alive():
            self._wake.set()
        else:
            self.run_once()

    def _loop(self) -> None:
        wait = FIRST_POLL_SECONDS
        while not self._stop.is_set():
            self._wake.wait(wait)
            self._wake.clear()
            wait = POLL_SECONDS
            if self._stop.is_set():
                break
            try:
                self.run_once()
            except Exception:  # pragma: no cover - never let the poll thread die
                log.exception("nudge poll failed")
                try:
                    self._drop_predictions()
                except Exception:
                    pass

    # ---- settings + token
    def arm(self, token: str | None, user_id: int | None) -> None:
        """Remember the caller's Baby Buddy token so the poll can read what was logged."""
        if token and self.secrets.read().get("bb_token") != token:
            self.secrets.update(bb_token=token, user_id=str(user_id or ""))
            self.problem = None

    def armed(self) -> bool:
        return bool(self.secrets.read().get("bb_token"))

    def settings(self, child: int) -> dict:
        rows = self.store.q("SELECT blob FROM nudge_settings WHERE child=?", (child,))
        saved = json.loads(rows[0]["blob"]) if rows else {}
        return {**DEFAULTS, **clean_settings(saved if isinstance(saved, dict) else {})}

    def save_settings(self, child: int, data: dict) -> dict:
        merged = {**self.settings(child), **clean_settings(data)}
        self.store.x(
            "INSERT INTO nudge_settings (child, blob, updated) VALUES (?,?,?) ON CONFLICT(child) DO UPDATE SET blob=excluded.blob, updated=excluded.updated",
            (child, json.dumps(merged), datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        return merged

    def child_settings(self, child: int) -> dict:
        """The child's shared app settings (the companion's settings table), {} when unreadable."""
        rows = self.store.q("SELECT blob FROM settings WHERE child=?", (child,))
        try:
            blob = json.loads(rows[0]["blob"]) if rows else {}
        except ValueError:
            return {}
        return blob if isinstance(blob, dict) else {}

    def units(self, child: int, settings: dict | None = None) -> tuple[dict, dict]:
        """(storage units Baby Buddy's numbers are in, display units for the push text)."""
        rows = self.store.q("SELECT blob FROM settings WHERE child=?", (child,))
        storage = {"volume": "ml", "weight": "lb"}
        try:
            storage = {**storage, **{k: v for k, v in (json.loads(rows[0]["blob"]).get("storageUnits") or {}).items() if k in storage}} if rows else storage
        except (ValueError, AttributeError):
            pass
        display = (settings or self.settings(child)).get("units") or storage
        return storage, {"volume": display.get("volume", storage["volume"]), "weight": display.get("weight", storage["weight"])}

    # ---- http (/nudges/<child>, /nudges/<child>/run)
    def http(self, method: str, parts: list[str], data: dict, user_id: int, token: str | None):
        if len(parts) < 2:
            return 404, {"detail": "Not found."}
        child = int(parts[1])
        self.arm(token, user_id)
        if len(parts) == 2 and method == "GET":
            # The first open on a fresh server computes inline so the sheet never shows an empty plan;
            # after that the poll thread is woken and the sheet's next refresh picks it up.
            if self.last_run is None:
                self.run_once()
            else:
                self.trigger()
            return 200, self.status(child)
        if len(parts) == 2 and method == "PUT":
            self.save_settings(child, data)
            self.run_once()  # inline, so the answer already reflects the change
            return 200, self.status(child)
        if len(parts) == 3 and parts[2] == "run" and method == "POST":
            self.run_once()
            return 200, self.status(child)
        return 404, {"detail": "Not found."}

    def status(self, child: int) -> dict:
        settings = self.settings(child)
        return {
            "settings": settings,
            "armed": self.armed(),
            "problem": self.problem,
            "lastRun": self.last_run,
            "subscriptions": self.store.q("SELECT COUNT(*) AS n FROM subscriptions")[0]["n"],
            "next": self.status_notes.get(child, {}),
            "quiet": f"{self._clock_text(settings['quietStart'])} to {self._clock_text(settings['quietEnd'])}",
        }

    @staticmethod
    def _clock_text(hhmm: str) -> str:
        h, m = parse_clock(hhmm, "00:00")
        return datetime(2000, 1, 1, h, m).strftime("%-I:%M %p")

    # ---- the poll
    def _refresh_zone(self) -> None:
        """The household's zone, read on every run: set from a phone in Settings, else the server's (a fixed-offset
        fallback follows the clock change this way). A zone given to the constructor (tests) stays."""
        if self.tz is self._auto_tz:
            self._auto_tz = self.tz = household_zone(self.store)

    def run_once(self, now: datetime | None = None) -> dict:
        """Recompute every child's nudges from fresh Baby Buddy data. Returns {child: notes}."""
        with self._lock:
            now = now or datetime.now(timezone.utc)
            self._refresh_zone()
            token = self.secrets.read().get("bb_token")
            if not token:
                self.problem = {"code": "needs_login", "message": PROBLEMS["needs_login"]}
                self._drop_predictions()
                return {}
            try:
                children = self.bb.list(token, "/api/children/")
                for child in children:
                    self.status_notes[int(child["id"])] = self._plan_child(child, token, now)
                self.problem = None
            except hatch_mod.Halt as exc:
                if exc.code == "babybuddy_auth":
                    self.secrets.update(bb_token=None)
                    self.problem = {"code": "needs_login", "message": PROBLEMS["needs_login"]}
                else:
                    self.problem = {"code": "babybuddy", "message": PROBLEMS["babybuddy"]}
                self._drop_predictions()
                log.warning("nudge poll stopped: %s (%s)", exc.code, exc.detail)
            self.last_run = now.isoformat(timespec="seconds")
            return dict(self.status_notes)

    def _plan_child(self, child: dict, token: str, now: datetime) -> dict:
        cid = int(child["id"])
        settings = self.settings(cid)
        notes: dict = {}
        today = now.astimezone(self.tz).date()  # age counts in the household's days, not UTC ones
        try:
            birth = date.fromisoformat(str(child.get("birth_date"))[:10]) if child.get("birth_date") else None
        except ValueError:
            birth = None
        planned = [f"nudge:{k}" for k in ("feed", "pump", "diaper", "summary", "supply")]
        if not birth or birth > today:
            self._clear(cid, planned)
            self._ledger(cid, *self._recent(cid, token, now), now)  # kept, so the first poll after the birth is no burst
            return {k: {"at": None, "note": "Waiting for the birth date"} for k in KINDS}
        if not self.store.q("SELECT 1 FROM subscriptions LIMIT 1"):
            self._clear(cid, planned)
            self._ledger(cid, *self._recent(cid, token, now), now)  # kept, so a phone subscribing again gets no burst
            return {k: {"at": None, "note": "No phone has notifications on"} for k in KINDS}
        storage, display = self.units(cid, settings)
        feedings, pumping, changes, sleep = self._recent(cid, token, now)
        # The supply watch looks two weeks back; only read that far when it is on.
        since_supply = (now - timedelta(days=SUPPLY_DAYS + 1)).isoformat(timespec="seconds")
        pumping_weeks = self.bb.list(token, "/api/pumping/", child=cid, start_min=since_supply) if settings["supply"] else []
        age = age_basis(birth, today, self.child_settings(cid))
        name = child.get("first_name") or "Baby"
        ctx = dict(cid=cid, settings=settings, now=now, storage=storage, display=display, name=name, **age)
        notes["feed"] = self._feed(ctx, feedings)
        notes["pump"] = self._pump(ctx, pumping)
        notes["diaper"] = self._diaper(ctx, changes)
        notes["summary"] = self._summary(ctx, feedings, changes, sleep, pumping)
        notes["weight"] = {"at": None, "note": "When a Hatch weighing lands" if settings["weight"] else "Off"}
        notes["supply"] = self._supply(ctx, pumping_weeks)
        notes["activity"] = self._activity(ctx, *self._ledger(cid, feedings, pumping, changes, sleep, now))
        return notes

    def _recent(self, cid: int, token: str, now: datetime) -> tuple[list, list, list, list]:
        """The last HISTORY_HOURS of feedings (no solids), pumping, changes and sleep from Baby Buddy."""
        since = (now - timedelta(hours=HISTORY_HOURS)).isoformat(timespec="seconds")
        feedings = [f for f in self.bb.list(token, "/api/feedings/", child=cid, start_min=since) if f.get("type") != "solid food"]
        pumping = self.bb.list(token, "/api/pumping/", child=cid, start_min=since)
        changes = self.bb.list(token, "/api/changes/", child=cid, date_min=since)
        sleep = self.bb.list(token, "/api/sleep/", child=cid, start_min=since)
        return feedings, pumping, changes, sleep

    def _ledger(self, cid: int, feedings: list[dict], pumping: list[dict], changes: list[dict], sleep: list[dict], now: datetime) -> tuple[list, bool]:
        """Rewrite the seen-entries ledger to this window. Returns (entries new since the last poll, whether this
        child had been read before). Kept every poll whatever the switches, so turning pings on, a phone
        subscribing again or the birth date arriving never bursts."""
        current = [("feeding", f) for f in feedings] + [("pumping", p) for p in pumping] + [("change", c) for c in changes] + [("sleep", sl) for sl in sleep]
        current = [(k, e) for k, e in current if isinstance(e.get("id"), int) and not isinstance(e.get("id"), bool)]
        rows = self.store.q("SELECT kind, entry_id FROM nudge_seen WHERE child=?", (cid,))
        learned = bool(rows)  # the marker, or a ledger written before the marker existed
        seen = {(r["kind"], r["entry_id"]) for r in rows if r["kind"] != LEARNED}
        new = [(k, e) for k, e in current if (k, e["id"]) not in seen]
        # The marker holds when the ledger was last written (0 before 1.48.1). After a gap (Baby Buddy down, the
        # token lost, the companion stopped) everything logged meanwhile is caught up quietly instead of pinging
        # in one burst, old entries among them (sweep 2026-10-27).
        written = max([r["entry_id"] for r in rows if r["kind"] == LEARNED] or [0])
        if learned and now.timestamp() - written > LEDGER_GAP.total_seconds():
            self.caught_up[cid] = len(new)
            new = []
        with self.store.atomic():
            self.store.x("DELETE FROM nudge_seen WHERE child=?", (cid,))
            self.store.conn.executemany(
                "INSERT OR IGNORE INTO nudge_seen (child, kind, entry_id) VALUES (?,?,?)",
                [(cid, LEARNED, int(now.timestamp()))] + [(cid, k, e["id"]) for k, e in current],
            )
        return new, learned

    # ---- each nudge
    def _feed(self, ctx: dict, feedings: list[dict]) -> dict:
        s, now, tag = ctx["settings"], ctx["now"], "nudge:feed"
        if not s["feed"]:
            return self._off(ctx["cid"], tag)
        if ctx["hold"] == "nicu":
            return self._none(ctx["cid"], tag, "In the NICU · quiet until home")
        rows = [(parse_dt(f.get("start")), f) for f in feedings]
        rows = sorted(((t, f) for t, f in rows if t and t <= now), key=lambda r: r[0])
        if not rows:
            return self._none(ctx["cid"], tag, "Waiting for a feed to be logged")
        gap, n = cadence([t for t, _ in rows], now, feed_gap_bounds(ctx["age_months"], ctx["age_days"]))
        if gap is None:
            return self._none(ctx["cid"], tag, "Waiting for two feeds within a day")
        last_t, last = rows[-1]
        at = last_t + gap
        bottle = last.get("method") == "bottle"
        amount = last.get("amount")
        what = "bottle" if bottle else "nursing"
        if bottle and isinstance(amount, (int, float)):
            what += f" {format_volume(to_ml(amount, ctx['storage']['volume']), ctx['display']['volume'])}"
        elif not bottle:
            side = {"left breast": "left side", "right breast": "right side", "both breasts": "both sides"}.get(last.get("method") or "")
            what += f" ({side})" if side else ""
        body = f"Last {what} at {clock(last_t, self.tz)}, {ago(now - last_t)} ago."
        first = self._use_first(ctx, now)
        if first:
            body += " " + first
        title = f"{ctx['name']} usually eats about now"
        url = "/?log=bottle" if bottle else "/?log=nursing"
        note = f"Every {ago(gap)} lately, from {n} feeds"
        return self._plan(ctx, tag, str(last.get("id")), at, title, body, url, None, note, quiet=True)

    def _use_first(self, ctx: dict, now: datetime) -> str | None:
        """What to grab for the feed nudge: a premade bottle made ahead (lowest spot first), else the stash bag
        to open first when one runs out within the day."""
        try:
            ready = self.store.q(
                "SELECT spot, remaining_ml, expires_at FROM milk_bags WHERE child=? AND status='stored' AND kind='bottle' AND remaining_ml>=1 AND expires_at>? ORDER BY spot LIMIT 1",
                (ctx["cid"], _utc_text(now)),
            )
        except Exception:  # an older milk table without premade bottles
            ready = []
        if ready:
            expires = parse_dt(ready[0]["expires_at"])
            if expires and expires > now:
                return f"Premade bottle {ready[0]['spot']} is ready: {format_volume(ready[0]['remaining_ml'], ctx['display']['volume'])}."
        try:
            rows = self.store.q(
                "SELECT code, remaining_ml, expires_at FROM milk_bags WHERE child=? AND status='stored' AND remaining_ml>=1 AND COALESCE(kind, 'bag')<>'bottle' AND expires_at>? ORDER BY expires_at LIMIT 1",
                (ctx["cid"], _utc_text(now)),
            )
        except Exception:  # milk tables absent in a stripped-down companion
            return None
        if not rows:
            return None
        expires = parse_dt(rows[0]["expires_at"])
        if not expires or expires <= now or expires > now + timedelta(hours=24):
            return None
        return f"Use bag {rows[0]['code']} first: {format_volume(rows[0]['remaining_ml'], ctx['display']['volume'])}, good until {clock(expires, self.tz)}."

    def _pump(self, ctx: dict, pumping: list[dict]) -> dict:
        s, now, tag = ctx["settings"], ctx["now"], "nudge:pump"
        if not s["pump"]:
            return self._off(ctx["cid"], tag)
        rows = sorted(((parse_dt(p.get("start")), p) for p in pumping if parse_dt(p.get("start")) and parse_dt(p.get("start")) <= now), key=lambda r: r[0])
        if not rows:
            return self._none(ctx["cid"], tag, "Waiting for a pumping session to be logged")
        fixed = s.get("pumpEveryMinutes")
        if fixed:
            gap, n, how = timedelta(minutes=int(fixed)), len(rows), f"Every {ago(timedelta(minutes=int(fixed)))}, set in Settings"
        else:
            gap, n = cadence([t for t, _ in rows], now, PUMP_BOUNDS_H)
            if gap is None:
                return self._none(ctx["cid"], tag, "Waiting for two sessions within a day")
            how = f"Every {ago(gap)} lately, from {n} sessions"
        last_t, last = rows[-1]
        amount = last.get("amount")
        vol = f", {format_volume(to_ml(amount, ctx['storage']['volume']), ctx['display']['volume'])}" if isinstance(amount, (int, float)) else ""
        stash = self.store.q("SELECT COUNT(*) AS n, COALESCE(SUM(remaining_ml),0) AS ml FROM milk_bags WHERE child=? AND status='stored' AND remaining_ml>=1 AND expires_at>?", (ctx["cid"], _utc_text(ctx["now"])))[0]
        stash_text = f" Stash: {stash['n']} bag{'s' if stash['n'] != 1 else ''}, {format_volume(stash['ml'], ctx['display']['volume'])}." if stash["n"] else ""
        body = f"Last session {stamp(last_t, now, self.tz)}{vol}.{stash_text}"
        user_id, who = self._pumper(rows)
        note = f"{how} · to {who}"
        return self._plan(ctx, tag, str(last.get("id")), last_t + gap, "About time to pump", body, "/?log=pumping", user_id, note, quiet=True)

    def _pumper(self, rows: list[tuple[datetime, dict]]) -> tuple[int | None, str]:
        """Whose phone gets the pump nudge: the caregiver on the pumping entries, else the Mom, else everyone."""
        counts: dict[str, int] = {}
        for _, p in rows:
            who = caregiver_of(p)
            if who:
                counts[who] = counts.get(who, 0) + 1
        people = {r["username"]: r for r in self.store.q("SELECT username, role, name, user_id FROM people WHERE active=1")} if self._has_table("people") else {}
        candidates = [u for u, _ in sorted(counts.items(), key=lambda kv: -kv[1])] + [u for u, r in people.items() if r["role"] == "mom"]
        for username in candidates:
            person = people.get(username)
            if not person or person["user_id"] is None:
                continue
            label = {"mom": "Mom", "dad": "Dad", "grandma": "Grandma", "grandpa": "Grandpa", "nanny": "Nanny"}.get(person["role"] or "", person["name"] or username)
            return int(person["user_id"]), f"{label}'s phone"
        return None, "every phone"

    def _activity(self, ctx: dict, new: list[tuple[str, dict]], learned: bool) -> dict:
        """Ping the other caregivers' phones about entries that are new since the last poll (from _ledger)."""
        s, now, tag, cid = ctx["settings"], ctx["now"], "nudge:activity", ctx["cid"]
        caught_up = self.caught_up.pop(cid, None) is not None  # this poll's own: never carried to the next
        if not s["activity"]:
            return {"at": None, "note": "Off"}
        if not learned:
            return {"at": None, "note": "Watching from now: the other phones hear about what is logged"}
        if caught_up:
            return {"at": None, "note": "Back after a gap: what was logged meanwhile was not announced"}
        people = {r["username"]: r for r in self.store.q("SELECT username, role, name, user_id FROM people WHERE active=1")} if self._has_table("people") else {}
        phones = sorted({int(r["user_id"]) for r in self.store.q("SELECT DISTINCT user_id FROM subscriptions WHERE user_id IS NOT NULL")})
        local_now = now.astimezone(self.tz)
        quiet = in_quiet_hours(local_now, s["quietStart"], s["quietEnd"])
        sent, skipped = 0, 0
        for kind, entry in sorted(new, key=lambda ke: parse_dt(ke[1].get("start") or ke[1].get("time")) or now):
            who = caregiver_of(entry)
            person = people.get(who or "")
            if not who or not person or person["user_id"] is None:
                skipped += 1  # logged from Baby Buddy itself, or by a login nobody has set up in People: no sender to name
                continue
            targets = [u for u in phones if u != int(person["user_id"])]
            if not targets or quiet:
                skipped += 1
                continue
            name = person["name"] or {"mom": "Mom", "dad": "Dad", "grandma": "Grandma", "grandpa": "Grandpa", "nanny": "Nanny"}.get(person["role"] or "", who)
            title, body, url = self._activity_text(ctx, name, kind, entry)
            for user_id in targets:
                anchor = f"{kind}:{entry['id']}:{user_id}"
                if self.store.q("SELECT 1 FROM reminders WHERE child=? AND tag=? AND anchor=? LIMIT 1", (cid, tag, anchor)):
                    continue
                self.store.x(
                    "INSERT INTO reminders (child, at, title, body, tag, source, sent, created, url, user_id, anchor) VALUES (?,?,?,?,?,?,0,?,?,?,?)",
                    (cid, now.astimezone(timezone.utc).isoformat(timespec="seconds"), title, body, tag, SOURCE, now.isoformat(timespec="seconds"), url, user_id, anchor),
                )
            sent += 1
        if len(phones) < 2:
            return {"at": None, "note": "Only one phone has notifications on, so there is nobody else to tell"}
        if quiet and new:
            return {"at": None, "note": "Quiet hours · nothing goes out until they end"}
        note = f"To the other phones when someone logs something · {sent} new just now" if sent else "To the other phones when someone logs something"
        if skipped:
            note += f" · {skipped} without a known caregiver"
        return {"at": None, "note": note}

    def _activity_text(self, ctx: dict, name: str, kind: str, entry: dict) -> tuple[str, str, str]:
        vol, storage = ctx["display"]["volume"], ctx["storage"]["volume"]
        when = parse_dt(entry.get("start") or entry.get("time"))
        at = f" at {stamp(when, ctx['now'], self.tz)}" if when else ""
        if kind == "feeding":
            if entry.get("method") == "bottle":
                amount = entry.get("amount")
                what = f"{format_volume(to_ml(amount, storage), vol)} " if isinstance(amount, (int, float)) and not isinstance(amount, bool) else ""
                kind_text = str(entry.get("type") or "bottle")
                return f"{name} logged a bottle", f"{what}{kind_text}{at}." if what else f"{kind_text[:1].upper()}{kind_text[1:]}{at}.", "/"
            side = {"left breast": ", left side", "right breast": ", right side", "both breasts": ", both sides"}.get(entry.get("method") or "", "")
            end = parse_dt(entry.get("end"))
            mins = f", {ago(end - when)}" if when and end and end > when else ""
            return f"{name} logged nursing", f"Nursing{side}{mins}{at}.", "/"
        if kind == "pumping":
            amount = entry.get("amount")
            what = f" {format_volume(to_ml(amount, storage), vol)}" if isinstance(amount, (int, float)) and not isinstance(amount, bool) else ""
            return f"{name} logged pumping", f"Pumped{what}{at}.", "/"
        if kind == "change":
            parts = [w for w, on in (("wet", entry.get("wet")), ("dirty", entry.get("solid"))) if on]
            return f"{name} logged a diaper", f"{(' and '.join(parts) or 'Dry').capitalize()} diaper{at}.", "/"
        end = parse_dt(entry.get("end"))
        what = "a nap" if entry.get("nap") else "sleep"
        if when and end and end > when:
            return f"{name} logged {what}", f"{what.capitalize()} {clock(when, self.tz)}–{stamp(end, ctx['now'], self.tz)}, {ago(end - when)}.", "/"
        return f"{name} logged {what}", f"{what.capitalize()}{at}.", "/"

    def _supply(self, ctx: dict, pumping: list[dict]) -> dict:
        """Pumping is down: each of the last few full days under SUPPLY_DROP of the daily average before them."""
        s, now, tag, cid = ctx["settings"], ctx["now"], "nudge:supply", ctx["cid"]
        if not s["supply"]:
            return self._off(cid, tag)
        vol = ctx["display"]["volume"]
        per_day: dict = {}  # local date -> [ml, sessions]
        rows: list[tuple[datetime, dict]] = []
        for p in pumping:
            t, amount = parse_dt(p.get("start")), p.get("amount")
            if not t or t > now or isinstance(amount, bool) or not isinstance(amount, (int, float)):
                continue
            rows.append((t, p))
            day = per_day.setdefault(t.astimezone(self.tz).date(), [0.0, 0])
            day[0] += to_ml(amount, ctx["storage"]["volume"])
            day[1] += 1
        today = now.astimezone(self.tz).date()
        recent_days = [today - timedelta(days=i) for i in range(1, SUPPLY_RECENT_DAYS + 1)]
        base_days = [today - timedelta(days=i) for i in range(SUPPLY_RECENT_DAYS + 1, SUPPLY_DAYS + 1)]
        base = [per_day[d] for d in base_days if d in per_day]
        watching = f"Watching the last {SUPPLY_RECENT_DAYS} days against the {len(base_days)} before"
        if len(base) < SUPPLY_MIN_BASE_DAYS:
            return self._none(cid, tag, f"{watching} · {len(base)} of {len(base_days)} days logged so far, needs {SUPPLY_MIN_BASE_DAYS}")
        base_ml = sum(d[0] for d in base) / len(base)
        base_n = sum(d[1] for d in base) / len(base)
        recent = [per_day.get(d) for d in recent_days]
        if any(r is None for r in recent):
            return self._none(cid, tag, f"Usual {format_volume(base_ml, vol)} a day · waiting for {SUPPLY_RECENT_DAYS} logged days in a row")
        recent_ml = sum(r[0] for r in recent) / len(recent)
        recent_n = sum(r[1] for r in recent) / len(recent)
        if not all(r[0] < base_ml * SUPPLY_DROP for r in recent):
            return self._none(cid, tag, f"Holding up: {format_volume(recent_ml, vol)} a day lately, usual {format_volume(base_ml, vol)}")
        drop = round((1 - recent_ml / base_ml) * 100)
        per = lambda n: f"{n:.1f}".rstrip("0").rstrip(".")  # noqa: E731
        body = f"Last {SUPPLY_RECENT_DAYS} days {format_volume(recent_ml, vol)} a day, {drop}% under the {format_volume(base_ml, vol)} a day of the {len(base_days)} days before."
        if recent_n <= base_n * 0.85:
            body += f" Fewer sessions a day ({per(recent_n)} from {per(base_n)}) explain most of it."
        else:
            body += f" About as many sessions a day ({per(recent_n)}), so each one gives less."
        body += " Three days in a row is a trend, not a bad day."
        last = self.store.q("SELECT at FROM reminders WHERE child=? AND tag=? AND sent=1 ORDER BY at DESC LIMIT 1", (cid, tag))
        last_at = parse_dt(last[0]["at"]) if last else None
        if last_at and last_at > now - SUPPLY_REPEAT:
            self._clear(cid, [tag])
            return {"at": None, "note": f"Down {drop}% over the last {SUPPLY_RECENT_DAYS} days · sent {day_word(last_at, now, self.tz)}, again after {SUPPLY_REPEAT.days} days"}
        user_id, who = self._pumper(rows)
        note = f"Down {drop}% over the last {SUPPLY_RECENT_DAYS} days · to {who}"
        return self._plan(ctx, tag, recent_days[0].isoformat(), now, "Pumping is down this week", body, "/reports", user_id, note, quiet=True, defer=True)

    def _has_table(self, name: str) -> bool:
        return bool(self.store.q("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)))

    def _diaper(self, ctx: dict, changes: list[dict]) -> dict:
        s, now, tag = ctx["settings"], ctx["now"], "nudge:diaper"
        if not s["diaper"]:
            return self._off(ctx["cid"], tag)
        if ctx["hold"] == "nicu":
            return self._none(ctx["cid"], tag, "In the NICU · quiet until home")
        timed = sorted(((parse_dt(c.get("time")), c) for c in changes if parse_dt(c.get("time")) and parse_dt(c.get("time")) <= now), key=lambda r: r[0])
        if len(timed) < 3:
            return self._none(ctx["cid"], tag, "Waiting for diapers to be logged regularly")
        wet = [(t, c) for t, c in timed if c.get("wet")]
        if not wet:
            return self._none(ctx["cid"], tag, "Waiting for a wet diaper to be logged")
        hours = wet_threshold_hours(ctx["real_days"])
        last_t, last = wet[-1]
        title = f"No wet diaper in {ago(timedelta(hours=hours)).replace(' 0 min', '')}"
        wet_lo = next((lo for d0, d1, lo in WET_PER_DAY_LO if d0 <= ctx["real_days"] <= d1), 4)
        body = f"Last wet diaper at {clock(last_t, self.tz)} {day_word(last_t, now, self.tz)}. At this age {wet_lo} or more a day is typical; offer a feed and mention it to your pediatrician if it continues."
        note = f"After {ago(timedelta(hours=hours))} without one · ignores quiet hours"
        return self._plan(ctx, tag, str(last.get("id")), last_t + timedelta(hours=hours), title, body, "/?log=diaper", None, note, quiet=False, late_ok=True)

    def _summary(self, ctx: dict, feedings: list[dict], changes: list[dict], sleep: list[dict], pumping: list[dict]) -> dict:
        s, now, tag = ctx["settings"], ctx["now"], "nudge:summary"
        if not s["summary"]:
            return self._off(ctx["cid"], tag)
        local_now = now.astimezone(self.tz)
        h, m = parse_clock(s["summaryAt"], DEFAULTS["summaryAt"])
        at = local_now.replace(hour=h, minute=m, second=0, microsecond=0)
        if at < local_now - LATE_GRACE:
            at += timedelta(days=1)
        day_start = at.replace(hour=0, minute=0)
        day = at.date()
        in_day = lambda t: t is not None and day_start <= t.astimezone(self.tz) <= at  # noqa: E731
        feeds = [f for f in feedings if in_day(parse_dt(f.get("start")))]
        ml = sum(to_ml(f["amount"], ctx["storage"]["volume"]) for f in feeds if f.get("method") == "bottle" and isinstance(f.get("amount"), (int, float)))
        diapers = [c for c in changes if in_day(parse_dt(c.get("time")))]
        slept = 0.0
        for sl in sleep:
            st, en = parse_dt(sl.get("start")), parse_dt(sl.get("end"))
            if st and en:
                a, b = max(st, day_start.astimezone(timezone.utc)), min(en, at.astimezone(timezone.utc))
                slept += max(0.0, (b - a).total_seconds())
        pumps = [p for p in pumping if in_day(parse_dt(p.get("start")))]
        pumped = sum(to_ml(p["amount"], ctx["storage"]["volume"]) for p in pumps if isinstance(p.get("amount"), (int, float)))
        if not (feeds or diapers or slept or pumps):
            return self._none(ctx["cid"], tag, f"Every day at {self._clock_text(s['summaryAt'])} · nothing logged yet for {day.strftime('%A')}")
        vol = ctx["display"]["volume"]
        lines = [f"Feeds: {len(feeds)}" + (f", {format_volume(ml, vol)} by bottle" if ml else "")]
        lines.append(f"Diapers: {len(diapers)} ({sum(1 for c in diapers if c.get('wet'))} wet, {sum(1 for c in diapers if c.get('solid'))} dirty)")
        if slept:
            lines.append(f"Sleep: {duration(slept)}")
        if pumps:
            lines.append(f"Pumping: {len(pumps)} session{'s' if len(pumps) != 1 else ''}" + (f", {format_volume(pumped, vol)}" if pumped else ""))
        stash = self.store.q("SELECT COUNT(*) AS n, COALESCE(SUM(remaining_ml),0) AS ml FROM milk_bags WHERE child=? AND status='stored' AND remaining_ml>=1 AND expires_at>?", (ctx["cid"], _utc_text(ctx["now"])))[0]
        if stash["n"]:
            lines.append(f"Stash: {stash['n']} bag{'s' if stash['n'] != 1 else ''}, {format_volume(stash['ml'], vol)}")
        title = f"{ctx['name']}'s day"
        note = f"Every day at {self._clock_text(s['summaryAt'])}"
        return self._plan(ctx, tag, day.isoformat(), at.astimezone(timezone.utc), title, "\n".join(lines), "/", None, note, quiet=True)

    # ---- Hatch weight hook (called from hatch.py after a weighing is written to Baby Buddy)
    def weight_imported(self, child: int, hatch_id: int, grams: float, measured_at: str, backlog: bool) -> None:
        try:
            self._refresh_zone()  # called from the Hatch thread, maybe before the next poll
            if backlog:
                return
            settings = self.settings(child)
            if not settings["weight"]:
                return
            now = datetime.now(timezone.utc)
            _, display = self.units(child, settings)
            measured = self._wall_clock(measured_at) or now
            prev = self.store.q(
                "SELECT grams, measured_at FROM hatch_weights WHERE child=? AND status IN ('imported','matched') AND hatch_id!=? AND measured_at<? ORDER BY measured_at DESC LIMIT 1",
                (child, hatch_id, measured_at),
            )
            body = f"{format_weight(grams, display['weight'])} at {clock(measured, self.tz)} {day_word(measured, now, self.tz)}"
            if prev:
                prev_t = self._wall_clock(prev[0]["measured_at"])
                body += f", {format_weight_delta(grams - prev[0]['grams'], display['weight'])} since {day_word(prev_t, now, self.tz) if prev_t else 'last time'}"
            body += "."
            ctx = dict(cid=child, settings=settings, now=now)
            self._plan(ctx, "nudge:weight", str(hatch_id), now, "New weight from the Hatch", body, "/child", None, "", quiet=True, defer=True)
        except Exception:  # a push must never break the import
            log.exception("weight nudge failed")

    def _wall_clock(self, value: str) -> datetime | None:
        """The Hatch ledger keeps the member's wall-clock time without a zone (hatch_api.parse_time)."""
        try:
            d = datetime.fromisoformat(str(value))
        except ValueError:
            return None
        return d if d.tzinfo else d.replace(tzinfo=self.tz)

    # ---- reconciliation
    def _drop_predictions(self) -> None:
        """The poll cannot read Baby Buddy: take back the planned pushes that predict from what was logged (feed or
        pump due, the evening summary, pumping down). Kept, they went out hours later naming a "last session" long
        superseded (sweep 2026-10-27); the next good poll plans them again. The wet-diaper alert stays: it errs on
        the side of the baby."""
        tags = [f"nudge:{k}" for k in ("feed", "pump", "summary", "supply")]
        self.store.x(f"DELETE FROM reminders WHERE source=? AND sent=0 AND tag IN ({','.join('?' * len(tags))})", (SOURCE, *tags))

    def _clear(self, child: int, tags: list[str]) -> None:
        for tag in tags:
            self.store.x("DELETE FROM reminders WHERE child=? AND tag=? AND sent=0", (child, tag))

    def _off(self, child: int, tag: str) -> dict:
        self._clear(child, [tag])
        return {"at": None, "note": "Off"}

    def _none(self, child: int, tag: str, note: str) -> dict:
        self._clear(child, [tag])
        return {"at": None, "note": note}

    def _plan(self, ctx: dict, tag: str, anchor: str, at: datetime, title: str, body: str, url: str, user_id: int | None, note: str, quiet: bool, late_ok: bool = False, defer: bool = False) -> dict:
        """Replace the unsent row for this kind with one moment, unless that moment already went out."""
        cid, s, now = ctx["cid"], ctx["settings"], ctx["now"]
        # Baby Buddy answers in its own zone ("…-04:00"); the delivery loop compares `at` as a string against
        # UTC, so the moment is stored in UTC like every other reminder (otherwise it fires hours early).
        at = at.astimezone(timezone.utc)
        with self.store.atomic():
            self._clear(cid, [tag])
            if self.store.q("SELECT 1 FROM reminders WHERE child=? AND tag=? AND anchor=? AND sent=1 LIMIT 1", (cid, tag, anchor)):
                return {"at": None, "note": f"Sent for the last one · {note}".strip(" ·")}
            if at < now - LATE_GRACE and not late_ok:
                return {"at": None, "note": f"Missed the last moment · {note}".strip(" ·")}
            at = max(at, now)
            if quiet and in_quiet_hours(at.astimezone(self.tz), s["quietStart"], s["quietEnd"]):
                if not defer:
                    return {"at": None, "note": f"Quiet hours · {note}".strip(" ·")}
                at = quiet_end_after(at.astimezone(self.tz), s["quietStart"], s["quietEnd"]).astimezone(timezone.utc)
            self.store.x(
                "INSERT INTO reminders (child, at, title, body, tag, source, sent, created, url, user_id, anchor) VALUES (?,?,?,?,?,?,0,?,?,?,?)",
                (cid, at.isoformat(timespec="seconds"), title, body, tag, SOURCE, now.isoformat(timespec="seconds"), url, user_id, anchor),
            )
        return {"at": at.isoformat(timespec="seconds"), "note": note, "title": title, "body": body}

    # ---- delivery routing (called by the delivery thread for every reminder it is about to send)
    def route(self, rem: dict) -> tuple[str, int | None, bool]:
        """(url the tap opens, user the push is for or None for everyone, skip)."""
        tag, source = rem.get("tag") or "", rem.get("source") or ""
        child = rem.get("child")
        if source == SOURCE:
            kind = tag.split(":")[1] if ":" in tag else ""
            on = self.settings(int(child)).get(kind, True) if child is not None and kind in KINDS else True
            return rem.get("url") or "/", rem.get("user_id"), not on
        if source == "milk":
            on = self.settings(int(child)).get("milk", True) if child is not None else True
            return "/milk", None, not on
        if tag.startswith("reminder:") and tag[len("reminder:"):] in LOG_KINDS:
            return f"/?log={tag[len('reminder:'):]}", None, False
        return rem.get("url") or "/", rem.get("user_id"), False


LOG_KINDS = ("sleep", "nursing", "bottle", "solids", "diaper", "potty", "pumping", "milestones", "medicine", "activity", "tummy", "growth", "temperature", "note")
