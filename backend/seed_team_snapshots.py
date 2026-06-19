import urllib.request
import json
import psycopg2
from datetime import date, timedelta

LEAGUE_ID = 660330196
BASE = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/{LEAGUE_ID}"
DB_URL = "postgresql://BACKEND_USER:npg_XuZKNTk5qYG0@ep-super-voice-ag0l0ik6-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
ACTIVE_SLOTS = {0, 1, 2, 3, 4, 5, 6, 11}
SEASON_START = date(2025, 10, 22)  # scoring period 1


def fetch_json(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def get_team_names(data):
    return {t["id"]: t.get("name", f"Team {t['id']}") for t in data["teams"]}


def get_team_totals(team, period):
    totals = dict(gp=0, fgm=0, fga=0, ftm=0, fta=0, three_pm=0, reb=0, ast=0, stl=0, blk=0, pts=0)
    for entry in team["roster"]["entries"]:
        if entry["lineupSlotId"] not in ACTIVE_SLOTS:
            continue
        player = entry["playerPoolEntry"]["player"]
        stat_entry = next(
            (s for s in player["stats"]
             if s["statSplitTypeId"] == 5 and s["scoringPeriodId"] == period and s["statSourceId"] == 0),
            None
        )
        if not stat_entry or not stat_entry["stats"]:
            continue
        s = stat_entry["stats"]
        st = lambda k: float(s.get(str(k), 0) or 0)
        totals["fgm"]      += st(13)
        totals["fga"]      += st(14)
        totals["ftm"]      += st(15)
        totals["fta"]      += st(16)
        totals["three_pm"] += st(17)
        totals["reb"]      += st(6)
        totals["ast"]      += st(3)
        totals["stl"]      += st(2)
        totals["blk"]      += st(1)
        totals["pts"]      += st(0)
        totals["gp"]       += int(st(42))
    return totals


def period_to_date(period):
    return SEASON_START + timedelta(days=period - 1)


def main():
    print("Fetching current scoring period...")
    current_data = fetch_json(f"{BASE}?view=mRoster")
    current_period = current_data["scoringPeriodId"]
    print(f"Current period: {current_period}")

    team_names_data = fetch_json(f"{BASE}?view=mTeam")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("SELECT COALESCE(MAX(scoring_period_id), 0) FROM team_daily_snapshot")
    last_seeded = cur.fetchone()[0]
    start_period = last_seeded + 1

    if start_period >= current_period:
        print(f"Already up to date (last seeded: {last_seeded})")
        cur.close()
        conn.close()
        return

    print(f"Seeding periods {start_period} to {current_period - 1}...")

    cumulative = {}

    if last_seeded > 0:
        cur.execute("""
            SELECT team_id, gp, fgm, fga, ftm, fta, three_pm, reb, ast, stl, blk, pts
            FROM team_daily_snapshot
            WHERE scoring_period_id = %s
        """, (last_seeded,))
        for row in cur.fetchall():
            tid = row[0]
            cumulative[tid] = dict(gp=row[1], fgm=row[2], fga=row[3], ftm=row[4], fta=row[5],
                                   three_pm=row[6], reb=row[7], ast=row[8], stl=row[9], blk=row[10], pts=row[11])

    for period in range(start_period, current_period):
        print(f"  Period {period} ({period_to_date(period)})...", end=" ")
        data = fetch_json(f"{BASE}?view=mRoster&scoringPeriodId={period}")
        team_names = get_team_names(team_names_data)

        for team in data["teams"]:
            tid = team["id"]
            day = get_team_totals(team, period)

            if tid not in cumulative:
                cumulative[tid] = dict(gp=0, fgm=0, fga=0, ftm=0, fta=0, three_pm=0, reb=0, ast=0, stl=0, blk=0, pts=0)

            for k in day:
                cumulative[tid][k] += day[k]

            c = cumulative[tid]
            fg_pct = round(c["fgm"] / c["fga"], 4) if c["fga"] > 0 else 0
            ft_pct = round(c["ftm"] / c["fta"], 4) if c["fta"] > 0 else 0

            cur.execute("""
                INSERT INTO team_daily_snapshot
                    (scoring_period_id, date, team_id, team_name, gp, fgm, fga, fg_pct, ftm, fta, ft_pct, three_pm, reb, ast, stl, blk, pts)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (scoring_period_id, team_id) DO NOTHING
            """, (
                period, period_to_date(period), tid, team_names.get(tid, f"Team {tid}"),
                c["gp"], c["fgm"], c["fga"], fg_pct,
                c["ftm"], c["fta"], ft_pct,
                c["three_pm"], c["reb"], c["ast"], c["stl"], c["blk"], c["pts"]
            ))

        conn.commit()
        print("done")

    cur.close()
    conn.close()
    print(f"\nSeeding complete. {current_period - start_period} periods inserted.")


if __name__ == "__main__":
    main()
