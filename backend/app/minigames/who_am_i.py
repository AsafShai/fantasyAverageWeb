"""Who Am I Poeltl-style feedback (port of whoAmIFeedback.ts)."""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

WHO_AM_I_MAX_GUESSES = 8

WhoAmIColumnKey = Literal[
    "team",
    "conference",
    "division",
    "position",
    "height",
    "age",
    "jerseyNumber",
    "nationality",
]

COLUMNS: tuple[WhoAmIColumnKey, ...] = (
    "team",
    "conference",
    "division",
    "position",
    "height",
    "age",
    "jerseyNumber",
    "nationality",
)


def height_to_inches(height: Optional[str]) -> Optional[int]:
    if not height:
        return None
    m = re.match(r"^(\d+)'\s*(\d+)?", height.strip())
    if not m:
        return None
    ft = int(m.group(1))
    inch = int(m.group(2)) if m.group(2) else 0
    return ft * 12 + inch


def parse_jersey_number(j: Optional[str]) -> Optional[int]:
    if j is None or str(j).strip() == "":
        return None
    cleaned = re.sub(r"^0+", "", str(j).strip()) or "0"
    try:
        return int(cleaned)
    except ValueError:
        return None


def position_token_set(s: str) -> set[str]:
    x = s.lower()
    tokens: set[str] = set()
    if "guard" in x:
        tokens.add("G")
    if "forward" in x:
        tokens.add("F")
    if "center" in x:
        tokens.add("C")
    return tokens


def _fmt_age(a: Any) -> str:
    return "—" if a is None else str(a)


def _fmt_jersey(j: Optional[str]) -> str:
    return "—" if j is None or str(j).strip() == "" else str(j)


def _fmt_nat(n: Optional[str]) -> str:
    return n.strip() if n and n.strip() else "—"


def _fmt_height(h: Optional[str]) -> str:
    return h.strip() if h and h.strip() else "—"


def compute_who_am_i_feedback(secret: dict[str, Any], guess: dict[str, Any]) -> dict[str, Any]:
    display = {
        "team": guess.get("team") or "",
        "conference": guess.get("conference") or "",
        "division": guess.get("division") or "",
        "position": guess.get("position") or "",
        "height": _fmt_height(guess.get("height")),
        "age": _fmt_age(guess.get("age")),
        "jerseyNumber": _fmt_jersey(guess.get("jerseyNumber")),
        "nationality": _fmt_nat(guess.get("nationality")),
    }
    feedback: dict[str, Any] = {}

    feedback["team"] = (
        {"state": "correct"} if guess.get("team") == secret.get("team") else {"state": "wrong"}
    )
    feedback["conference"] = (
        {"state": "correct"}
        if guess.get("conference") == secret.get("conference")
        else {"state": "wrong"}
    )
    feedback["division"] = (
        {"state": "correct"}
        if guess.get("division") == secret.get("division")
        else {"state": "wrong"}
    )

    g_pos = (guess.get("position") or "").strip()
    s_pos = (secret.get("position") or "").strip()
    if g_pos.lower() == s_pos.lower():
        feedback["position"] = {"state": "correct"}
    else:
        g_t = position_token_set(guess.get("position") or "")
        s_t = position_token_set(secret.get("position") or "")
        overlap = bool(g_t & s_t)
        feedback["position"] = {"state": "close" if overlap else "wrong"}

    s_in = height_to_inches(secret.get("height"))
    g_in = height_to_inches(guess.get("height"))
    if s_in is not None and g_in is not None:
        if g_in == s_in:
            feedback["height"] = {"state": "correct"}
        else:
            d = abs(g_in - s_in)
            feedback["height"] = {
                "state": "close" if d <= 2 else "wrong",
                "dir": "higher" if s_in > g_in else "lower",
            }
    else:
        feedback["height"] = {"state": "wrong"}

    s_age = secret.get("age")
    g_age = guess.get("age")
    if s_age is not None and g_age is not None:
        if g_age == s_age:
            feedback["age"] = {"state": "correct"}
        else:
            d = abs(int(g_age) - int(s_age))
            feedback["age"] = {
                "state": "close" if d <= 2 else "wrong",
                "dir": "higher" if int(s_age) > int(g_age) else "lower",
            }
    else:
        feedback["age"] = {"state": "wrong"}

    s_j = parse_jersey_number(secret.get("jerseyNumber"))
    g_j = parse_jersey_number(guess.get("jerseyNumber"))
    if s_j is not None and g_j is not None:
        if g_j == s_j:
            feedback["jerseyNumber"] = {"state": "correct"}
        else:
            d = abs(g_j - s_j)
            feedback["jerseyNumber"] = {
                "state": "close" if d <= 2 else "wrong",
                "dir": "higher" if s_j > g_j else "lower",
            }
    else:
        feedback["jerseyNumber"] = {"state": "wrong"}

    s_nat = (secret.get("nationality") or "").strip().lower()
    g_nat = (guess.get("nationality") or "").strip().lower()
    feedback["nationality"] = (
        {"state": "correct"} if s_nat and g_nat and s_nat == g_nat else {"state": "wrong"}
    )

    return {
        "guessedPlayerId": guess.get("id"),
        "guessedName": guess.get("displayName"),
        "display": display,
        "feedback": feedback,
    }
