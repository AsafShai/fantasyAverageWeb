import asyncio
import io
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pdfplumber

from app.models.injury_models import InjuryRecord, InjuryNotification

logger = logging.getLogger(__name__)

NY_TZ = ZoneInfo("America/New_York")

# In-memory state
injury_store: dict[str, InjuryRecord] = {}
sse_subscribers: list[asyncio.Queue] = []
notification_history: list[InjuryNotification] = []
MAX_NOTIFICATION_HISTORY = 150


def get_utc_now_str() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_current_pdf_url() -> str:
    """Build the URL for the most recent 15-minute interval in NY time."""
    now_ny = datetime.now(NY_TZ)
    floored_minute = (now_ny.minute // 15) * 15
    rounded = now_ny.replace(minute=floored_minute, second=0, microsecond=0)
    date_str = rounded.strftime("%Y-%m-%d")
    time_str = rounded.strftime("%I_%M%p")  # e.g. "03_30AM"
    return f"https://ak-static.cms.nba.com/referee/injury/Injury-Report_{date_str}_{time_str}.pdf"


def compute_next_trigger() -> datetime:
    """Return the next :00:15, :15:15, :30:15, or :45:15 moment in NY time."""
    now_ny = datetime.now(NY_TZ)
    for mark in [0, 15, 30, 45]:
        candidate = now_ny.replace(minute=mark, second=15, microsecond=0)
        if candidate > now_ny:
            return candidate
    # All marks in this hour have passed — go to :00:15 of next hour
    return (now_ny + timedelta(hours=1)).replace(minute=0, second=15, microsecond=0)


async def fetch_pdf_bytes(url: str, max_retries: int = 3) -> bytes | None:
    """Fetch PDF with fixed retry delays. Returns None if unavailable after all retries."""
    delays = [10, 20]
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, follow_redirects=True)
                if response.status_code == 200:
                    return response.content
                if response.status_code == 404:
                    logger.warning(f"Injury PDF not found (404): {url}")
                    return None
                logger.warning(f"Injury PDF fetch attempt {attempt} got HTTP {response.status_code}")
        except httpx.HTTPError as e:
            logger.warning(f"Injury PDF fetch attempt {attempt} failed: {e}")

        if attempt < max_retries:
            await asyncio.sleep(delays[attempt - 1])

    logger.error(f"Could not fetch injury PDF after {max_retries} attempts: {url}")
    return None


