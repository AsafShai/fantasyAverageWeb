import httpx
import json
import asyncio

SEASON_ID = 2026
LEAGUE_ID = 660330196

SLOT_MAP = {
    0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C',
    5: 'G', 6: 'F', 11: 'UTIL', 12: 'Bench', 13: 'IR'
}

async def analyze_team_1_slots():
    """Analyze actual slot usage for Team 1"""

    async with httpx.AsyncClient(timeout=30.0) as client:

        # Get current roster
        print("=== FETCHING TEAM 1 ROSTER ===\n")
        url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mRoster&view=mTeam'
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()

        team_1 = next((t for t in data['teams'] if t['id'] == 1), None)

        if not team_1:
            print("Team 1 not found!")
            return

        print(f"Team: {team_1['name']}\n")
        print("=" * 80)
        print(f"{'Player':<25} {'Current Slot':<12} {'Games Played':<12} {'Positions':<15}")
        print("=" * 80)

        slot_summary = {}

        for entry in team_1['roster']['entries']:
            lineup_slot_id = entry['lineupSlotId']
            slot_name = SLOT_MAP.get(lineup_slot_id, f'Unknown_{lineup_slot_id}')

            player = entry['playerPoolEntry']['player']
            player_name = player['fullName']

            # Get eligible positions
            eligible_slots = player.get('eligibleSlots', [])
            positions = ', '.join([SLOT_MAP.get(s, str(s)) for s in eligible_slots if s in SLOT_MAP])

            # Get games played from stats
            games_played = 0
            for stat in player.get('stats', []):
                if (stat.get('seasonId') == SEASON_ID and
                    stat.get('statSplitTypeId') == 0 and
                    stat.get('scoringPeriodId') == 0):
                    games_played = stat.get('stats', {}).get('42', 0)
                    break

            print(f"{player_name:<25} {slot_name:<12} {games_played:<12.0f} {positions:<15}")

            # Track slot usage
            if slot_name not in slot_summary:
                slot_summary[slot_name] = {'games': 0, 'players': []}

            slot_summary[slot_name]['games'] += games_played
            slot_summary[slot_name]['players'].append({
                'name': player_name,
                'games': games_played
            })

        # Print summary
        print("\n" + "=" * 80)
        print("SLOT USAGE SUMMARY (Based on Current Lineup)")
        print("=" * 80)

        SLOT_CAPS = {
            'PG': 82, 'SG': 82, 'SF': 82, 'PF': 82, 'C': 82,
            'G': 82, 'F': 82, 'UTIL': 246
        }

        for slot in ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']:
            if slot in slot_summary:
                games_used = slot_summary[slot]['games']
                cap = SLOT_CAPS[slot]
                remaining = cap - games_used
                pct = (games_used / cap) * 100

                status = "[OK]" if pct < 75 else "[WARN]" if pct < 90 else "[FULL]"

                print(f"{status} {slot:<6} {games_used:>5.0f} / {cap:<3} ({pct:>5.1f}%) - {remaining:>3.0f} games remaining")
            else:
                print(f"  {slot:<6}     0 / {SLOT_CAPS[slot]:<3} (  0.0%) - {SLOT_CAPS[slot]:>3} games remaining")

        if 'Bench' in slot_summary:
            print(f"\nBench: {slot_summary['Bench']['games']:.0f} games (no cap)")
        if 'IR' in slot_summary:
            print(f"IR: {slot_summary['IR']['games']:.0f} games (no cap)")

        # Important note
        print("\n" + "=" * 80)
        print("[!] IMPORTANT NOTE:")
        print("=" * 80)
        print("""
This shows games played by players CURRENTLY in each slot.
This is NOT accurate for slot usage tracking because:

1. Players move between slots throughout the season
2. We need HISTORICAL lineup decisions (which slot was used each day)
3. Current API shows only the current snapshot

To get TRUE slot usage, we need:
- Historical lineup data per scoring period/day
- OR: Track lineup changes via mBoxscore endpoint for each past week
- OR: Store daily lineup snapshots in our database going forward

ESPN's mBoxscore endpoint MAY have historical lineup data.
Let me check that next...
        """)

        # Check if boxscore has historical data
        print("\n" + "=" * 80)
        print("CHECKING BOXSCORE FOR HISTORICAL LINEUP DATA...")
        print("=" * 80)

        try:
            # Try getting boxscore for scoring period 1
            url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON_ID}/segments/0/leagues/{LEAGUE_ID}?view=mBoxscore&scoringPeriodId=1'
            response = await client.get(url)
            response.raise_for_status()
            boxscore_data = response.json()

            print(f"\nBoxscore data structure:")
            if 'schedule' in boxscore_data and boxscore_data['schedule']:
                print(f"- Found {len(boxscore_data['schedule'])} matchup entries")

                # Save sample to file for inspection
                with open('boxscore_sample.json', 'w') as f:
                    json.dump(boxscore_data['schedule'][0] if boxscore_data['schedule'] else {}, f, indent=2)
                print("- Saved sample to boxscore_sample.json")

                # Check if it has roster data
                if boxscore_data['schedule']:
                    first_matchup = boxscore_data['schedule'][0]
                    print(f"- Matchup keys: {list(first_matchup.keys())}")

                    if 'home' in first_matchup:
                        print(f"- Home team keys: {list(first_matchup['home'].keys())}")
                        if 'rosterForCurrentScoringPeriod' in first_matchup['home']:
                            print("  [YES] HAS ROSTER DATA FOR THAT SCORING PERIOD!")
                        else:
                            print("  [NO] No roster data in boxscore")
            else:
                print("- No schedule data in boxscore (might be roto league without matchups)")

        except Exception as e:
            print(f"Error checking boxscore: {e}")

if __name__ == '__main__':
    asyncio.run(analyze_team_1_slots())
