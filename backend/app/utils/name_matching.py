"""Shared player-name normalization for joining across data sources (ESPN
site/fantasy APIs, official NBA injury PDF) that don't agree on diacritics or
punctuation (e.g. 'Nikola Jokic' vs 'Nikola Jokić')."""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

_NORMALIZE_RE = re.compile(r"[^a-z0-9]")
_POS_TOKEN = r"(?:PG|SG|SF|PF|C|G|F)"
_STATUS_TOKEN = r"(?:DTD|OUT|O|Q|P|IR|SUSP|NA|FA|RET|IL)"
_TRAILING_JUNK = re.compile(rf"\s+(?:{_POS_TOKEN}|{_STATUS_TOKEN})$", re.I)
_LEADING_ELIG = re.compile(rf"^(?:{_POS_TOKEN}(?:,\s*{_POS_TOKEN})*\))\s*", re.I)
_LEADING_PAREN = re.compile(r"^[A-Z]{1,3}\)\s*")
_LEADING_STATUS = re.compile(rf"^(?:{_STATUS_TOKEN})\s+", re.I)
_TEAM_PAREN = re.compile(r"\s*\([A-Z]{2,3}\s*-.*?\)")
_OPEN_PAREN = re.compile(r"\s*\([^)]*$")
_BRACKET = re.compile(r"\[.*?\]")
_HASHTAG_CONCAT = re.compile(r"^(.+?)[A-Z]\.[A-Za-z].*$")
_DUP_MARK = re.compile(r"-dup\b", re.I)


def _to_ascii(name: str) -> str:
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")


def normalize_player_name(name: str) -> str:
    return _NORMALIZE_RE.sub("", _to_ascii(name).lower())


def flip_last_first(name: str) -> str:
    """Turn 'Jokic, Nikola' into 'Nikola Jokic'."""
    if "," not in name:
        return name
    last, first = name.split(",", 1)
    flipped = f"{first.strip()} {last.strip()}".strip()
    return flipped or name


def clean_fantasy_scraped_name(name: str) -> str:
    """Strip eligibility, injury, and scrape leftovers from a player name.

    FantasyPros/Yahoo HTML often concatenates the name with positions and
    status, e.g. 'Anthony Edwards SF', 'Trae Young OUT',
    'SF,SG) Amen Thompson PG'.
    """
    if not name or not isinstance(name, str):
        return ""
    name = flip_last_first(_BRACKET.sub("", name).strip())
    if _DUP_MARK.search(name):
        return ""
    name = _TEAM_PAREN.sub("", name)
    name = _OPEN_PAREN.sub("", name)

    prev = None
    while name != prev:
        prev = name
        name = _LEADING_ELIG.sub("", name)
        name = _LEADING_PAREN.sub("", name)
        name = _LEADING_STATUS.sub("", name)
        name = _TRAILING_JUNK.sub("", name).strip()

    concat = _HASHTAG_CONCAT.match(name)
    if concat and " " in concat.group(1).strip():
        name = concat.group(1).strip()

    name = name.strip(" -")
    if not name:
        return ""
    if re.fullmatch(_POS_TOKEN, name, re.I) or re.fullmatch(_STATUS_TOKEN, name, re.I):
        return ""
    return name


# Space-separated keys as produced by ADP name normalization (not compact).
FANTASY_NAME_ALIASES: dict[str, str] = {
    "nicolas claxton": "nic claxton",
    "ron holland": "ronald holland",
    "carlton carrington": "bub carrington",
}


def fantasy_name_keys(normalized_name: str) -> list[str]:
    """Canonical key plus nickname/alias variants for the same player."""
    if not normalized_name:
        return []
    keys = [normalized_name]
    alias = FANTASY_NAME_ALIASES.get(normalized_name)
    if alias and alias not in keys:
        keys.append(alias)
    for src, dest in FANTASY_NAME_ALIASES.items():
        if dest == normalized_name and src not in keys:
            keys.append(src)
    return keys


def lookup_catalog_espn_id(normalized_name: str, names: dict[str, int]) -> Optional[int]:
    """Resolve a cleaned, space-separated name to a catalog ESPN id."""
    if not normalized_name:
        return None
    for key in fantasy_name_keys(normalized_name):
        if key in names:
            return names[key]
    return _unique_first_prefix_match(normalized_name, names)


def _unique_first_prefix_match(key: str, names: dict[str, int]) -> Optional[int]:
    parts = key.split()
    if len(parts) < 2:
        return None
    first, last = parts[0], parts[-1]
    if len(first) < 3:
        return None
    matches: list[int] = []
    for other, espn_id in names.items():
        oparts = other.split()
        if len(oparts) < 2 or oparts[-1] != last:
            continue
        ofirst = oparts[0]
        if len(ofirst) < 3 or first == ofirst:
            continue
        if first.startswith(ofirst) or ofirst.startswith(first):
            matches.append(espn_id)
    unique = set(matches)
    if len(unique) == 1:
        return unique.pop()
    return None


# Known cross-source name mismatches that normalize_player_name alone can't
# resolve (e.g. suffix/nickname differences). Keyed by the source-side
# normalized name, valued by the store-side normalized name.
NAME_OVERRIDES: dict[str, str] = {}


def resolve_join_key(name: str) -> str:
    normalized = normalize_player_name(name)
    return NAME_OVERRIDES.get(normalized, normalized)
