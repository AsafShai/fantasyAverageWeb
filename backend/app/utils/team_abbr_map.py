from nba_api.stats.static import teams as _nba_static_teams

_ESPN_TO_NBA: dict[str, str] = {
    'PHL': 'PHI',
    'PHO': 'PHX',
}

_NBA_TO_ESPN: dict[str, str] = {v: k for k, v in _ESPN_TO_NBA.items()}


def espn_to_nba(abbr: str) -> str:
    return _ESPN_TO_NBA.get(abbr, abbr)


def nba_to_espn(abbr: str) -> str:
    return _NBA_TO_ESPN.get(abbr, abbr)


# NBA stats-API numeric team_id <-> NBA abbreviation, shared by anything that
# needs to resolve a team abbreviation to the numeric id the model/serving
# layer keys teams by (e.g. resolving an ESPN opponent abbr to opponent_team_id).
NBA_TEAM_ID_TO_ABBR: dict[int, str] = {
    team['id']: team['abbreviation'] for team in _nba_static_teams.get_teams()
}
NBA_ABBR_TO_TEAM_ID: dict[str, int] = {v: k for k, v in NBA_TEAM_ID_TO_ABBR.items()}
