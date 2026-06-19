import httpx
import json
import asyncio
from datetime import datetime

SEASON_ID = 2026
LEAGUE_ID = 660330196

async def search_for_historical_lineups():
    """Search all possible ESPN endpoints for historical lineup/slot data"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        results = {}

        # 1. Check mMatchupScore for multiple scoring periods
        print("=== TESTING mMatchupScore for historical data ===\n")
        try:
            # Try different scoring periods
            for period in [1, 50, 100, 129]:  # Early, mid, recent, very recent
                url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mMatchupScore&scoringPeriodId={period}'
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()

                if 'schedule' in data and data['schedule']:
                    print(f"Period {period}: Found {len(data['schedule'])} schedule entries")

                    # Check structure
                    sample = data['schedule'][0] if data['schedule'] else {}
                    print(f"  Keys: {list(sample.keys())}")

                    if 'home' in sample:
                        print(f"  Home keys: {list(sample['home'].keys())}")
                        if 'rosterForMatchupPeriod' in sample['home']:
                            print(f"  [FOUND] rosterForMatchupPeriod!")

                            # Save this!
                            results[f'matchup_period_{period}'] = {
                                'url': url,
                                'has_roster': True,
                                'sample': sample['home']['rosterForMatchupPeriod']
                            }

                    if 'away' in sample:
                        if 'rosterForMatchupPeriod' in sample['away']:
                            print(f"  [FOUND] Away team also has rosterForMatchupPeriod!")
                else:
                    print(f"Period {period}: No schedule data (roto league)")

        except Exception as e:
            print(f"Error with mMatchupScore: {e}")

        # 2. Try mBoxscore with different periods
        print("\n=== TESTING mBoxscore for historical data ===\n")
        try:
            for period in [1, 50, 100, 129]:
                url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mBoxscore&scoringPeriodId={period}'
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()

                if 'schedule' in data and data['schedule']:
                    print(f"Period {period}: Found boxscore data")
                    sample = data['schedule'][0] if data['schedule'] else {}

                    if 'home' in sample:
                        home_keys = list(sample['home'].keys())
                        print(f"  Home keys: {home_keys}")

                        # Look for roster-related keys
                        roster_keys = [k for k in home_keys if 'roster' in k.lower() or 'lineup' in k.lower()]
                        if roster_keys:
                            print(f"  [FOUND] Roster-related keys: {roster_keys}")

                            for rkey in roster_keys:
                                roster_data = sample['home'][rkey]
                                if isinstance(roster_data, dict) and 'entries' in roster_data:
                                    print(f"    {rkey} has 'entries' with {len(roster_data['entries'])} players")

                                    # Check first entry
                                    if roster_data['entries']:
                                        entry = roster_data['entries'][0]
                                        print(f"    Entry keys: {list(entry.keys())}")
                                        if 'lineupSlotId' in entry:
                                            print(f"    [YES!] Has lineupSlotId: {entry['lineupSlotId']}")

                                            # Check if player has stats for this period
                                            player = entry.get('playerPoolEntry', {}).get('player', {})
                                            stats = player.get('stats', [])
                                            period_stats = [s for s in stats if s.get('scoringPeriodId') == period]
                                            if period_stats:
                                                print(f"    [YES!] Has stats for period {period}")

                                            # Save this endpoint!
                                            results[f'boxscore_period_{period}'] = {
                                                'url': url,
                                                'roster_key': rkey,
                                                'has_lineup_slots': True,
                                                'has_period_stats': len(period_stats) > 0
                                            }
                else:
                    print(f"Period {period}: No boxscore data")

        except Exception as e:
            print(f"Error with mBoxscore: {e}")

        # 3. Check mRoster with historical flag
        print("\n=== TESTING mRoster variants ===\n")
        try:
            # Try with scoringPeriodId parameter
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster&scoringPeriodId=1'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            team_1 = next((t for t in data['teams'] if t['id'] == 1), None)
            if team_1 and 'roster' in team_1:
                print(f"mRoster with scoringPeriodId=1:")
                print(f"  Roster entries: {len(team_1['roster']['entries'])}")

                # Compare with current roster
                url_current = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster'
                response_current = await client.get(url_current)
                data_current = response_current.json()
                team_1_current = next((t for t in data_current['teams'] if t['id'] == 1), None)

                if team_1_current:
                    print(f"  Current roster entries: {len(team_1_current['roster']['entries'])}")

                    # Check if rosters are different
                    period1_players = {e['playerId'] for e in team_1['roster']['entries']}
                    current_players = {e['playerId'] for e in team_1_current['roster']['entries']}

                    added = current_players - period1_players
                    dropped = period1_players - current_players

                    if added or dropped:
                        print(f"  [DIFFERENT!] Roster changed since period 1")
                        print(f"    Added: {len(added)} players")
                        print(f"    Dropped: {len(dropped)} players")
                        print(f"  [YES!] Historical roster tracking is possible!")
                    else:
                        print(f"  Same players (but slots might have changed)")

                        # Check if any lineupSlotId changed
                        for entry in team_1['roster']['entries']:
                            player_id = entry['playerId']
                            period1_slot = entry['lineupSlotId']

                            current_entry = next((e for e in team_1_current['roster']['entries'] if e['playerId'] == player_id), None)
                            if current_entry:
                                current_slot = current_entry['lineupSlotId']
                                if period1_slot != current_slot:
                                    print(f"  [FOUND SLOT CHANGE!] Player {player_id}: {period1_slot} -> {current_slot}")

                results['mRoster_with_period'] = {
                    'url': url,
                    'works': True,
                    'can_track_historical_slots': True
                }

        except Exception as e:
            print(f"Error with mRoster variants: {e}")

        # 4. Check mTeam with ALL historical periods
        print("\n=== CHECKING CURRENT SCORING PERIOD ===\n")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            current_period = data.get('scoringPeriodId', 0)
            print(f"Current scoring period: {current_period}")

            results['league_info'] = {
                'current_scoring_period': current_period,
                'season_id': data.get('seasonId')
            }

        except Exception as e:
            print(f"Error getting league info: {e}")

        # Save all results
        with open('historical_lineup_research.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)

        print("\n" + "=" * 80)
        print("RESULTS SAVED to historical_lineup_research.json")
        print("=" * 80)

        return results

if __name__ == '__main__':
    asyncio.run(search_for_historical_lineups())
