import httpx
import json
import asyncio
from pathlib import Path

async def research_external_apis():
    """Research free external APIs for basketball data"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        results = {}

        # 1. BALLDONTLIE API - Free NBA Stats API
        print("\n=== TESTING BALLDONTLIE API ===")
        try:
            # Get player stats
            url = 'https://api.balldontlie.io/v1/stats?seasons[]=2025&per_page=5'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            results['balldontlie'] = {
                'url': url,
                'available': True,
                'sample': data.get('data', [])[:2] if 'data' in data else None,
                'features': [
                    'Player stats by game',
                    'Season averages',
                    'Team information',
                    'Player information'
                ],
                'rate_limit': 'Free tier available',
                'note': 'Good for historical data, player gamelogs'
            }
            print(f"[OK] BallDontLie API working")

        except Exception as e:
            print(f"[ERROR] BallDontLie: {e}")
            results['balldontlie'] = {'error': str(e), 'available': False}

        # 2. NBA.com Stats API (unofficial but free)
        print("\n=== TESTING NBA.COM STATS API ===")
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.nba.com/'
            }

            # Get league leaders
            url = 'https://stats.nba.com/stats/leagueleaders?LeagueID=00&PerMode=PerGame&Scope=S&Season=2025-26&SeasonType=Regular+Season&StatCategory=PTS'
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            leaders = []
            if 'resultSet' in data and 'rowSet' in data['resultSet']:
                for row in data['resultSet']['rowSet'][:3]:
                    leaders.append({
                        'player_id': row[0],
                        'player_name': row[2],
                        'team': row[4],
                        'ppg': row[6]
                    })

            results['nba_stats_api'] = {
                'url': 'https://stats.nba.com/stats/...',
                'available': True,
                'sample_leaders': leaders,
                'features': [
                    'Advanced stats',
                    'League leaders by category',
                    'Player tracking data',
                    'Shot charts',
                    'Plus/minus data',
                    'Usage rates'
                ],
                'note': 'Unofficial API, very comprehensive NBA data'
            }
            print(f"[OK] NBA.com Stats API working")

        except Exception as e:
            print(f"[ERROR] NBA Stats: {e}")
            results['nba_stats_api'] = {'error': str(e), 'available': False}

        # 3. ESPN Fantasy Projection API (check if accessible)
        print("\n=== TESTING ESPN PROJECTIONS ===")
        try:
            url = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026?view=proTeamSchedules_wl'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            results['espn_projections'] = {
                'url': url,
                'available': True,
                'has_schedule_data': 'settings' in data,
                'note': 'Can get team schedules, may have projection data'
            }
            print(f"[OK] ESPN team schedules accessible")

        except Exception as e:
            print(f"[ERROR] ESPN Projections: {e}")
            results['espn_projections'] = {'error': str(e)}

        # 4. Check for rest days and schedule strength
        print("\n=== ANALYZING SCHEDULE DENSITY ===")
        try:
            url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/13/schedule?season=2026'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            from datetime import datetime, timedelta

            # Analyze next 14 days
            today = datetime.now()
            two_weeks = today + timedelta(days=14)

            games_next_14 = []
            rest_days = []

            events = data.get('events', [])
            for i, event in enumerate(events):
                event_date = datetime.fromisoformat(event['date'].replace('Z', '+00:00'))

                if today <= event_date <= two_weeks:
                    games_next_14.append(event_date.date().isoformat())

                    # Calculate rest days
                    if i > 0:
                        prev_date = datetime.fromisoformat(events[i-1]['date'].replace('Z', '+00:00'))
                        rest = (event_date.date() - prev_date.date()).days - 1
                        rest_days.append(rest)

            results['schedule_density'] = {
                'url': 'Team schedule endpoint',
                'games_next_14_days': len(games_next_14),
                'avg_rest_days': sum(rest_days) / len(rest_days) if rest_days else 0,
                'note': 'Can calculate games per week, identify high-volume weeks'
            }
            print(f"[OK] Schedule density calculated")

        except Exception as e:
            print(f"[ERROR] Schedule density: {e}")
            results['schedule_density'] = {'error': str(e)}

        # 5. ESPN Player Rater/Rankings
        print("\n=== CHECKING ESPN PLAYER RATER ===")
        try:
            url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes'
            params = {'limit': 10}
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            top_athletes = []
            for athlete in data.get('athletes', [])[:5]:
                top_athletes.append({
                    'name': athlete.get('displayName'),
                    'team': athlete.get('team', {}).get('abbreviation'),
                    'position': athlete.get('position', {}).get('abbreviation')
                })

            results['espn_player_list'] = {
                'url': url,
                'available': True,
                'sample': top_athletes,
                'note': 'Can get player lists, may have ranking/rating data'
            }
            print(f"[OK] ESPN athlete data accessible")

        except Exception as e:
            print(f"[ERROR] ESPN athletes: {e}")
            results['espn_player_list'] = {'error': str(e)}

        # 6. Check ESPN game-by-game stats
        print("\n=== CHECKING GAME-BY-GAME STATS ===")
        try:
            player_id = 3992
            season = 2025
            url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/{player_id}/gamelog?season={season}'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            recent_games = []
            for event in data.get('events', [])[:3]:
                stats = event.get('statistics', [])
                if stats:
                    recent_games.append({
                        'date': event.get('gameDate'),
                        'opponent': event.get('opponent', {}).get('abbreviation'),
                        'stats': {stat['name']: stat.get('displayValue') for stat in stats if 'name' in stat}
                    })

            results['player_gamelogs'] = {
                'url': url,
                'available': True,
                'sample': recent_games,
                'features': [
                    'Game-by-game stats',
                    'Hot/cold streaks',
                    'Consistency metrics',
                    'Performance vs opponents'
                ],
                'note': 'Can analyze recent form, trending players'
            }
            print(f"[OK] Player gamelog data accessible")

        except Exception as e:
            print(f"[ERROR] Gamelogs: {e}")
            results['player_gamelogs'] = {'error': str(e)}

        # Save results
        output_file = Path('external_apis_research_results.json')
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2, default=str)

        print(f"\n[DONE] External API research complete! Results saved to {output_file}")

        return results

if __name__ == '__main__':
    asyncio.run(research_external_apis())
