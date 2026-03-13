"""Fantasy configuration module."""


class FantasyConfiguration:
    """Configuration values for fantasy league logic."""

    def __init__(
        self,
        num_nba_games: int = 82,
        num_players_in_team: int = 10,
        minimum_period_id: int = 10,
        window_size: int = 10,
        window_decay: float = 0.93,
        catch_up_boost_max: float = 0.20,
        num_monte_carlo: int = 1000,
    ) -> None:
        self.num_nba_games = num_nba_games
        self.num_players_in_team = num_players_in_team
        self.minimum_period_id = minimum_period_id
        self.window_size = window_size
        self.window_decay = window_decay
        # Max (1+X) boost on pace ratio early in season; X decreases as season progresses (X = catch_up_boost_max * (1 - season_progress))
        self.catch_up_boost_max = catch_up_boost_max
        self.num_monte_carlo = num_monte_carlo
