import httpx
import json
import asyncio
from pathlib import Path
from collections import defaultdict

SEASON_ID = 2026
LEAGUE_ID = 660330196

LINEUP_SLOT_MAP = {
    0: 'PG',
    1: 'SG',
    2: 'SF',
    3: 'PF',
    4: 'C',
    5: 'G',
    6: 'F',
    11: 'UTIL',
    12: 'Bench',
    13: 'IR'
}

async def deep_research():
    """Deep dive into ESPN APIs for fantasy-relevant data"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        results = {}

        # 1. SLOT USAGE TRACKING - Get current roster with lineup slots
        print("\n=== ANALYZING SLOT USAGE ===")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster&view=mTeam'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            slot_analysis = defaultdict(lambda: {'count': 0, 'games_used': 0, 'players': []})

            for team in data.get('teams', []):
                team_id = team['id']
                team_name = team.get('name', 'Unknown')

                if 'roster' in team and 'entries' in team['roster']:
                    for entry in team['roster']['entries']:
                        lineup_slot_id = entry.get('lineupSlotId')
                        player_id = entry.get('playerId')

                        player_data = entry.get('playerPoolEntry', {}).get('player', {})
                        player_name = player_data.get('fullName', 'Unknown')

                        # Get games played from stats
                        games_played = 0
                        for stat in player_data.get('stats', []):
                            if (stat.get('seasonId') == SEASON_ID and
                                stat.get('statSplitTypeId') == 0 and
                                stat.get('scoringPeriodId') == 0):
                                games_played = stat.get('stats', {}).get('42', 0)
                                break

                        slot_name = LINEUP_SLOT_MAP.get(lineup_slot_id, f'Unknown_{lineup_slot_id}')
                        slot_analysis[f"{team_name}_{slot_name}"]['count'] += 1
                        slot_analysis[f"{team_name}_{slot_name}"]['games_used'] += games_played
                        slot_analysis[f"{team_name}_{slot_name}"]['players'].append({
                            'name': player_name,
                            'games_played': games_played
                        })

            results['slot_usage_analysis'] = {
                'url': url,
                'sample_data': dict(list(slot_analysis.items())[:3]),
                'note': 'Can track games used per slot to ensure staying under 82-game cap'
            }
            print(f"[OK] Analyzed slot usage for {len(data.get('teams', []))} teams")

        except Exception as e:
            print(f"[ERROR] Slot usage: {e}")
            results['slot_usage_analysis'] = {'error': str(e)}

        # 2. TRANSACTIONS HISTORY - Find waiver wire trends
        print("\n=== ANALYZING TRANSACTION TRENDS ===")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mTransactions2'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            transaction_types = defaultdict(int)
            player_activity = defaultdict(int)

            for trans in data.get('transactions', []):
                trans_type = trans.get('type', 'UNKNOWN')
                transaction_types[trans_type] += 1

                for item in trans.get('items', []):
                    player_id = item.get('playerId')
                    if player_id:
                        player_activity[player_id] += 1

            # Get most added/dropped players
            most_active_players = sorted(player_activity.items(), key=lambda x: x[1], reverse=True)[:10]

            results['transaction_trends'] = {
                'url': url,
                'transaction_types': dict(transaction_types),
                'most_active_players': most_active_players,
                'note': 'Can show hot waiver wire players, most added/dropped'
            }
            print(f"[OK] Found {len(data.get('transactions', []))} transactions")

        except Exception as e:
            print(f"[ERROR] Transactions: {e}")
            results['transaction_trends'] = {'error': str(e)}

        # 3. PLAYER POOL WITH OWNERSHIP DATA
        print("\n=== ANALYZING PLAYER POOL ===")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=kona_player_info'

            espn_filter = {
                "players": {
                    "filterStatus": {"value": ["FREEAGENT"]},
                    "sortPercOwned": {"sortPriority": 1, "sortAsc": False},
                    "limit": 50,
                    "offset": 0
                }
            }
            headers = {'X-Fantasy-Filter': json.dumps(espn_filter)}

            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            top_available = []
            for player_entry in data.get('players', [])[:10]:
                player = player_entry.get('player', {})
                ownership = player.get('ownership', {})

                top_available.append({
                    'name': player.get('fullName'),
                    'percent_owned': ownership.get('percentOwned', 0),
                    'percent_started': ownership.get('percentStarted', 0),
                    'avg_draft_position': ownership.get('averageDraftPosition', 0)
                })

            results['top_available_players'] = {
                'url': url,
                'sample_players': top_available,
                'note': 'Can show best available players by league-wide ownership'
            }
            print(f"[OK] Found {len(data.get('players', []))} free agents")

        except Exception as e:
            print(f"[ERROR] Player pool: {e}")
            results['top_available_players'] = {'error': str(e)}

        # 4. NBA INJURY REPORT (ESPN Public API)
        print("\n=== CHECKING NBA INJURY REPORT ===")
        try:
            url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            injuries_found = []
            for article in data.get('articles', [])[:5]:
                if 'injur' in article.get('headline', '').lower() or 'out' in article.get('headline', '').lower():
                    injuries_found.append({
                        'headline': article.get('headline'),
                        'description': article.get('description', '')[:100]
                    })

            results['nba_injury_news'] = {
                'url': url,
                'sample': injuries_found,
                'note': 'Can aggregate injury news from ESPN'
            }
            print(f"[OK] Found injury-related news")

        except Exception as e:
            print(f"[ERROR] Injury news: {e}")
            results['nba_injury_news'] = {'error': str(e)}

        # 5. PLAYER NEWS/UPDATES
        print("\n=== CHECKING PLAYER NEWS API ===")
        try:
            player_id = 3992  # Example: James Harden
            url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/{player_id}/news'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            news_items = []
            for article in data.get('articles', [])[:3]:
                news_items.append({
                    'headline': article.get('headline'),
                    'published': article.get('published')
                })

            results['player_news'] = {
                'url': url,
                'sample': news_items,
                'note': 'Can fetch player-specific news and updates'
            }
            print(f"[OK] Found player news")

        except Exception as e:
            print(f"[ERROR] Player news: {e}")
            results['player_news'] = {'error': str(e)}

        # 6. NBA TEAM SCHEDULES - Strength of Schedule
        print("\n=== ANALYZING NBA SCHEDULES ===")
        try:
            team_schedules = {}
            sample_teams = [1, 13]  # Hawks, Lakers

            for nba_team_id in sample_teams:
                url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{nba_team_id}/schedule?season={SEASON_ID}'
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()

                # Analyze schedule
                from datetime import datetime
                upcoming_games = []
                back_to_backs = 0

                events = data.get('events', [])
                for i, event in enumerate(events):
                    event_date = datetime.fromisoformat(event['date'].replace('Z', '+00:00'))
                    if event_date.date() > datetime.now().date():
                        upcoming_games.append(event_date.date().isoformat())

                        if i > 0:
                            prev_date = datetime.fromisoformat(events[i-1]['date'].replace('Z', '+00:00'))
                            if (event_date.date() - prev_date.date()).days == 1:
                                back_to_backs += 1

                        if len(upcoming_games) >= 7:
                            break

                team_schedules[nba_team_id] = {
                    'next_7_days': upcoming_games,
                    'back_to_backs_remaining': back_to_backs
                }

            results['schedule_analysis'] = {
                'url': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/schedule',
                'sample_data': team_schedules,
                'note': 'Can show games remaining, back-to-backs, strength of schedule'
            }
            print(f"[OK] Analyzed schedules for {len(sample_teams)} teams")

        except Exception as e:
            print(f"[ERROR] Schedule analysis: {e}")
            results['schedule_analysis'] = {'error': str(e)}

        # 7. ESPN SCOREBOARD - Live game data
        print("\n=== CHECKING LIVE SCOREBOARD ===")
        try:
            url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            live_games = []
            for event in data.get('events', [])[:3]:
                competitions = event.get('competitions', [{}])[0]
                status = competitions.get('status', {})

                live_games.append({
                    'name': event.get('name'),
                    'status': status.get('type', {}).get('description'),
                    'period': status.get('period'),
                    'clock': status.get('displayClock')
                })

            results['live_scoreboard'] = {
                'url': url,
                'sample_games': live_games,
                'note': 'Can show live game status, useful for real-time lineup decisions'
            }
            print(f"[OK] Found live scoreboard data")

        except Exception as e:
            print(f"[ERROR] Scoreboard: {e}")
            results['live_scoreboard'] = {'error': str(e)}

        # 8. STANDINGS WITH TEAM RECORDS
        print("\n=== CHECKING NBA STANDINGS ===")
        try:
            url = f'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season={SEASON_ID}'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            team_records = []
            for conf in data.get('children', [])[:1]:
                for entry in conf.get('standings', {}).get('entries', [])[:3]:
                    team_name = entry.get('team', {}).get('displayName')
                    stats = entry.get('stats', [])

                    wins = stats[14].get('value', 0) if len(stats) > 14 else 0
                    losses = stats[6].get('value', 0) if len(stats) > 6 else 0

                    team_records.append({
                        'team': team_name,
                        'wins': wins,
                        'losses': losses
                    })

            results['nba_standings'] = {
                'url': url,
                'sample_records': team_records,
                'note': 'Can show NBA team performance, correlate with player stats'
            }
            print(f"[OK] Found NBA standings")

        except Exception as e:
            print(f"[ERROR] Standings: {e}")
            results['nba_standings'] = {'error': str(e)}

        # 9. HISTORICAL MATCHUP DATA
        print("\n=== CHECKING HISTORICAL MATCHUPS ===")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mSchedule'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            matchup_history = []
            for matchup in data.get('schedule', [])[:3]:
                matchup_period = matchup.get('matchupPeriodId')
                matchup_history.append({
                    'matchup_period': matchup_period,
                    'winner': matchup.get('winner'),
                    'playoff': matchup.get('playoff', False)
                })

            results['matchup_history'] = {
                'url': url,
                'sample': matchup_history,
                'note': 'Historical matchups - less relevant for roto but could show timeline'
            }
            print(f"[OK] Found {len(data.get('schedule', []))} matchup periods")

        except Exception as e:
            print(f"[ERROR] Matchup history: {e}")
            results['matchup_history'] = {'error': str(e)}

        # 10. DRAFT RECAP
        print("\n=== CHECKING DRAFT RECAP ===")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mDraftDetail'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            draft_data = data.get('draftDetail', {})
            results['draft_recap'] = {
                'url': url,
                'draft_exists': draft_data is not None,
                'picked_count': len(draft_data.get('picks', [])) if draft_data else 0,
                'note': 'Can show draft results, keeper values, draft grades'
            }
            print(f"[OK] Found draft data")

        except Exception as e:
            print(f"[ERROR] Draft data: {e}")
            results['draft_recap'] = {'error': str(e)}

        # Save results
        output_file = Path('deep_espn_research_results.json')
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2, default=str)

        print(f"\n[DONE] Deep research complete! Results saved to {output_file}")

        return results

if __name__ == '__main__':
    asyncio.run(deep_research())
