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
        luck_scale: float = 6.0,
        mean_uncertainty_scale: float = 2.35,
    ) -> None:
        self.num_nba_games = num_nba_games
        self.minimum_period_id = minimum_period_id
        self.window_size = window_size
        self.window_decay = window_decay
        self.num_monte_carlo = num_monte_carlo
        # The simulation's spread for the games to come is
        #   n · G̃ · Σ̂ · (luck_scale + mean_uncertainty_scale · n · Σω² / G̃)
        # luck_scale: the game-to-game luck, which the per-period covariance alone
        # understates (games-per-day swings, roster moves, the games projection).
        # mean_uncertainty_scale: the error in each team's per-game level, which
        # repeats in every game to come — large early in the season, gone at the end.
        # The estimator before 11.2026 was (1, 0): its ranges were 3–5 times too
        # narrow. (6.0, 2.35) is the maximum-likelihood fit to how the 2025-26 season
        # ended, rerun from 32 dates (every 5 days from day 14): RMS z of the final
        # totals 1.00 / 0.91 / 1.10 / 0.98 in each quarter of the season; fitting
        # alternate dates alone gives (6.3, 2.2) and (5.6, 2.5).
        self.luck_scale = luck_scale
        self.mean_uncertainty_scale = mean_uncertainty_scale
