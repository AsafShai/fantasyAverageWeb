from app.utils.team_abbr_map import (
    ABBR_TO_TEAM_ID,
    SITE_ABBR_TO_TEAM_ID,
    TEAM_ID_TO_ABBR,
    TEAM_IDS,
    canonical_abbr,
    team_id_for_abbr,
)


def test_all_thirty_teams_present():
    assert len(TEAM_IDS) == 30
    assert len(TEAM_ID_TO_ABBR) == 30
    assert len(ABBR_TO_TEAM_ID) == 30
    assert len(SITE_ABBR_TO_TEAM_ID) == 30


def test_site_dialect_resolves_to_same_id_as_canonical():
    # the 8 teams where ESPN's site and fantasy dialects disagree
    for site, canonical in [
        ('NY', 'NYK'), ('GS', 'GSW'), ('SA', 'SAS'), ('NO', 'NOP'),
        ('UTAH', 'UTA'), ('WSH', 'WAS'), ('PHI', 'PHL'), ('PHX', 'PHO'),
    ]:
        assert team_id_for_abbr(site) == team_id_for_abbr(canonical)


def test_canonical_abbr_normalizes_site_dialect():
    assert canonical_abbr('NY') == 'NYK'
    assert canonical_abbr('GS') == 'GSW'
    assert canonical_abbr('PHI') == 'PHL'


def test_canonical_abbr_passthrough():
    assert canonical_abbr('LAL') == 'LAL'
    assert canonical_abbr('NYK') == 'NYK'
    assert canonical_abbr('???') == '???'  # unknown strings pass through


def test_roundtrip_id_abbr():
    for team_id, abbr in TEAM_ID_TO_ABBR.items():
        assert ABBR_TO_TEAM_ID[abbr] == team_id
        assert team_id_for_abbr(abbr) == team_id


def test_known_ids_match_espn():
    # spot-check the ESPN id space (fantasy PRO_TEAM_MAP agrees with these)
    assert team_id_for_abbr('ATL') == 1
    assert team_id_for_abbr('LAL') == 13
    assert team_id_for_abbr('NYK') == 18
    assert team_id_for_abbr('CHA') == 30
