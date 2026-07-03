"""Errors raised by the serving layer. Callers catch these to give users a clear
reason a prediction can't be made (vs. returning a garbage number)."""

from __future__ import annotations


class ServingError(Exception):
    """Base class for all serving-layer errors."""


class UnknownPlayerError(ServingError):
    """The player is not in the feature store at all (never seen)."""


class InsufficientHistoryError(ServingError):
    """The player exists but has fewer than MIN_INFERENCE_GAMES of history.

    Typical at the start of a season, for rookies, or just-traded players.
    """

    def __init__(self, player_id: int, games: int, required: int):
        self.player_id = player_id
        self.games = games
        self.required = required
        super().__init__(
            f"player {player_id} has only {games} game(s) of history; "
            f"need >= {required} to predict"
        )


class UnknownTeamError(ServingError):
    """The opponent or own team is not in the feature store."""


class ModelsNotTrainedError(ServingError):
    """No trained models were found — run the training pipeline first."""
