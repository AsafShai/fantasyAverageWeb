"""Benchmark the actual claims in the review, against the real code."""
import os, sys, time, timeit, statistics
os.environ.setdefault("SEASON_ID", "2026")
os.environ.setdefault("LEAGUE_ID", "1")
sys.path.insert(0, ".")

import numpy as np
import pandas as pd
from functools import lru_cache

print("=" * 70)
print("1. normalize_player_name — cached vs uncached")
print("=" * 70)

from app.utils.name_matching import normalize_player_name, _NORMALIZE_RE, _to_ascii

NAMES = [f"{f} {l}" for f in
         ["Nikola", "Luka", "Shai", "Jayson", "Giannis", "Kristaps", "Bogdan",
          "Dennis", "Nikola", "Alperen", "Domantas", "Franz", "Jusuf", "Dario"]
         for l in ["Jokić", "Dončić", "Gilgeous-Alexander", "Tatum", "Antetokounmpo",
                   "Porziņģis", "Bogdanović", "Schröder", "Vučević", "Şengün",
                   "Sabonis", "Wagner", "Nurkić", "Šarić", "O'Neale", "Smith Jr."]]
NAMES = (NAMES * 8)[:1500]          # ~1500 distinct-ish names, like the real player set
print(f"   name pool: {len(NAMES)} names, {len(set(NAMES))} distinct")

@lru_cache(maxsize=8192)
def cached_normalize(name: str) -> str:
    return _NORMALIZE_RE.sub("", _to_ascii(name).lower())

# single-call cost
n = 200_000
t_raw = timeit.timeit(lambda: normalize_player_name("Nikola Jokić"), number=n) / n
cached_normalize("Nikola Jokić")
t_hit = timeit.timeit(lambda: cached_normalize("Nikola Jokić"), number=n) / n
print(f"   uncached call : {t_raw*1e6:7.3f} µs")
print(f"   cache-hit call: {t_hit*1e6:7.3f} µs   ({t_raw/t_hit:.0f}x faster)")

# realistic per-request volume
def build_index_uncached():
    return {normalize_player_name(nm): nm for nm in NAMES}

def build_index_cached():
    return {cached_normalize(nm): nm for nm in NAMES}

build_index_cached()
r = 30
t_u = timeit.timeit(build_index_uncached, number=r) / r
t_c = timeit.timeit(build_index_cached, number=r) / r
print(f"\n   one 1500-name index build: uncached {t_u*1e3:6.2f} ms | cached {t_c*1e3:6.2f} ms")

# matchups route: 2 calls/row x 1200 rows + injury + depth-chart lookups
CALLS_PER_MATCHUPS_REQ = 1200 * 2 + 700 + 500
print(f"\n   /api/matchups/today  (~{CALLS_PER_MATCHUPS_REQ} calls):")
print(f"      uncached {CALLS_PER_MATCHUPS_REQ*t_raw*1e3:6.1f} ms  ->  cached {CALLS_PER_MATCHUPS_REQ*t_hit*1e3:6.1f} ms"
      f"   (saves {CALLS_PER_MATCHUPS_REQ*(t_raw-t_hit)*1e3:.1f} ms)")
# trend_service: 3 index builds of ~1100 each
print(f"   /api/trends/usage    (3 x 1100-name index builds):")
print(f"      uncached {3*t_u*1e3:6.1f} ms  ->  cached {3*t_c*1e3:6.1f} ms"
      f"   (saves {3*(t_u-t_c)*1e3:.1f} ms)")

print()
print("=" * 70)
print("2. pandas row iteration — iterrows vs itertuples vs to_dict")
print("=" * 70)

cols = ["Name", "Pro Team", "Positions", "status", "fantasy_team_name"] + \
       ["PTS", "REB", "AST", "STL", "BLK", "FGM", "FGA", "FTM", "FTA", "3PM", "MIN", "GP",
        "FG%", "FT%", "team_id", "player_id", "injured", "has_data",
        "season_rating", "last7_rating", "last15_rating", "last30_rating"]
df = pd.DataFrame({c: (["Nikola Jokić"] * 1200 if c in ("Name",)
                       else ["DEN"] * 1200 if c in ("Pro Team", "Positions", "status", "fantasy_team_name")
                       else np.random.rand(1200)) for c in cols})

def by_iterrows():
    return [(r["Name"], r["PTS"], r["REB"], r["GP"]) for _, r in df.iterrows()]
def by_itertuples():
    return [(r.Name, r.PTS, r.REB, r.GP) for r in df.itertuples(index=False)]
