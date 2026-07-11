"""Shared player-name normalization for joining across data sources (ESPN,
nba_api, official NBA injury PDF) that don't agree on diacritics or
punctuation (e.g. 'Nikola Jokic' vs 'Nikola Jokić')."""

import re
import unicodedata

_NORMALIZE_RE = re.compile(r"[^a-z0-9]")


def _to_ascii(name: str) -> str:
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")


def normalize_player_name(name: str) -> str:
    return _NORMALIZE_RE.sub("", _to_ascii(name).lower())


# Known ESPN <-> NBA name mismatches that normalize_player_name alone can't
# resolve (e.g. suffix/nickname differences). Keyed by the ESPN-side
# normalized name, valued by the nba_api-side normalized name.
NAME_OVERRIDES: dict[str, str] = {}


def resolve_join_key(name: str) -> str:
    normalized = normalize_player_name(name)
    return NAME_OVERRIDES.get(normalized, normalized)
