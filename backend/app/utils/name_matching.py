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