def by_records():
    return [(r["Name"], r["PTS"], r["REB"], r["GP"]) for r in df.to_dict("records")]

for name, fn in [("iterrows  ", by_iterrows), ("itertuples", by_itertuples), ("to_dict   ", by_records)]:
    r = 20
    t = timeit.timeit(fn, number=r) / r
    print(f"   {name}: {t*1e3:7.2f} ms per 1200-row pass")

print()
print("=" * 70)
print("3. Pydantic: construction, then FastAPI's response_model re-validation")
print("=" * 70)

from app.models.matchup_models import DefRanks, DefValues, PlayerMatchupResponse
from app.models.projection_models import Projection, ProjectionStats
from pydantic import TypeAdapter

def make_one(i):
    return PlayerMatchupResponse(
        player_name=f"Player {i}", pro_team="DEN", opponent="LAL", is_home=True,
        pace=99.1, league_avg_pace=98.0, positions=["PG", "SG"],
        def_ranks=DefRanks(pts=15, reb=15, ast=15, stl=15, blk=15, three_pm=15, fg_pct=15),
        def_values=DefValues(pts=113.2, reb=44.1, ast=26.0, stl=7.5, blk=4.9, three_pm=13.1, fg_pct=0.471),
        league_avg_def_values=DefValues(pts=113.0, reb=44.0, ast=26.0, stl=7.5, blk=5.0, three_pm=13.0, fg_pct=0.470),
        projection=Projection(default_minutes=32.5, status="green", reason="",
                              stats=ProjectionStats(pts=25.1, reb=11.2, ast=8.9, three_pm=1.2,
                                                    stl=1.1, blk=0.7, fgm=9.1, fga=17.2,
                                                    fg_pct=0.529, ftm=5.8, fta=7.1, ft_pct=0.817)),
        game_date="2026-01-15", on_depth_chart=True, injury_status=None,
    )

N_ROWS = 900
t0 = time.perf_counter()
objs = [make_one(i) for i in range(N_ROWS)]
t_construct = time.perf_counter() - t0
print(f"   construct {N_ROWS} PlayerMatchupResponse : {t_construct*1e3:7.2f} ms")

adapter = TypeAdapter(list[PlayerMatchupResponse])
r = 20
t_validate = timeit.timeit(lambda: adapter.validate_python(objs), number=r) / r
t_dump = timeit.timeit(lambda: adapter.dump_python(objs, mode="json"), number=r) / r
print(f"   FastAPI response_model re-validation    : {t_validate*1e3:7.2f} ms   <-- pure overhead")
print(f"   serialize to JSON-able (needed anyway)  : {t_dump*1e3:7.2f} ms")
print(f"\n   re-validation as share of construct+validate+dump: "
      f"{100*t_validate/(t_construct+t_validate+t_dump):.0f}%")

print()
print("=" * 70)
print("4. trend_service USG: .apply(axis=1) vs vectorized")
print("=" * 70)

N_GAMES = 25_000
g = pd.DataFrame({
    "player_id": np.repeat(np.arange(500), 50),
    "p_min": np.random.uniform(10, 38, N_GAMES), "p_fga": np.random.uniform(3, 25, N_GAMES),
    "p_fta": np.random.uniform(0, 10, N_GAMES), "p_tov": np.random.uniform(0, 6, N_GAMES),
    "t_min": np.full(N_GAMES, 240.0), "t_fga": np.random.uniform(75, 100, N_GAMES),
    "t_fta": np.random.uniform(15, 30, N_GAMES), "t_tov": np.random.uniform(8, 20, N_GAMES),
})

from app.services.trend_service import _usg_per_game

def apply_way():
    return g.groupby("player_id").apply(lambda grp: grp.apply(_usg_per_game, axis=1).mean(),
                                        include_groups=False)
def vector_way():
    denom = g["p_min"] * (g["t_fga"] + 0.44 * g["t_fta"] + g["t_tov"])
    num = 100 * (g["p_fga"] + 0.44 * g["p_fta"] + g["p_tov"]) * (g["t_min"] / 5)
    usg = pd.Series(np.where(denom == 0, 0.0, num / denom), index=g.index)
    return usg.groupby(g["player_id"]).mean()

t_a = timeit.timeit(apply_way, number=1)
r = 20
t_v = timeit.timeit(vector_way, number=r) / r
print(f"   rows: {N_GAMES:,}  players: 500")
print(f"   .apply(axis=1) per group : {t_a*1e3:8.1f} ms")
print(f"   vectorized               : {t_v*1e3:8.1f} ms   ({t_a/t_v:.0f}x faster)")
