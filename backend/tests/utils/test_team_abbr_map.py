from app.utils.team_abbr_map import espn_to_nba, nba_to_espn


def test_phl_to_phi():
    assert espn_to_nba('PHL') == 'PHI'


def test_pho_to_phx():
    assert espn_to_nba('PHO') == 'PHX'


def test_unchanged_passthrough():
    assert espn_to_nba('LAL') == 'LAL'
    assert espn_to_nba('CHA') == 'CHA'
    assert espn_to_nba('BOS') == 'BOS'


def test_nba_to_espn_phi():
    assert nba_to_espn('PHI') == 'PHL'


def test_nba_to_espn_phx():
    assert nba_to_espn('PHX') == 'PHO'


def test_nba_to_espn_passthrough():
    assert nba_to_espn('LAL') == 'LAL'