def parse_injury_pdf(pdf_bytes: bytes) -> list[InjuryRecord]:
    """Extract injury records from NBA injury report PDF using word positions."""
    COL_GAME_DATE = (10, 110)
    COL_GAME_TIME = (110, 190)
    COL_MATCHUP   = (190, 255)
    COL_TEAM      = (255, 415)
    COL_PLAYER    = (415, 575)
    COL_STATUS    = (575, 650)
    COL_REASON    = (650, 9999)

    HEADER_WORDS = {"gamedate", "gametime", "matchup", "team", "playername", "currentstatus", "reason"}
    TITLE_WORDS = {"injury", "report:"}

    import re
    PAGE_FOOTER_RE = re.compile(r"^page\d+of\d+$", re.IGNORECASE)
    TIME_RE = re.compile(r'(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)', re.IGNORECASE)
    DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})')

    def parse_game_time_utc(date_str: str, time_str: str) -> str | None:
        """Convert ET game date+time strings from PDF to UTC ISO string."""
        date_m = DATE_RE.search(date_str)
        time_m = TIME_RE.search(time_str)
        if not date_m or not time_m:
            return None
        month, day, year = int(date_m.group(1)), int(date_m.group(2)), int(date_m.group(3))
        hour, minute = int(time_m.group(1)), int(time_m.group(2))
        ampm = time_m.group(3).upper()
        if ampm == "PM" and hour != 12:
            hour += 12
        elif ampm == "AM" and hour == 12:
            hour = 0
        try:
            dt_et = datetime(year, month, day, hour, minute, tzinfo=NY_TZ)
            return dt_et.astimezone(timezone.utc).isoformat(timespec="seconds")
        except (ValueError, OverflowError):
            return None
    VALID_STATUSES = {"Out", "Questionable", "Doubtful", "Probable", "Available"}
    CAMEL_SPLIT_RE = re.compile(r"(?<=[a-z])(?=[A-Z])(?<!Mc)(?<!Mac)|(?<=[A-Z])(?=[A-Z][a-z])")

    def split_camel(s: str) -> str:
        return CAMEL_SPLIT_RE.sub(" ", s)

    SUFFIX_RE = re.compile(r"(Jr\.|Sr\.|II|III|IV|V)$")
    INJURY_ILLNESS_RE = re.compile(r"^(?:Injury/Illness|Illness)-(.+)$")

    WORD_BOUNDARY_RE = re.compile(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[a-zA-Z])(?=\d)|(?<=\d)(?=[A-Z][a-z])")

    PREP_RE = re.compile(r"(?<=[a-z]{3})(to|of|at|for|the|and|or|with|from|by)(?=[A-Z])")
    LOWERCASE_WORD_RE = re.compile(r"([a-z])(recovery|reconditioning|management|surgery|sprain|strain|contusion|soreness|irritation|impingement|thrombosis)(\b)", re.IGNORECASE)

    def fmt(s: str) -> str:
        s = s.replace(";", " ").replace("/", " ").strip()
        s = PREP_RE.sub(r" \1 ", s)
        s = LOWERCASE_WORD_RE.sub(r"\1 \2\3", s)
        return WORD_BOUNDARY_RE.sub(" ", s).strip()

    def format_injury(raw: str) -> str:
        if not raw:
            return ""
        raw = raw.strip()
        m = INJURY_ILLNESS_RE.search(raw)
        if m:
            body = m.group(1).rstrip(";.-")
            if ";" in body:
                location, detail = body.split(";", 1)
                location = fmt(location.strip())
                detail = fmt(detail.strip()).rstrip(".")
                if detail and detail not in ("-", "."):
                    return f"{location} - {detail}"
                return location
            return fmt(body.strip())
        raw = raw.rstrip(";.-")
        if not raw or raw in (".", "-", ";"):
            return ""
        return fmt(raw)

    def format_player(raw: str) -> str:
        if "," not in raw:
            return raw
        last, first = raw.split(",", 1)
        last = SUFFIX_RE.sub(r" \1", last.strip()).strip()
        return f"{first.strip()} {last}"

    def col_of(x: float) -> str | None:
        for name, (lo, hi) in [
            ("date", COL_GAME_DATE), ("time", COL_GAME_TIME),
            ("matchup", COL_MATCHUP), ("team", COL_TEAM),
            ("player", COL_PLAYER), ("status", COL_STATUS), ("reason", COL_REASON),
        ]:
            if lo <= x < hi:
                return name
        return None

    all_words: list[dict] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_offset = page_idx * 10000
            for word in page.extract_words():
                word = dict(word)
                word["top"] = word["top"] + page_offset
                all_words.append(word)

    rows: dict[float, dict[str, list[str]]] = {}
    for word in all_words:
        text_lower = word["text"].lower().replace(" ", "")
        if text_lower in HEADER_WORDS or text_lower in TITLE_WORDS:
            continue
        if PAGE_FOOTER_RE.match(text_lower):
            continue
        if text_lower == "notyetsubmitted":
            continue
        col = col_of(word["x0"])
        if col is None:
            continue
        y = round(word["top"])
        rows.setdefault(y, {}).setdefault(col, []).append(word["text"])

    sorted_ys = sorted(rows)
    current_matchup = ""
    current_date = ""
    current_game_time_utc: str | None = None
    current_team = ""

    row_data: list[dict] = []
    for y in sorted_ys:
        cells = {k: " ".join(v) for k, v in rows[y].items()}
        date    = cells.get("date", "").strip()
        time_   = cells.get("time", "").strip()
        matchup = cells.get("matchup", "").strip()
        team    = cells.get("team", "").strip()
        player  = cells.get("player", "").strip()
        status  = cells.get("status", "").strip()
        reason  = cells.get("reason", "").strip()

        if date:
            current_date = date
        if time_ or matchup:
            current_matchup = matchup
            if time_:
                current_game_time_utc = parse_game_time_utc(current_date, time_)
        elif date:
            current_matchup = ""
            current_game_time_utc = None
        if team:
            current_team = split_camel(team)

        if current_game_time_utc:
            game_field = f"{current_game_time_utc} {current_matchup}".strip()
        else:
            game_field = current_matchup
        row_data.append({
            "y": y, "player": player, "status": status, "reason": reason,
            "game": game_field, "team": current_team,
        })

    player_ys = [row["y"] for row in row_data if row["player"] and row["status"] in VALID_STATUSES]

    reason_chunks: dict[float, list[str]] = {}
    for row in row_data:
        if not row["reason"] or row["player"]:
            continue
        ry = row["y"]
        prev_ys = [py for py in player_ys if py <= ry]
        next_ys = [py for py in player_ys if py > ry]
        prev_y = prev_ys[-1] if prev_ys else None
        next_y = next_ys[0] if next_ys else None
        if prev_y is None:
            nearest_y = next_y
        elif next_y is None:
            nearest_y = prev_y
        else:
            nearest_y = prev_y if (ry - prev_y) <= (next_y - ry) else next_y
        reason_chunks.setdefault(nearest_y, []).append(row["reason"])

    claimed_reasons: set[float] = set()
    page_break_merges: dict[float, str] = {}

    sorted_player_rows = [r for r in row_data if r["player"] and r["status"] in VALID_STATUSES]
    for i, row in enumerate(sorted_player_rows):
        raw_inline = row["reason"]
        if not raw_inline.endswith(";"):
            continue
        next_player_y = sorted_player_rows[i + 1]["y"] if i + 1 < len(sorted_player_rows) else float("inf")
        orphans = [
            r for r in row_data
            if not r["player"] and r["reason"]
            and r["y"] > row["y"]
            and r["y"] < next_player_y
        ]
        if orphans:
            cont = orphans[0]
            continuation = fmt(cont["reason"])
            page_break_merges[row["y"]] = raw_inline.rstrip(";") + ";" + continuation
            claimed_reasons.add(cont["y"])

    raw_records: list[tuple[float, str, InjuryRecord]] = []
    for row in row_data:
        if not row["player"] or row["status"] not in VALID_STATUSES or not row["team"]:
            continue
        filtered_extra = []
        for r_text in reason_chunks.get(row["y"], []):
            y_of_r = next((rd["y"] for rd in row_data if not rd["player"] and rd["reason"] == r_text and rd["y"] in claimed_reasons), None)
            if y_of_r is None:
                filtered_extra.append(r_text)
        all_reasons = filtered_extra + ([row["reason"]] if row["reason"] else [])
        if row["y"] in page_break_merges:
            all_reasons = filtered_extra + [page_break_merges[row["y"]]]
        raw_reason = " ".join(all_reasons)
        raw_records.append((row["y"], raw_reason, InjuryRecord(
            game=row["game"],
            team=row["team"],
            player=format_player(row["player"]),
            status=row["status"],
            injury=format_injury(raw_reason),
            last_update="",
        )))

    records = [rec for _, _, rec in raw_records]

    return records


