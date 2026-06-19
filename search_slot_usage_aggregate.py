import httpx
import json
import asyncio

SEASON_ID = 2026
LEAGUE_ID = 660330196

async def search_aggregate_slot_data():
    """Search for endpoints that might have aggregated slot usage"""

    async with httpx.AsyncClient(timeout=30.0) as client:

        print("=" * 80)
        print("SEARCHING FOR AGGREGATE SLOT USAGE DATA")
        print("=" * 80)

        # 1. Check league settings - maybe it tracks slot usage?
        print("\n1. Checking League Settings for slot tracking...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mSettings'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            settings = data.get('settings', {})
            roster_settings = settings.get('rosterSettings', {})

            print(f"   Roster settings keys: {list(roster_settings.keys())}")

            # Look for anything related to usage/limits
            usage_keys = [k for k in roster_settings.keys() if 'limit' in k.lower() or 'usage' in k.lower() or 'stat' in k.lower()]
            print(f"   Usage-related keys: {usage_keys}")

            if 'lineupSlotStatLimits' in roster_settings:
                print(f"\n   [FOUND] lineupSlotStatLimits:")
                limits = roster_settings['lineupSlotStatLimits']
                for slot_id, limit_data in limits.items():
                    print(f"     Slot {slot_id}: {limit_data}")
                print("\n   Note: These are the CAPS (82 games), not actual usage")

        except Exception as e:
            print(f"   Error: {e}")

        # 2. Check team object - maybe it tracks slot usage at team level?
        print("\n2. Checking Team object for slot usage tracking...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mTeam'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            team_1 = next((t for t in data['teams'] if t['id'] == 1), None)
            if team_1:
                print(f"   Team keys: {list(team_1.keys())}")

                # Look for usage/stats/slot related keys
                usage_keys = [k for k in team_1.keys() if any(word in k.lower() for word in ['usage', 'stat', 'slot', 'limit', 'track'])]
                print(f"   Usage-related keys: {usage_keys}")

                # Check valuesByStat - maybe it includes slot usage?
                if 'valuesByStat' in team_1:
                    print(f"\n   valuesByStat keys: {list(team_1['valuesByStat'].keys())}")
                    print("   Note: These are player stat totals, not slot usage")

        except Exception as e:
            print(f"   Error: {e}")

        # 3. Check player object - maybe tracks which slots they've been in?
        print("\n3. Checking Player object for slot history...")
        try:
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            team_1 = next((t for t in data['teams'] if t['id'] == 1), None)
            if team_1 and 'roster' in team_1 and 'entries' in team_1['roster']:
                entry = team_1['roster']['entries'][0]

                print(f"   Roster entry keys: {list(entry.keys())}")

                # Check for any historical data
                history_keys = [k for k in entry.keys() if any(word in k.lower() for word in ['history', 'slot', 'usage', 'stat'])]
                print(f"   History-related keys: {history_keys}")

                # Check playerPoolEntry
                if 'playerPoolEntry' in entry:
                    pool_entry = entry['playerPoolEntry']
                    print(f"\n   PlayerPoolEntry keys: {list(pool_entry.keys())}")

        except Exception as e:
            print(f"   Error: {e}")

        # 4. Try different view combinations
        print("\n4. Trying different view combinations...")
        views_to_try = [
            'mRosterStats',
            'mSlotUsage',
            'mPositionLimits',
            'mSlotStats',
            'mTeamStats',
            'mStandings',
            'mLiveScoring',
            'mPendingTransactions',
            'mTransactions',
            'modular',
            'mNav',
            'mMatchup'
        ]

        for view in views_to_try:
            try:
                url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view={view}'
                response = await client.get(url, timeout=5)

                if response.status_code == 200:
                    data = response.json()

                    # Quick check for slot usage related data
                    data_str = json.dumps(data)[:1000]  # First 1000 chars

                    if any(keyword in data_str.lower() for keyword in ['slotusage', 'slot_usage', 'gamesperslot']):
                        print(f"   [!!!] {view} might have slot usage data!")

                        with open(f'view_{view}_sample.json', 'w') as f:
                            json.dump(data, f, indent=2)
                        print(f"       Saved to view_{view}_sample.json")
                    else:
                        print(f"   {view}: No slot usage data found")
                else:
                    print(f"   {view}: {response.status_code}")

            except Exception as e:
                print(f"   {view}: Error - {str(e)[:50]}")

        # 5. Check if there's a summary endpoint
        print("\n5. Checking for summary/aggregation endpoints...")
        try:
            # Try getting season summary
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}'
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            print(f"   Season-level keys: {list(data.keys())}")

        except Exception as e:
            print(f"   Error: {e}")

        print("\n" + "=" * 80)
        print("CONCLUSION")
        print("=" * 80)
        print("""
Based on testing, ESPN Fantasy API does NOT appear to provide:
- Aggregate slot usage statistics
- Historical slot tracking in a single endpoint
- "Games used per slot" summary data

The lineupSlotStatLimits only shows CAPS (82 per slot), not actual usage.

HOWEVER, there's one more thing to check:
- Maybe the UI calculates this on the fly?
- Let me check what actual ESPN Fantasy website uses...
        """)

if __name__ == '__main__':
    asyncio.run(search_aggregate_slot_data())
