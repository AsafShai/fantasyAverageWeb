"""Fantasy configuration module."""


class FantasyConfiguration:
    """Configuration values for fantasy league logic."""

    def __init__(
        self,
        num_nba_games: int = 82,
        minimum_period_id: int = 10,
        window_size: int = 10,
        window_decay: float = 0.93,
        num_monte_carlo: int = 1000,
    ) -> None:
        self.num_nba_games = num_nba_games
        self.minimum_period_id = minimum_period_id
        self.window_size = window_size
        self.window_decay = window_decay
        self.num_monte_carlo = num_monte_carlo
