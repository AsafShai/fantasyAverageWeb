# Live Draft Report Card — Design (idea 12)

Every draft pick vs what the player actually returned, updating all season. Steals, busts, per-team grades. Draft = the league's main event (third-round reversal); this page keeps it alive for months.
Status: design, no code. 2026-07-11.

## Data — all verified 2026-07-11

| Piece | Source | Status |
|---|---|---|
| Picks (168) | `?view=mDraftDetail` — playerId, teamId, overallPickNumber, roundId | ✅ probed, 200 no cookies |
| Player names | `/seasons/{yr}/players?view=players_wl` (playerId → fullName) | ✅ probed, 1234 players |
| Fantasy team names | `?view=mTeam` | ✅ probed |
| Realized value | z-scores computed from `fs_player_games` (season-to-date per-game averages) | ✅ computed for 2025-26: 167/168 matched (miss = Kyrie, DNP season — correct behavior) |

## Calc

- **Per-game averages** per player season-to-date from `fs_player_games` (GP, MPG, 8 cats).
- **Z-scores**: counting cats standard z vs pool (GP ≥ 15); FG%/FT% as attempt-weighted impact z (same convention as `playerRankings.ts` / ranking engine — reuse backend z logic if exposed, else mirror).
- **Value rank** = position by total z among pool.
- **Pick diff** = `overallPickNumber − value_rank`. Positive = steal, negative = reach/bust.
- **Badges**: Steal ≥ +25 diff; Solid +10..+25; Fair −10..+10; Reach −25..−10; Bust ≤ −25; **DNP** = no season data (injured/never played).
- **Team grade**: avg diff across team's picks (DNP counts as pick−pool_size floor), mapped to letter bins; plus "z captured" total.
- Early rounds weigh more in perception — v2 could weight diff by round; v1 plain avg.

## In-season behavior

Recomputes on the same cadence as rankings (z-to-date changes nightly). Draft is static after draft night; only the value side moves. Early season (< ~10 GP) noisy — show GP column and a "small sample" banner until league-wide avg GP ≥ 10.

## Endpoint

`GET /api/league/draft-report`
`{teams: [{team_id, name, grade, avg_diff, z_total}], picks: [{pick, round, team_id, player, gp, mpg, z, value_rank, diff, badge}]}`
Draft detail fetched once + cached long (immutable after draft); value side reuses ranking pipeline data.

## Frontend

Page `DraftReport.tsx`:
1. **Team grade cards** — 12 cards: grade letter, avg diff, z captured.
2. **Draft board heat grid** — rounds × teams, cell colored by diff (diverging: steal-blue ↔ bust-red, gray neutral) — the shareable "one look" view.
3. **Top steals / top busts** panels (5 each).
4. **Full picks table** — sortable by pick / diff / z; mobile: hide MPG+round, sticky player col.

## Mockup

`draft_report_mockup.html` (repo root) — **real 2025-26 draft + real outcomes** (mDraftDetail + fs z-scores). Top steals found: Keyonte George (pick 117 → value 22), Ty Jerome (138 → 45), Kevin Porter Jr. (95 → 17).

## Tasks

### Backend
- [ ] `app/services/draft_report_service.py` (new): fetch+cache draft detail, join names/teams, z-values via ranking data, badges/grades
- [ ] `app/routes/league.py`: add `GET /draft-report`
- [ ] models + tests (badge thresholds, DNP handling)

### Frontend
- [ ] `src/pages/DraftReport.tsx` (new): cards + heat grid + tables
- [ ] types, hook, navbar entry behind `VITE_FF_DRAFT_REPORT`

### Migrations / DB
- none

### Scope: Medium

## Open questions
- Show `memberId`-based "who drafted" vs current roster ("still on team?" flag — needs current roster join; nice v2)
- Diff thresholds for badges — tune after seeing real distribution (mockup helps)