def compute_diff(
    old_store: dict[str, InjuryRecord],
    new_records: list[InjuryRecord],
    now_il: str,
) -> list[InjuryNotification]:
    """Detect status changes, additions, and removals between old store and new records."""
    notifications: list[InjuryNotification] = []

    new_by_key: dict[str, InjuryRecord] = {}
    teams_in_new: set[str] = set()
    for record in new_records:
        key = f"{record.team}|{record.player}"
        new_by_key[key] = record
        teams_in_new.add(record.team)

    # Added or status-changed players
    for key, new_rec in new_by_key.items():
        if key not in old_store:
            notifications.append(InjuryNotification(
                type="added",
                player=new_rec.player,
                team=new_rec.team,
                new_status=new_rec.status,
                timestamp=now_il,
            ))
        elif old_store[key].status != new_rec.status:
            notifications.append(InjuryNotification(
                type="status_change",
                player=new_rec.player,
                team=new_rec.team,
                old_status=old_store[key].status,
                new_status=new_rec.status,
                timestamp=now_il,
            ))

    # Removed players — only if their team is still represented in the new report
    for key, old_rec in old_store.items():
        if key not in new_by_key and old_rec.team in teams_in_new:
            notifications.append(InjuryNotification(
                type="removed",
                player=old_rec.player,
                team=old_rec.team,
                old_status=old_rec.status,
                timestamp=now_il,
            ))

    return notifications


