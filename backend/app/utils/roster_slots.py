"""Shared roster-slot configuration for this league.

Mirrored in frontend/src/utils/slotProjection.ts — keep the two in sync.
"""

SLOT_CAPS = {
    'PG': 82, 'SG': 82, 'SF': 82, 'PF': 82,
    'C': 82, 'G': 82, 'F': 82, 'UTIL': 248,
}
SLOT_NAMES = list(SLOT_CAPS.keys())
# Roster slots per column: every game day can fill each one, so UTIL gains three a day.
SLOT_MULTIPLICITY = {slot: 3 if slot == 'UTIL' else 1 for slot in SLOT_NAMES}
