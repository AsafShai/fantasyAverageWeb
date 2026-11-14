import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.exceptions import DataSourceError
from app.services import league_activity_service as las
from app.services.league_activity_service import (
    LeagueActivityService,
    build_player_moves,
    merge_card_transactions,
    player_stints,
)

FIXTURE = json.loads((Path(__file__).parent.parent / 'fixtures' / 'league_activity_2026_trimmed.json').read_text())
ME, OTHER, IN_TRADE, DROPPED_FOR_ME = 100, 200, 300, 400
NAMES = {ME: 'Me', OTHER: 'Other', IN_TRADE: 'Trade Partner', DROPPED_FOR_ME: 'Bench Guy'}


def item(kind, pid, frm, to, **extra):
    return {'type': kind, 'playerId': pid, 'fromTeamId': frm, 'toTeamId': to, **extra}


def tx(tx_id, kind, ms, *items, status='EXECUTED'):
    return {'id': tx_id, 'type': kind, 'status': status, 'proposedDate': ms, 'items': list(items)}


SEASON = [
    tx('d', 'DRAFT', 1_000, item('DRAFT', ME, 0, 1, overallPickNumber=26)),
    # standalone drop with a lineup move for someone else riding along
    tx('r', 'ROSTER', 2_000, item('LINEUP', OTHER, 1, 1), item('DROP', ME, 1, 0)),
    tx('w', 'WAIVER', 3_000, item('ADD', ME, 0, 2), item('DROP', DROPPED_FOR_ME, 2, 0)),
    tx('lineup', 'ROSTER', 3_500, item('LINEUP', ME, 2, 2)),
    tx('t', 'TRADE_ACCEPT', 4_000,
       item('TRADE', ME, 2, 3), item('TRADE', IN_TRADE, 3, 2), item('DROP', OTHER, 3, 0)),
    tx('pending', 'TRADE_ACCEPT', 5_000, item('TRADE', ME, 3, 1), status='PENDING'),
    tx('f', 'FREEAGENT', 6_000, item('ADD', OTHER, 0, 3), item('DROP', ME, 3, 0)),
    tx('a', 'FREEAGENT', 7_000, item('ADD', ME, 0, 4)),
]


def test_moves_cover_draft_adds_drops_and_trades_only():
    moves = build_player_moves(ME, list(reversed(SEASON)), NAMES, num_teams=12)
    assert [m.kind for m in moves] == ['draft', 'drop', 'waiver', 'trade', 'drop', 'add']
    draft, standalone, claim, trade, drop, add = moves
    assert (draft.team_id, draft.pick, draft.round) == (1, 26, 3)
    assert (standalone.team_id, standalone.swapped) == (1, [])
    assert claim.team_id == 2 and [p.name for p in claim.swapped] == ['Bench Guy']
    assert (trade.team_id, trade.from_team_id) == (3, 2)
    assert {s.team_id: [p.player_id for p in s.players] for s in trade.trade_sides} == {3: [ME], 2: [IN_TRADE]}
    assert [(d.team_id, [p.player_id for p in d.players]) for d in trade.trade_drops] == [(3, [OTHER])]
    assert drop.team_id == 3 and [p.name for p in drop.swapped] == ['Other'] and not drop.in_trade
    assert add.team_id == 4 and add.swapped == []
    assert draft.at == datetime.fromtimestamp(1, tz=timezone.utc)


def test_drop_to_make_room_in_a_trade_is_flagged():
    moves = build_player_moves(OTHER, SEASON, NAMES, num_teams=12)
    trade_drop = next(m for m in moves if m.id == 't')
    assert (trade_drop.kind, trade_drop.team_id, trade_drop.in_trade) == ('drop', 3, True)


def test_stints_follow_the_moves():
    stints = player_stints(build_player_moves(ME, SEASON, NAMES, num_teams=12))
    ms = lambda s: (s.team_id, s.start.timestamp() * 1000, s.end and s.end.timestamp() * 1000)
    assert [ms(s) for s in stints] == [
        (1, 1_000, 2_000), (2, 3_000, 4_000), (3, 4_000, 6_000), (4, 7_000, None),
    ]


def test_player_with_no_moves():
    assert build_player_moves(999, SEASON, NAMES, num_teams=12) == []
    assert player_stints([]) == []


def test_real_trade_lists_both_sides():
    txs, names = merge_card_transactions(FIXTURE['cards'])
    mobley = 4432158
    moves = build_player_moves(mobley, txs, names, num_teams=12)
    assert [m.kind for m in moves] == ['draft', 'trade', 'drop']
    trade = moves[1]
    assert (trade.from_team_id, trade.team_id) == (1, 8)
    sides = {s.team_id: sorted(p.player_id for p in s.players) for s in trade.trade_sides}
    assert sides == {8: [mobley], 1: sorted([3908845, 4066261])}
    assert [(d.team_id, [p.player_id for p in d.players]) for d in trade.trade_drops] == [(1, [2991139])]
    assert all(p.name and not p.name.startswith('Player ') for s in trade.trade_sides for p in s.players)


@pytest.fixture
def fresh_cache():
    las._cache.clear()
    yield
    las._cache.clear()


@pytest.mark.asyncio
async def test_service_reads_cards_only(fresh_cache):
    service = LeagueActivityService(season_id=2026, league_id=1)
    responses = {'league': FIXTURE['league'], 'cards': {'players': FIXTURE['cards']}}

    async def fake_get(params, fantasy_filter=None, url=None, etag_key=None):
        return responses[etag_key]

    with patch.object(service, '_get', side_effect=fake_get) as get:
        history = await service.get_player_history(4432158)
        again = await service.get_player_history(4432158)
    assert get.call_count == 2  # league + cards once; the second call is served from cache
    assert [m.kind for m in history.moves] == ['draft', 'trade', 'drop']
    assert [s.team_id for s in history.stints] == [1, 8]
    assert history.stints[-1].end is not None
    assert {t.team_id for t in history.teams} >= {1, 8}
    assert again.moves == history.moves


@pytest.mark.asyncio
async def test_service_raises_when_espn_is_down_and_nothing_cached(fresh_cache):
    service = LeagueActivityService(season_id=2026, league_id=1)
    with patch.object(service, '_get', AsyncMock(side_effect=httpx.ConnectError('down'))):
        with pytest.raises(DataSourceError):
            await service.get_player_history(1)
