import asyncio
import io
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pdfplumber

from app.models.injury_models import InjuryRecord, InjuryNotification

logger = logging.getLogger(__name__)

NY_TZ = ZoneInfo("America/New_York")
IL_TZ = ZoneInfo("Asia/Jerusalem")

# In-memory state
injury_store: dict[str, InjuryRecord] = {}
sse_subscribers: list[asyncio.Queue] = []


def get_israel_time_str() -> str:
    return datetime.now(IL_TZ).strftime("%d/%m/%Y %H:%M:%S")


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
    """Fetch PDF with exponential backoff. Returns None if unavailable after all retries."""
    delay = 2
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
            await asyncio.sleep(delay)
            delay *= 2

    logger.error(f"Could not fetch injury PDF after {max_retries} attempts: {url}")
    return None


def parse_injury_pdf(pdf_bytes: bytes) -> list[InjuryRecord]:
    """Extract injury records from NBA injury report PDF."""
    records: list[InjuryRecord] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                current_game = ""
                for row in table:
                    if not row or len(row) < 5:
                        continue

                    game_cell = (row[0] or "").strip()
                    team_cell = (row[1] or "").strip()
                    player_cell = (row[2] or "").strip()
                    status_cell = (row[3] or "").strip()
                    reason_cell = (row[4] or "").strip()

                    # Skip header rows
                    if player_cell.lower() in ("player name", "player", ""):
                        continue
                    if team_cell.lower() in ("team", ""):
                        continue

                    # Carry forward game value for visually merged cells
                    if game_cell:
                        current_game = game_cell

                    records.append(InjuryRecord(
                        game=current_game,
                        team=team_cell,
                        player=player_cell,
                        status=status_cell,
                        injury=reason_cell,
                        last_update="",  # set by caller
                    ))
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


async def broadcast_notifications(notifications: list[InjuryNotification]) -> None:
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

    now_il = get_israel_time_str()
    new_records = parse_injury_pdf(pdf_bytes)
    notifications = compute_diff(injury_store, new_records, now_il)
    new_store = build_updated_store(injury_store, new_records, notifications, now_il)

    injury_store.clear()
    injury_store.update(new_store)

    if notifications:
        logger.info(f"Broadcasting {len(notifications)} injury update(s)")
        await broadcast_notifications(notifications)


async def initialize() -> None:
    """Fetch and store the latest injury report on startup (no notifications)."""
    logger.info("Initializing injury service")
    url = get_current_pdf_url()
    pdf_bytes = await fetch_pdf_bytes(url)
    if pdf_bytes is None:
        logger.warning("Starting with empty injury store — initial PDF unavailable")
        return

    now_il = get_israel_time_str()
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
