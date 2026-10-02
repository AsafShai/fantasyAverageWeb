"""Pre-season feature-flag audit: code flags vs Render env vars.

Usage:
    set RENDER_API_KEY=rnd_xxx   (create at https://dashboard.render.com/settings#api-keys)
    python scripts/flag_audit.py

Compares every VITE_* flag read in frontend/src/config/featureFlags.ts against
the env vars actually set on the Render static site (build-time) and prints a
drift table. Read-only — never writes to Render.
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FLAGS_TS = REPO_ROOT / "frontend" / "src" / "config" / "featureFlags.ts"
LOCAL_ENVS = [REPO_ROOT / "frontend" / ".env", REPO_ROOT / "frontend" / ".env.local"]

FRONTEND_SERVICE_ID = "srv-d35s7mripnbc739oen20"  # FantasyLeagueInfo static site
BACKEND_SERVICE_ID = "srv-d35s5vhr0fns73be9kag"  # fantasyAverageWeb web service
BACKEND_FLAG_VARS = ["INJURY_SCHEDULER_ENABLED", "MODEL_NIGHTLY_ENABLED"]


def code_flags() -> list[str]:
    text = FLAGS_TS.read_text(encoding="utf-8")
    return re.findall(r"import\.meta\.env\.(VITE_\w+)", text)


def local_env_values() -> dict[str, str]:
    values: dict[str, str] = {}
    for env_file in LOCAL_ENVS:  # .env first, .env.local overrides
        if not env_file.exists():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                values[key.strip()] = val.strip()
    return values


def render_env_vars(api_key: str, service_id: str) -> dict[str, str]:
    req = urllib.request.Request(
        f"https://api.render.com/v1/services/{service_id}/env-vars?limit=100",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        payload = json.load(resp)
    return {item["envVar"]["key"]: item["envVar"]["value"] for item in payload}


def main() -> int:
    api_key = os.environ.get("RENDER_API_KEY")
    if not api_key:
        print("RENDER_API_KEY not set. Create a read key at "
              "https://dashboard.render.com/settings#api-keys and export it.")
        return 1

    flags = code_flags()
    local = local_env_values()
    prod_front = render_env_vars(api_key, FRONTEND_SERVICE_ID)
    prod_back = render_env_vars(api_key, BACKEND_SERVICE_ID)

    drift = False
    print(f"{'flag':<28} {'local':<10} {'render':<10} note")
    print("-" * 62)
    for flag in flags:
        local_val = local.get(flag, "-")
        prod_val = prod_front.get(flag, "MISSING")
        note = ""
        if prod_val == "MISSING":
            note = "off in prod (unset)"
        elif (local_val == "true") != (prod_val == "true"):
            note = "DRIFT vs local"
            drift = True
        print(f"{flag:<28} {local_val:<10} {prod_val:<10} {note}")

    print()
    print("backend flags:")
    for var in BACKEND_FLAG_VARS:
        print(f"{var:<28} {'':<10} {prod_back.get(var, 'MISSING (default applies)')}")

    extra = [k for k in prod_front if k.startswith("VITE_") and k not in flags]
    if extra:
        print(f"\nset on Render but unread by code (stale?): {', '.join(extra)}")

    return 2 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
