import httpx
import asyncio
import json

SEASON_ID = 2026
LEAGUE_ID = 660330196

SLOT_MAP = {
    0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C',
    5: 'G', 6: 'F', 11: 'UTIL'
}

SLOT_CAPS = {
    'PG': 82, 'SG': 82, 'SF': 82, 'PF': 82, 'C': 82,
    'G': 82, 'F': 82, 'UTIL': 246
}

async def test_slot_usage_endpoint():
    """Test the discovered endpoint with statBySlot"""

    async with httpx.AsyncClient(timeout=30.0) as client:

        # Full URL from your friend
        url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?rosterForTeamId=8&view=mDraftDetail&view=mLiveScoring&view=mMatchupScore&view=mPendingTransactions&view=mPositionalRatings&view=mRoster&view=mSettings&view=mTeam&view=modular&view=mNav&platformVersion=1f1f522282762971f1c0668e1cc445d5aea7dc01'

        print("="*80)
        print("TESTING DISCOVERED ENDPOINT WITH statBySlot")
        print("="*80)

        response = await client.get(url)
        response.raise_for_status()
        data = response.json()

        # Navigate to schedule[0].teams
        schedule = data.get('schedule', [])
        if not schedule:
            print("ERROR: No schedule data!")
            return

        teams = schedule[0].get('teams', [])
        print(f"\nFound {len(teams)} teams in schedule[0].teams")

        # Find Team 1 (Asaf)
        asaf_team = next((t for t in teams if t['teamId'] == 1), None)

        if not asaf_team:
            print("ERROR: Team 1 not found!")
            return

        print("\n" + "="*80)
        print("TEAM 1 (Asaf's Astounding Team) - SLOT USAGE")
        print("="*80)

        # Get statBySlot
        cumulative_score = asaf_team.get('cumulativeScore', {})
        stat_by_slot = cumulative_score.get('statBySlot', {})

        if not stat_by_slot:
            print("ERROR: No statBySlot data!")
            return

        # Display slot usage
        for slot_id in sorted([int(s) for s in stat_by_slot.keys()]):
            slot_str = str(slot_id)
            slot_data = stat_by_slot[slot_str]
            slot_name = SLOT_MAP.get(slot_id, f'Unknown_{slot_id}')

            games_used = slot_data.get('value', 0)
            limit_exceeded = slot_data.get('limitExceeded', False)
            exceeded_period = slot_data.get('exceededOnScoringPeriod', 0)

            cap = SLOT_CAPS.get(slot_name, 0)
            remaining = cap - games_used
            pct = (games_used / cap) * 100 if cap > 0 else 0

            status = "[OK]" if pct < 75 else "[WARN]" if pct < 90 else "[FULL]"
            exceed_mark = " [EXCEEDED!]" if limit_exceeded else ""

            print(f"{status} {slot_name:<6} {games_used:>5.0f} / {cap:<3} ({pct:>5.1f}%) - {remaining:>3.0f} remaining{exceed_mark}")

        # Test minimal views
        print("\n" + "="*80)
        print("TESTING MINIMAL VIEWS (Optimizing Request)")
        print("="*80)

        # Try with just essential views
        minimal_views = [
            'mMatchupScore',  # This might have statBySlot
            'mLiveScoring',   # This might also have it
        ]

        for view_combo in [
            'mMatchupScore',
            'mLiveScoring',
            'mMatchupScore&view=mLiveScoring',
        ]:
            try:
                test_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view={view_combo}'

                response = await client.get(test_url)
                response.raise_for_status()
                data = response.json()

                # Check if statBySlot exists
                has_stat_by_slot = False
                if 'schedule' in data and data['schedule']:
                    teams = data['schedule'][0].get('teams', [])
                    if teams:
                        first_team = teams[0]
                        cum_score = first_team.get('cumulativeScore', {})
                        has_stat_by_slot = 'statBySlot' in cum_score

                size_kb = len(json.dumps(data)) / 1024
                result = "[YES]" if has_stat_by_slot else "[NO]"

                print(f"{result} {view_combo:<40} ({size_kb:.1f} KB)")

            except Exception as e:
                print(f"[ERROR] {view_combo:<40} - {str(e)[:50]}")

        # Test without rosterForTeamId
        print("\n" + "="*80)
        print("TESTING WITHOUT rosterForTeamId (All teams at once)")
        print("="*80)

        try:
            simple_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mMatchupScore'

            response = await client.get(simple_url)
            response.raise_for_status()
            data = response.json()

            if 'schedule' in data and data['schedule']:
                teams = data['schedule'][0].get('teams', [])
                print(f"[YES] Got {len(teams)} teams with ONE request!")

                # Show sample for Team 1
                asaf_team = next((t for t in teams if t['teamId'] == 1), None)
                if asaf_team:
                    stat_by_slot = asaf_team['cumulativeScore']['statBySlot']
                    print(f"[YES] Team 1 has statBySlot with {len(stat_by_slot)} slots")

                    size_kb = len(json.dumps(data)) / 1024
                    print(f"\nResponse size: {size_kb:.1f} KB")
                    print("\nTHIS IS THE WINNER! Single request for all teams!")

        except Exception as e:
            print(f"[ERROR] {e}")

if __name__ == '__main__':
    asyncio.run(test_slot_usage_endpoint())
