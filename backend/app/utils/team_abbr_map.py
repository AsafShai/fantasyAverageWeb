_ESPN_TO_NBA: dict[str, str] = {
    'PHL': 'PHI',
    'PHO': 'PHX',
}

_NBA_TO_ESPN: dict[str, str] = {v: k for k, v in _ESPN_TO_NBA.items()}


def espn_to_nba(abbr: str) -> str:
    return _ESPN_TO_NBA.get(abbr, abbr)


def nba_to_espn(abbr: str) -> str:
    return _NBA_TO_ESPN.get(abbr, abbr)