def build_updated_store(
    old_store: dict[str, InjuryRecord],
    new_records: list[InjuryRecord],
    notifications: list[InjuryNotification],
    now_il: str,
) -> dict[str, InjuryRecord]:
    """Build new store: preserve last_update for unchanged records, set now_il for changed ones."""
    changed_keys = {f"{n.team}|{n.player}" for n in notifications}
    new_store: dict[str, InjuryRecord] = {}
    for record in new_records:
        key = f"{record.team}|{record.player}"
        if key in changed_keys or key not in old_store:
            new_store[key] = record.model_copy(update={"last_update": now_il})
        else:
            new_store[key] = record.model_copy(update={"last_update": old_store[key].last_update})
    return new_store


TTL_HOURS = 48


def _parse_timestamp(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def _prune_notification_history() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=TTL_HOURS)
    to_remove = [n for n in notification_history if (t := _parse_timestamp(n.timestamp)) and t < cutoff]
    for notif in to_remove:
        notification_history.remove(notif)


def prune_injury_store() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=TTL_HOURS)
    stale = [k for k, r in injury_store.items() if (t := _parse_timestamp(r.last_update)) and t < cutoff]
    for key in stale:
        del injury_store[key]
    if stale:
        logger.info(f"Pruned {len(stale)} stale injury record(s) older than {TTL_HOURS}h")


async def broadcast_notifications(notifications: list[InjuryNotification]) -> None:
    for notif in notifications:
        notification_history.insert(0, notif)
    del notification_history[MAX_NOTIFICATION_HISTORY:]
    _prune_notification_history()
    for queue in list(sse_subscribers):
        for notif in notifications:
            await queue.put(notif)


async def update_injury_data() -> None:
    """Fetch latest PDF, diff against store, update store, and push notifications."""
    url = get_current_pdf_url()
    logger.info(f"Fetching injury report: {url}")

    pdf_bytes = await fetch_pdf_bytes(url)
    if pdf_bytes is None:
        logger.warning("Keeping stale injury data — PDF unavailable")
        return

    now_il = get_utc_now_str()
    new_records = parse_injury_pdf(pdf_bytes)
    notifications = compute_diff(injury_store, new_records, now_il)
    new_store = build_updated_store(injury_store, new_records, notifications, now_il)

    injury_store.clear()
    injury_store.update(new_store)
    prune_injury_store()

    if notifications:
        logger.info(f"Broadcasting {len(notifications)} injury update(s)")
        await broadcast_notifications(notifications)


async def initialize() -> None:
    """Fetch and store the latest injury report on startup (no notifications)."""
    logger.info("Initializing injury service")
    url = get_current_pdf_url()
    logger.info(f"Fetching injury PDF: {url}")
    pdf_bytes = await fetch_pdf_bytes(url)
    if pdf_bytes is None:
        logger.warning("Starting with empty injury store — initial PDF unavailable")
        return

    now_il = get_utc_now_str()
    records = parse_injury_pdf(pdf_bytes)
    for record in records:
        key = f"{record.team}|{record.player}"
        injury_store[key] = record.model_copy(update={"last_update": now_il})

    logger.info(f"Injury store initialized with {len(injury_store)} player(s)")


async def start_scheduler() -> None:
    """Poll the injury PDF at every :00:15, :15:15, :30:15, :45:15 in NY time."""
    logger.info("Injury report scheduler started")
    while True:
        next_trigger = compute_next_trigger()
        sleep_secs = (next_trigger - datetime.now(NY_TZ)).total_seconds()
        if sleep_secs > 0:
            logger.debug(f"Next injury update at {next_trigger} (in {sleep_secs:.1f}s)")
            await asyncio.sleep(sleep_secs)
        try:
            await update_injury_data()
        except Exception as e:
            logger.error(f"Injury update cycle error: {e}", exc_info=True)
