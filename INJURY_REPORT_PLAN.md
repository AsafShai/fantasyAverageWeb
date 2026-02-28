# Injury Report Feature — Implementation Plan

## Summary of Decisions
- **Real-time:** SSE (Server-Sent Events)
- **Status changes that notify:** status field changed, new player added, player removed from report
- **Filters:** player name (text search), team (dropdown), status (dropdown)
- **Error handling:** retry 3 times with backoff, then keep stale data
- **Page:** new `/injuries` page, two-panel layout (table left, notifications right)
- **Notifications:** `"Player (TEAM): Out → Questionable"`, max 50 in localStorage, no clear button, includes timestamp
- **Table columns:** Team | Game | Player | Status | Injury | Last Update
- **Timestamps:** stored in Israel time (`Asia/Jerusalem`)

## Clarifications
- **Player removal:** A player is only considered "removed" if their team still has other injury entries in the PDF but that specific player is no longer listed. If a team has no entries at all in the PDF, its players are simply not tracked (not considered removed).
- **Notification timestamp:** Each notification includes the Israel time it was detected.
- **Frontend table update on notification:** When the frontend receives an SSE notification, it updates the player's row in the table in real-time (status + last_update), not just the notifications panel.

## Data Source
- PDF URL: `https://ak-static.cms.nba.com/referee/injury/Injury-Report_{YYYY-MM-DD}_{HH}_{MM}{AM/PM}.pdf`
- Time zone: New York (`America/New_York`)
- Updates every 15 minutes
- Backend polls at :00:15, :15:15, :30:15, :45:15 (15s after each mark to allow sync)

---

## Phase 1 — Backend Dependencies

**`backend/requirements.txt`** — add:
- `pdfplumber` — extract tables from NBA injury PDFs
- `sse-starlette` — SSE support for FastAPI

---

## Phase 2 — Backend: Models

**New file: `backend/app/models/injury_models.py`**

```python
class InjuryRecord(BaseModel):
    game: str        # e.g. "GSW@LAL"
    team: str        # e.g. "Los Angeles Lakers"
    player: str      # e.g. "LeBron James"
    status: str      # Out | Questionable | Doubtful | Game Time Decision | Available
    injury: str      # e.g. "Knee"
    last_update: str # Israel time, e.g. "28/02/2026 10:45:22"

class InjuryNotification(BaseModel):
    type: Literal["status_change", "added", "removed"]
    player: str
    team: str
    old_status: Optional[str]  # None for "added"
    new_status: Optional[str]  # None for "removed"
    timestamp: str             # Israel time
```

---

## Phase 3 — Backend: Injury Service

**New file: `backend/app/services/injury_service.py`**

### In-memory state
```python
injury_store: dict[str, InjuryRecord] = {}  # key = "team|player"
sse_subscribers: list[asyncio.Queue] = []
```

### PDF URL generation
- Get current NY time (`America/New_York`)
- Floor to previous 15-minute mark: `(minute // 15) * 15`
- Format: `strftime("%I_%M%p")` → `03_30AM`, `12_15PM`, etc.
- Full URL: `https://ak-static.cms.nba.com/referee/injury/Injury-Report_{date}_{time}.pdf`

### PDF fetching with retry
- 3 attempts, 2s → 4s → 8s backoff using `httpx` (already in project)
- On all retries failed: log warning, keep existing `injury_store` unchanged

### PDF parsing with pdfplumber
- Open PDF bytes with `pdfplumber`
- Iterate all pages → `page.extract_tables()`
- Skip header rows (where player column == "Player Name" or similar)
- Handle "merged" game cells: carry forward last seen non-empty game value per page
- Return list of `InjuryRecord`

### Diff detection
```
Determine which teams appear in the new report.

For each player in new report:
  - If not in old store → type="added", new_status=their status
  - If status changed → type="status_change", old_status, new_status

For each player in old store:
  - If their team appears in the new report BUT player is not listed → type="removed"
  - If their team does NOT appear in the new report at all → skip (not a removal)
```

### Store update
1. Compute diff against current `injury_store`
2. Replace `injury_store` with new records
3. For status_change and added records: set `last_update` = current Israel time
4. For unchanged records: preserve their existing `last_update`
5. Return list of notifications

### SSE broadcast
- One `asyncio.Queue` per connected client in `sse_subscribers`
- On update: push each notification JSON to every queue

### Initialization (on startup)
- Fetch + parse latest PDF (previous 15-min mark from current NY time)
- Populate `injury_store` (no notifications — no previous state to diff against)

### Scheduler (asyncio background task)
```python
async def start_scheduler():
    while True:
        compute next trigger: next :00:15, :15:15, :30:15, :45:15 in NY time
        sleep until that exact moment
        fetch + parse PDF for current 15-min mark
        compute diff → broadcast notifications → update store
```

---

## Phase 4 — Backend: Endpoints

**New file: `backend/app/routers/injuries.py`**

