import httpx
import json
import asyncio
from pathlib import Path

SEASON_ID = 2026
LEAGUE_ID = 660330196

async def explore_espn_apis():
    """Comprehensive ESPN Fantasy API exploration"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        results = {}

        # 1. Team roster with lineup slot data
        print("Testing: Team roster with lineup slots...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'teams' in data and len(data['teams']) > 0:
                first_team = data['teams'][0]
                if 'roster' in first_team and 'entries' in first_team['roster']:
                    first_entry = first_team['roster']['entries'][0]
                    results['roster_with_lineup_slots'] = {
                        'url': url,
                        'sample_entry': first_entry,
                        'keys': list(first_entry.keys())
                    }
                    print(f"[OK] Found {len(first_team['roster']['entries'])} roster entries")
                    print(f"  Keys available: {list(first_entry.keys())}")
        except Exception as e:
            print(f"[ERROR] {e}")
            results['roster_with_lineup_slots'] = {'error': str(e)}

        # 2. Schedule data (for game-by-game tracking)
        print("\nTesting: Schedule data...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mSchedule'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'schedule' in data:
                results['schedule'] = {
                    'url': url,
                    'total_matchups': len(data['schedule']),
                    'sample_matchup': data['schedule'][0] if data['schedule'] else None
                }
                print(f"[OK] Found {len(data['schedule'])} matchups")
        except Exception as e:
            print(f"[ERROR] {e}")
            results['schedule'] = {'error': str(e)}

        # 3. Live scoring with current lineup
        print("\nTesting: Live scoring data...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mLiveScoring'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'teams' in data and len(data['teams']) > 0:
                first_team = data['teams'][0]
                results['live_scoring'] = {
                    'url': url,
                    'team_keys': list(first_team.keys()),
                    'sample': {k: v for k, v in first_team.items() if k != 'roster'}
                }
                print(f"[OK] Found live scoring data")
                print(f"  Team keys: {list(first_team.keys())}")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['live_scoring'] = {'error': str(e)}

        # 4. Team transactions
        print("\nTesting: Team transactions...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mTransactions2'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'transactions' in data:
                results['transactions'] = {
                    'url': url,
                    'total_transactions': len(data['transactions']),
                    'sample_transaction': data['transactions'][0] if data['transactions'] else None
                }
                print(f"[OK] Found {len(data['transactions'])} transactions")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['transactions'] = {'error': str(e)}

        # 5. League settings (roster slot info)
        print("\nTesting: League settings...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mSettings'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'settings' in data:
                settings = data['settings']
                results['league_settings'] = {
                    'url': url,
                    'settings_keys': list(settings.keys()),
                    'roster_settings': settings.get('rosterSettings', {})
                }
                print(f"[OK] Found league settings")
                print(f"  Settings keys: {list(settings.keys())}")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['league_settings'] = {'error': str(e)}

        # 6. Current matchup period data
        print("\nTesting: Current matchup period...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mMatchup&view=mMatchupScore'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            results['matchup_period'] = {
                'url': url,
                'status_keys': list(data.get('status', {}).keys()) if 'status' in data else [],
                'scoringPeriodId': data.get('scoringPeriodId'),
                'currentMatchupPeriod': data.get('status', {}).get('currentMatchupPeriod')
            }
            print(f"[OK] Found matchup period data")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['matchup_period'] = {'error': str(e)}

        # 7. Full team data with multiple views
        print("\nTesting: Combined views for complete data...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster&view=mTeam&view=mSettings'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'teams' in data and len(data['teams']) > 0:
                team = data['teams'][0]
                if 'roster' in team and 'entries' in team['roster']:
                    entry = team['roster']['entries'][0]
                    results['combined_roster_view'] = {
                        'url': url,
                        'entry_keys': list(entry.keys()),
                        'sample_lineupSlotId': entry.get('lineupSlotId'),
                        'has_acquisitionDate': 'acquisitionDate' in entry
                    }
                    print(f"[OK] Combined view successful")
                    print(f"  Entry keys: {list(entry.keys())}")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['combined_roster_view'] = {'error': str(e)}

        # 8. Boxscore data (historical lineup usage per matchup)
        print("\nTesting: Boxscore data...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mBoxscore&view=mMatchupScore&scoringPeriodId=1'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'schedule' in data and len(data['schedule']) > 0:
                matchup = data['schedule'][0]
                results['boxscore'] = {
                    'url': url,
                    'matchup_keys': list(matchup.keys()),
                    'has_home': 'home' in matchup,
                    'has_away': 'away' in matchup
                }

                if 'home' in matchup and 'rosterForCurrentScoringPeriod' in matchup['home']:
                    home_roster = matchup['home']['rosterForCurrentScoringPeriod']
                    if 'entries' in home_roster and len(home_roster['entries']) > 0:
                        entry = home_roster['entries'][0]
                        results['boxscore']['roster_entry_keys'] = list(entry.keys())
                        results['boxscore']['sample_entry'] = entry

                print(f"[OK] Found boxscore data")
                print(f"  Matchup keys: {list(matchup.keys())}")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['boxscore'] = {'error': str(e)}

        # 9. Player injury data
        print("\nTesting: Player injury status...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=kona_player_info'
            espn_filter = {
                "players": {
                    "filterStatus": {"value": ["ONTEAM"]},
                    "limit": 10,
                    "offset": 0
                }
            }
            headers = {'X-Fantasy-Filter': json.dumps(espn_filter)}

            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            if 'players' in data and len(data['players']) > 0:
                player_entry = data['players'][0]
                player = player_entry.get('player', {})
                results['player_injury_data'] = {
                    'url': url,
                    'player_keys': list(player.keys()),
                    'has_injuryStatus': 'injuryStatus' in player,
                    'has_injured': 'injured' in player,
                    'sample_player': {k: v for k, v in player.items() if k in ['fullName', 'injuryStatus', 'injured', 'injury']}
                }
                print(f"[OK] Found player data with injury info")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['player_injury_data'] = {'error': str(e)}

        # 10. NBA Schedule from ESPN Public API
        print("\nTesting: NBA Team Schedules...")
        try:
            team_id = 1  # Hawks
            url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/schedule?season={SEASON_ID}'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if 'events' in data:
                results['nba_team_schedule'] = {
                    'url': url,
                    'total_games': len(data['events']),
                    'sample_game': data['events'][0] if data['events'] else None
                }
                print(f"[OK] Found {len(data['events'])} NBA games for team")
        except Exception as e:
            print(f"[ERROR] Error: {e}")
            results['nba_team_schedule'] = {'error': str(e)}

        # Save all results
        output_file = Path('espn_api_exploration_results.json')
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2, default=str)

        print(f"\n[DONE] Results saved to {output_file}")
        return results

if __name__ == '__main__':
    asyncio.run(explore_espn_apis())
