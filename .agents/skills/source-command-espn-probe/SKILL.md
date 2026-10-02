---
name: "source-command-espn-probe"
description: "Migrated source command `espn-probe`"
---

# source-command-espn-probe

Use this skill when the user asks to run the migrated source command `espn-probe`.

## Command Template

# ESPN Probe

Quick curl against the ESPN API and pretty-print.

## Usage

Ask the user (if not provided) for either:
- **Team ID** — probe `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/<id>` and `/depthcharts` endpoints
- **Full path** — probe that exact URL

## Steps

1. Build the URL:
   - Team roster: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/<id>`
   - Depth chart: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/<id>/depthcharts`
   - Scoreboard: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
   - Custom: whatever the user pastes

2. Run:
   ```bash
   curl -s "<url>" | python -m json.tool
   ```

3. If the user asked about a specific field, grep or jq it out instead of dumping the whole payload:
   ```bash
   curl -s "<url>" | python -c "import json,sys; d=json.load(sys.stdin); print(d['<key>'])"
   ```

4. Summarize: status (via `curl -o /dev/null -w '%{http_code}'` if needed), key fields, anything unexpected (nulls, missing keys).

## Tips
- Add `-L` if the URL redirects
- For the private fantasy API (different host), use the fantasy-specific auth/cookies — not covered by this probe