```
GET /api/injuries
  Returns: list[InjuryRecord] — full current injury_store
  Used by: frontend on initial page load

GET /api/injuries/stream
  Returns: SSE stream (text/event-stream)
  Each event: JSON-encoded InjuryNotification
  On connect: client queue added to sse_subscribers
  On disconnect: client queue removed from sse_subscribers
  Heartbeat: comment ping every 30s to keep connection alive
```

**Modify `backend/main.py`:**
- Include `injuries_router` with prefix `/api`
- `startup` event: `await injury_service.initialize()` + `asyncio.create_task(injury_service.start_scheduler())`

---

## Phase 5 — Frontend: Types

**New file: `frontend/src/types/injury.ts`**

```typescript
export interface InjuryRecord {
  game: string;
  team: string;
  player: string;
  status: string;
  injury: string;
  last_update: string;
}

export interface InjuryNotification {
  type: 'status_change' | 'added' | 'removed';
  player: string;
  team: string;
  old_status?: string;
  new_status?: string;
  timestamp: string;
}

export interface StoredNotification extends InjuryNotification {
  id: string;          // uuid for React key
  received_at: string; // browser local time when received
}
```

---

## Phase 6 — Frontend: Custom Hooks

**New file: `frontend/src/hooks/useInjuryData.ts`**

1. On mount: `fetch("/api/injuries")` → populate `records` state
2. Open `EventSource` to `/api/injuries/stream`
3. On SSE message: parse `InjuryNotification`, apply to `records` state:
   - `added` → push new record to table
   - `removed` → remove record by team+player from table
   - `status_change` → update status + last_update for matching record in table
4. Also calls `addNotification` from `useInjuryNotifications`
5. Browser `EventSource` auto-reconnects on disconnect; re-fetch full table on reconnect
6. Cleanup: `eventSource.close()` on unmount

Returns: `{ records, loading, error }`

**New file: `frontend/src/hooks/useInjuryNotifications.ts`**

- localStorage key: `injury_notifications`
- `addNotification(notif)`: prepend to array, slice to max 50, save to localStorage
- Returns: `{ notifications: StoredNotification[], addNotification }`

---

## Phase 7 — Frontend: Components

**New file: `frontend/src/components/injuries/InjuryFilters.tsx`**
- Text input: player name filter (debounced ~300ms)
- Team dropdown: derived from unique teams in records
- Status dropdown: fixed list (Out, Questionable, Doubtful, Game Time Decision, Available)

**New file: `frontend/src/components/injuries/InjuryTable.tsx`**
- Columns: Team | Game | Player | Status | Injury | Last Update
- Color-coded status badge:
  - Out → red
  - Questionable → yellow
  - Doubtful → orange
  - Game Time Decision → blue
  - Available → green
- Client-side filtering applied per render
- Empty states: "No injury data available" / "No results match your filters"

**New file: `frontend/src/components/injuries/NotificationsPanel.tsx`**
- Right-side panel, fixed height, scrollable
- Each item: icon + message + timestamp
- Message format:
  - `status_change`: `"LeBron James (LAL): Out → Questionable"`
  - `added`: `"Stephen Curry (GSW): Added — Questionable"`
  - `removed`: `"Kevin Durant (PHX): Removed"`
- Newest notification at top
- "No notifications yet" empty state

---

## Phase 8 — Frontend: Page & Routing

**New file: `frontend/src/pages/InjuriesPage.tsx`**

```
┌──────────────────────────────────────────────────────────┐
│  Injury Report        Last fetched: 28/02/2026 10:30:15  │
├───────────────────────────────┬──────────────────────────┤
│  [Search player...]           │  Notifications (3)       │
│  [Team ▼]  [Status ▼]        │  ─────────────────────   │
│                               │  LeBron: Out→Questionable│
│  Team | Game | Player |Status │  Curry: Added            │
│  ───────────────────────────  │  Durant: Removed         │
│  LAL  | ...  | LeBron | Out  │  ...                     │
└───────────────────────────────┴──────────────────────────┘
```

**Update routing** — add `/injuries` route

**Update nav/layout** — add "Injuries" link

---

## Edge Cases

| Case | Handling |
|---|---|
| PDF not found (no games) | Retry 3x with backoff, keep stale data, log warning |
| Backend restart | `initialize()` re-fetches latest PDF on startup |
| SSE disconnect | Browser `EventSource` auto-reconnects; re-fetch full table on reconnect |
| Scheduler drift | Compute exact next trigger each iteration (no drift accumulation) |
| NY daylight saving | `zoneinfo("America/New_York")` handles DST automatically |
| Israel DST | `zoneinfo("Asia/Jerusalem")` handles IDT automatically |
| >50 notifications | Slice array to 50, dropping oldest |
| PDF multi-page | Iterate all pages in pdfplumber loop |
| PDF merged game cells | Carry-forward last non-empty game value per page |
| Empty injury report | `injury_store` set to `{}`, no removal notifications (no teams present) |
| Simultaneous SSE clients | Each client has its own `asyncio.Queue` |
| Player's team not in PDF | Not considered a removal — team simply absent from today's report |
