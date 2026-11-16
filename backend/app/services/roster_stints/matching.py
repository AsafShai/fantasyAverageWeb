"""Map the feed's NBA players to ESPN athlete ids, by name.

The feed only has an NBA id and a slug ("christopher-cenac-jr"); our game rows
use ESPN ids and ESPN display names ("Chris Cenac Jr."). Names are compared
after normalization, and a match is only accepted when it is unambiguous, using
the teams the feed puts the player on to break ties. Tried in order:

  1. same name (accents, punctuation and Jr/Sr/II/III/IV ignored)
  2. the two name parts swapped ("Hansen Yang" vs "Yang Hansen")
  3. a common first-name variant ("Chris" vs "Christopher")
  4. the last name alone, when only one ESPN player on his teams has it

Whoever is still unmatched keeps box-score-only stints (flagged approximate).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# Both directions are tried, so each pair is listed once.
_FIRST_NAME_ALIASES: list[tuple[str, str]] = [
    ("chris", "christopher"), ("nic", "nicolas"), ("nick", "nicholas"), ("nick", "nicolas"),
    ("mike", "michael"), ("matt", "matthew"), ("jon", "jonathan"), ("josh", "joshua"),
    ("alex", "alexander"), ("alex", "alexandre"), ("cam", "cameron"), ("zach", "zachary"),
    ("tim", "timothy"), ("ron", "ronald"), ("rob", "robert"), ("bob", "robert"),
    ("will", "william"), ("tony", "anthony"), ("dan", "daniel"), ("danny", "daniel"),
    ("jake", "jacob"), ("ben", "benjamin"), ("greg", "gregory"), ("jeff", "jeffrey"),
    ("kenny", "kenneth"), ("herb", "herbert"), ("moe", "mohamed"), ("pj", "pj"),
    ("gg", "gregory"), ("trey", "trey"), ("kj", "kenyon"), ("jj", "jj"),
]
_ALIASES: dict[str, set[str]] = {}
for a, b in _FIRST_NAME_ALIASES:
    _ALIASES.setdefault(a, set()).add(b)
    _ALIASES.setdefault(b, set()).add(a)


def name_tokens(name: str) -> list[str]:
    """'Chris Cenac Jr.' -> ['chris', 'cenac']; 'christopher-cenac-jr' -> ['christopher', 'cenac']."""
    ascii_ = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    ascii_ = ascii_.replace("'", "").replace(".", "")
    toks = [t for t in re.split(r"[^a-z0-9]+", ascii_) if t]
    while len(toks) > 1 and toks[-1] in _SUFFIXES:
        toks.pop()
    return toks


def _key(tokens: list[str]) -> str:
    return "".join(tokens)


@dataclass
class EspnPlayer:
    player_id: int
    name: str
    teams: set[int] = field(default_factory=set)


@dataclass
class FeedPlayer:
    nba_player_id: int
    slug: str
    teams: set[int] = field(default_factory=set)


def match_players(
    feed_players: list[FeedPlayer], espn_players: list[EspnPlayer],
) -> tuple[dict[int, int], list[FeedPlayer]]:
    """Returns ({nba_player_id: espn_player_id}, unmatched feed players). An
    ESPN id is given to at most one feed player."""
    by_key: dict[str, list[EspnPlayer]] = {}
    for p in espn_players:
        by_key.setdefault(_key(name_tokens(p.name)), []).append(p)

    taken: set[int] = set()
    matched: dict[int, int] = {}
    unmatched: list[FeedPlayer] = []

    def pick(candidates: list[EspnPlayer], fp: FeedPlayer) -> EspnPlayer | None:
        free = [c for c in candidates if c.player_id not in taken]
        if len(free) == 1:
            return free[0]
        on_team = [c for c in free if c.teams & fp.teams]
        return on_team[0] if len(on_team) == 1 else None

    def by_name(fp: FeedPlayer) -> EspnPlayer | None:
        toks = name_tokens(fp.slug.replace("-", " "))
        if not toks:
            return None
        hit = pick(by_key.get(_key(toks), []), fp)
        if hit:
            return hit
        if len(toks) == 2:
            hit = pick(by_key.get(_key([toks[1], toks[0]]), []), fp)
            if hit:
                return hit
        for alt in _ALIASES.get(toks[0], ()):
            hit = pick(by_key.get(_key([alt, *toks[1:]]), []), fp)
            if hit:
                return hit
        if len(toks) >= 2:
            last = toks[-1]
            same_last = [p for p in espn_players
                         if p.teams & fp.teams and (name_tokens(p.name) or [""])[-1] == last]
            hit = pick(same_last, fp)
            if hit and len([p for p in same_last if p.player_id not in taken]) == 1:
                return hit
        return None

    # Exact names first, so a fuzzy pass can't take an id an exact match needs.
    remaining: list[FeedPlayer] = []
    for fp in feed_players:
        hit = pick(by_key.get(_key(name_tokens(fp.slug.replace("-", " "))), []), fp)
        if hit:
            matched[fp.nba_player_id] = hit.player_id
            taken.add(hit.player_id)
        else:
            remaining.append(fp)
    for fp in remaining:
        hit = by_name(fp)
        if hit:
            matched[fp.nba_player_id] = hit.player_id
            taken.add(hit.player_id)
        else:
            unmatched.append(fp)
    return matched, unmatched
