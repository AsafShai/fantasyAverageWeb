#!/usr/bin/env bash
# Baseline latency for /api/matchups/today BEFORE depth-chart filtering.
# Run from a machine with normal internet (e.g. your laptop):
#   bash scripts/perf_matchups_baseline.sh
# Re-run the identical script AFTER the change for an apples-to-apples compare.
set -euo pipefail
BASE="${BASE:-https://fantasyaverageweb.onrender.com}"
t() { curl -sS -o /dev/null -w "%{time_total}s (HTTP %{http_code})" --max-time 120 "$1"; }

echo "== warming container (Render free tier cold-starts after 15m idle) =="
echo "  ping: $(t "$BASE/api/matchups/upcoming-dates")"
echo "  ping: $(t "$BASE/api/matchups/upcoming-dates")"

echo
echo "== live slate (default 'Upcoming (live)') =="
echo "  call 1 (cold compute if cache expired): $(t "$BASE/api/matchups/today")"
echo "  call 2 (warm, 5-min slate cache hit)  : $(t "$BASE/api/matchups/today")"

echo
echo "== each upcoming date (first hit = cold compute for that slate) =="
DATES=$(curl -sS --max-time 60 "$BASE/api/matchups/upcoming-dates" | tr -d '[]"' | tr ',' ' ')
for d in $DATES; do
  ymd=$(echo "$d" | tr -d '-')
  echo "  $d  cold: $(t "$BASE/api/matchups/today?date=$ymd")   warm: $(t "$BASE/api/matchups/today?date=$ymd")"
done
echo
echo "Tip: the cold number is what the depth-chart fetch will add to; the warm"
echo "number should stay ~unchanged (served from the 5-min slate cache)."
