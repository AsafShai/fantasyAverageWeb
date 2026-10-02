---
name: espn-season-context
description: This skill should be used when debugging ESPN endpoints, working with scoring periods, or asking "what's the current period/week" / "what date is period N" / "what season are we in". Resolves NBA season year and current scoring period from ESPN so responses aren't stale.
---

# ESPN Season Context

Resolve the current NBA season and scoring period before interpreting ESPN responses.

## When this applies
- Debugging an endpoint that filters by `scoring_period_id`
- User asks what the current period or week is
- Comparing two ESPN responses and needs to know "is this stale?"
- Writing a test that needs a realistic period value

## Steps

1. **Current scoring period** — hit ESPN scoreboard:
   ```bash
   curl -s "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" \
     | python -c "import json,sys; d=json.load(sys.stdin); print('season:', d.get('season',{}).get('year')); print('week:', d.get('week',{}).get('number'))"
   ```

2. **Season year** — NBA seasons span two calendar years. The "season year" reported by ESPN is the **ending** year (e.g. 2025–26 season → year=2026).

3. **Scoring period mapping** — the fantasy app's `scoring_period_id`:
   - `0` = season-to-date (not "period 0")
   - Otherwise ESPN's per-day period index, starting from opening day
   - Live current period is what the scoreboard returns

4. **Report** — surface to the user: season year, current scoring period, today's date in ET (NBA reference timezone).

## Notes
- All NBA schedule math uses America/New_York timezone
- Preseason periods exist but aren't tracked by the fantasy league — expect off-by-one surprises near season start
- Inject this context at the top of debug sessions involving stats so assumptions aren't stale
