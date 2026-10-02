# Trade deadline from ESPN settings

Branch: `fix/trade-deadline-from-espn`

## Verified 2026-09-18
Standings payload (already fetched with `view=mSettings`) carries `settings.tradeSettings.deadlineDate = 1805104800000` → 2027-03-15 10:00 UTC (12:00 Israel). `DeadlineCountdown.tsx` hardcodes `2026-03-16T10:00:00Z` and the label "16/3 12:00" — already stale for 2026-27.

## Change
- Backend: `DataTransformer.resolve_trade_deadline(raw) -> datetime | None` (epoch ms → aware UTC). `DataProvider.get_trade_deadline()` reads the cached raw standings payload (`_settings_payload`). Add `trade_deadline: Optional[datetime]` to `LeagueSummary` (`models/league.py`) and populate in `LeagueService.get_league_summary`.
- Frontend: `DeadlineCountdown` takes `deadline: string | null` prop; Dashboard passes `summary.trade_deadline`. Render nothing while summary loads or when null. Label formatted with `Intl.DateTimeFormat` in the viewer's timezone instead of the hardcoded string.
- Remove the hardcoded constant.

## Tests
- Backend: transformer test with the real epoch → expected datetime; missing key → None.
- Frontend: `DeadlineCountdown.test.tsx` — past deadline renders null; future renders days/hours.

## Verification
- Dashboard shows "15/3 12:00" (Israel) countdown once season 2027 settings are loaded.
