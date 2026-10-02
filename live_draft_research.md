# Live Draft — ESPN API research (2026-09-18)

Probed live against league 660330196, seasons 2026 (done) and 2027 (upcoming). No cookies needed — league is public-readable.

## Endpoint
`GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{season}/segments/0/leagues/{league}?view=mDraftDetail&view=mSettings&view=mTeam`
(already wired in `data_provider.get_draft_detail_raw`, but cached forever — live mode needs a short TTL / bypass while `inProgress`).

## What we get

### `draftDetail`
| field | notes |
|---|---|
| `drafted` | true after completion |
| `inProgress` | true while draft room is live |
| `completeDate` | epoch ms, only after done |
| `picks[]` | ALL 168 slots pre-created before the draft (`playerId: -1`, `teamId` already set from pickOrder). Filled in as picks happen. |

### `picks[]` item
`overallPickNumber`, `roundId`, `roundPickNumber`, `teamId`, `playerId` (-1 = not yet), `memberId` (who clicked), `autoDraftTypeId` (0 manual, 2 = autopick observed last year — Alex Sarr #76), `lineupSlotId` (slot ESPN placed him), `keeper`, `reservedForKeeper`, `bidAmount`/`nominatingTeamId` (auction only), `tradeLocked`, `owningTeamIds`.

**No timestamp per pick.** Timer cannot be read from REST.

### `settings.draftSettings`
`type: SNAKE`, `timePerSelection: 90`, `date` (2027: Oct 15 2026 18:00 UTC = 21:00 Israel), `availableDate` (room opens 1h before), `pickOrder` (2027 already set: `[5,6,10,3,4,12,11,1,9,8,13,15]`), `orderType: MANUAL`, `keeperCount: 0`, `auctionBudget: 200` (unused), `isTradingEnabled`.

### `teams[]` / `members[]`
`id, abbrev, name, logo, primaryOwner, owners[]` → members give `firstName/lastName/displayName`. Also `draftDayProjectedRank` (ESPN's projected finish right after draft) and `currentProjectedRank`.

### `kona_player_info` (per player, works for 2027 now)
`ownership.averageDraftPosition`, `auctionValueAverage`, `percentOwned`, `draftRanksByRankType.STANDARD|ROTO.rank`, `injuryStatus`, `eligibleSlots`, `proTeamId`. `X-Fantasy-Filter` with `filterIds` works if `filterStatus` + `sortDraftRanks` are also present (400 otherwise).

Not available: pick timer, who is "online" in room, chat, queues (private, needs auth anyway).

## Live mechanics
- Poll every ~5s while `now >= availableDate` and `!drafted`. Detect new picks by count of `playerId != -1`.
- **Derived timer**: `timePerSelection - (now - serverTimeLastPickSeen)`, accuracy ±poll interval. Show as `~1:12`. Past 0 → "overtime / autopick?".
- **Pace**: avg observed seconds per pick → ETA, slowest drafters.
- Backend should own the poller (one poll for all users), push via SSE/WebSocket or clients poll our endpoint (cheap, cached 3s).
- Render free tier sleeps after 15 min — draft night needs a keep-alive or the first user wakes it (cold start ~30s).

## Community refs
- espn-api issue #558 asks the live-draft question, unanswered. ffscrapr and fantasy-espn-service use the same mDraftDetail polling approach.

## Update 2026-09-18 — draft-room socket protocol (from ESPN's draft page bundle)

Bundle: `cdn1.espn.net/kona/.../page/basketball/draft.js`. The room does NOT poll REST; it opens a socket.

- Token: `GET lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{season}/segments/0/leagues/{league}/teams/{teamId}/draftSecurity` with `espn_s2` + `SWID` cookies. Security token = `{fantasyGameId}:{leagueId}:{teamId}:{memberId}:{token}`.
- Connect: `wss://fantasydraft.espn.com/game-{gameId}/league-{leagueId}/JOIN?1={gameId}&2={leagueId}&3={teamId}&4={userProfileId}&5={token}&6=false&7=false&8=KONA&nocache=N`. SSE twin: `https://fantasydraft.espn.com/game-{gameId}/league-{leagueId}/sse/JOIN?…`.
- Messages: newline-terminated, space-separated fields.
  - `CLOCK phase time teamId playerId amount` — phase 1/6 = selecting, 2 = just picked, 3 = paused (clock -1), 0/-1 = pre-draft countdown.
  - `STATE n [duration]` — 0 BEFORE, 1 DURING, 2 AFTER, 3 PAUSED.
  - `SELECTING teamId secs`, `SELECTED teamId playerId slotId`, `AUTOSUGGEST playerId`.
  - `AUTODRAFT teamId true|false`, `JOINED teamId ownerId`, `LEFT teamId ownerId reason`.
  - `UNDONE pickNumber`, `RESET`, `INIT <base64 binary>` (full state, custom decoder), `CHAT`, `TOKEN`, `PONG`.
  - Client sends `JOIN …`, `PING`, `LEAVE`, and LM-only `PAUSE 1|0`, `UNDO n`, `RESET`.
- Unknowns until rehearsal: `gameId` value for basketball, ping cadence, whether a second connection for the same team kicks the first.

## News + injuries (working hosts)
- `https://site.web.api.espn.com/apis/fantasy/v2/games/fba/news/players?playerId={id}&limit=3` → Rotowire blurbs.
- `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries` → per NBA team, status Out / Day-To-Day, comment, athlete id.
- `site.api.espn.com` variants return 403.
