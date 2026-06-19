import httpx
import json
import asyncio

SEASON_ID = 2026
LEAGUE_ID = 660330196
TEAM_ID = 1

async def reverse_engineer_slot_usage():
    """
    Reverse engineer how ESPN calculates slot usage by testing every possible endpoint
    """

    async with httpx.AsyncClient(timeout=30.0) as client:
        results = {}

        print("=" * 80)
        print("REVERSE ENGINEERING ESPN SLOT USAGE CALCULATION")
        print("=" * 80)

        # Test EVERY possible view combination that might contain slot usage
        views_to_test = [
            # Standard views
            'mRoster',
            'mTeam',
            'mSettings',

            # Scoring/stats views
            'mLiveScoring',
            'mMatchupScore',
            'mBoxscore',
            'mScoreboard',

            # Status views
            'mStatus',
            'mStandings',
            'mRankings',

            # Team specific views
            'mTeamProfile',
            'mTeamSettings',
            'mTeamRoster',

            # Position/lineup views
            'mPositions',
            'mLineup',
            'mRosterByPosition',
            'mSlotTracking',
            'mPositionStats',
            'mPositionUsage',
            'mGameUsage',
            'mSlotLimits',

            # Period/schedule views
            'mSchedule',
            'mMatchup',
            'mMatchupPeriod',

            # Stats views
            'mStats',
            'mPlayerStats',
            'mTeamStats',

            # Projections
            'mProjections',

            # Transactions
            'mTransactions',
            'mTransactions2',

            # Combined views (might be what ESPN uses!)
            'mRoster,mSettings,mTeam',
            'mLiveScoring,mTeam,mSettings',
            'mRoster,mBoxscore',
            'mRoster,mMatchupScore',
        ]

        print(f"\nTesting {len(views_to_test)} view combinations...")
        print()

        for view in views_to_test:
            try:
                # Build URL with view
                url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view={view}'

                # Add teamId parameter for team-specific views
                if any(x in view for x in ['Team', 'Roster', 'Lineup']):
                    url += f'&teamId={TEAM_ID}'

                response = await client.get(url, timeout=10)

                if response.status_code == 200:
                    data = response.json()
                    data_str = json.dumps(data)

                    # Check for slot usage keywords
                    keywords = [
                        'slotusage', 'slot_usage', 'gamesused', 'games_used',
                        'positionusage', 'position_usage', 'slotstats', 'slot_stats',
                        'gamesperslot', 'games_per_slot', 'slotlimit', 'slot_limit',
                        'usedgames', 'used_games', 'gamestracked', 'games_tracked'
                    ]

                    found_keywords = [kw for kw in keywords if kw in data_str.lower()]

                    if found_keywords:
                        print(f"[!!!] {view}")
                        print(f"      Found keywords: {found_keywords}")

                        # Save this response for inspection
                        filename = f"view_{view.replace(',', '_')}.json"
                        with open(filename, 'w') as f:
                            json.dump(data, f, indent=2)
                        print(f"      Saved to {filename}")

                        results[view] = {
                            'url': url,
                            'found_keywords': found_keywords,
                            'file': filename
                        }
                    else:
                        # Check response size - larger responses might have the data
                        if len(data_str) > 10000:
                            print(f"[OK] {view:<40} (large response: {len(data_str)} chars)")
                        else:
                            print(f"    {view:<40} ({len(data_str)} chars)")

                elif response.status_code == 404:
                    print(f"    {view:<40} [404 - not found]")
                else:
                    print(f"    {view:<40} [{response.status_code}]")

            except Exception as e:
                error_msg = str(e)[:50]
                print(f"    {view:<40} [ERROR: {error_msg}]")

        # Now test with specific query parameters
        print("\n" + "=" * 80)
        print("TESTING WITH QUERY PARAMETERS")
        print("=" * 80 + "\n")

        params_to_test = [
            {'forTeamId': TEAM_ID},
            {'teamId': TEAM_ID},
            {'includeSlotUsage': 'true'},
            {'includePositionStats': 'true'},
            {'includeGameUsage': 'true'},
            {'detailed': 'true'},
            {'stats': 'true'},
        ]

        base_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster'

        for params in params_to_test:
            try:
                response = await client.get(base_url, params=params)

                if response.status_code == 200:
                    data = response.json()
                    # Check if response changed with this parameter
                    param_str = '&'.join([f"{k}={v}" for k, v in params.items()])
                    print(f"[OK] {param_str:<40} ({len(json.dumps(data))} chars)")
                else:
                    print(f"    {param_str:<40} [{response.status_code}]")
            except Exception as e:
                print(f"    {param_str:<40} [ERROR]")

        # Check if there's a team-specific endpoint
        print("\n" + "=" * 80)
        print("TESTING TEAM-SPECIFIC ENDPOINTS")
        print("=" * 80 + "\n")

        team_endpoints = [
            f'/teams/{TEAM_ID}',
            f'/teams/{TEAM_ID}/roster',
            f'/teams/{TEAM_ID}/stats',
            f'/teams/{TEAM_ID}/usage',
            f'/teams/{TEAM_ID}/slotusage',
        ]

        base = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}'

        for endpoint in team_endpoints:
            try:
                url = base + endpoint
                response = await client.get(url, timeout=5)

                if response.status_code == 200:
                    print(f"[FOUND!] {endpoint}")
                    data = response.json()

                    filename = f"team_endpoint{endpoint.replace('/', '_')}.json"
                    with open(filename, 'w') as f:
                        json.dump(data, f, indent=2)
                    print(f"         Saved to {filename}")
                elif response.status_code == 404:
                    print(f"    {endpoint:<40} [404]")
                else:
                    print(f"    {endpoint:<40} [{response.status_code}]")
            except Exception as e:
                print(f"    {endpoint:<40} [ERROR]")

        # Save summary
        print("\n" + "=" * 80)
        print("SUMMARY")
        print("=" * 80)

        if results:
            print(f"\nFound {len(results)} promising endpoints with slot usage keywords!")
            for view, info in results.items():
                print(f"  - {view}: {info['found_keywords']}")
        else:
            print("\nNo endpoints found with slot usage keywords.")
            print("\nConclusion:")
            print("  ESPN likely calculates slot usage CLIENT-SIDE using:")
            print("  1. Current roster data (mRoster)")
            print("  2. Looping through scoring periods")
            print("  3. JavaScript calculation in the browser")
            print("\n  This means we need to implement the calculation ourselves.")

        with open('reverse_engineering_results.json', 'w') as f:
            json.dump(results, f, indent=2)

if __name__ == '__main__':
    asyncio.run(reverse_engineer_slot_usage())
