from datetime import date
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional


class Settings(BaseSettings):
    port: int = Field(default=8000, alias="PORT")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    season_id: int = Field(alias="SEASON_ID")
    league_id: int = Field(alias="LEAGUE_ID")
    # Normally replaced at startup by the opener derived from ESPN (main.py);
    # this is only the fallback when that fails. Left unset, it is estimated
    # from SEASON_ID (openers land around Oct 22 of the year the season starts)
    # rather than pinned to one season's date that goes stale the next year.
    season_start: Optional[date] = Field(default=None, alias="SEASON_START")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    database_url: Optional[str] = Field(default=None, alias="DATABASE_URL")
    injury_scheduler_enabled: bool = Field(default=True, alias="INJURY_SCHEDULER_ENABLED")
    model_nightly_enabled: bool = Field(default=False, alias="MODEL_NIGHTLY_ENABLED")
    nba_players_refresh_enabled: bool = Field(default=False, alias="NBA_PLAYERS_REFRESH_ENABLED")
    # When the deployed models need a feature the stored vectors lack, should the
    # nightly rebuild them itself? Detection is always on and costs three queries;
    # the rebuild is what needs memory (~380 MB), so it defaults to OFF and the
    # nightly just logs what to run. Turn on only where the container can afford it.
    model_feature_heal_auto: bool = Field(default=False, alias="MODEL_FEATURE_HEAL_AUTO")
    model_config = SettingsConfigDict(
        env_file=".env",             # Loads .env if it exists
        env_file_encoding="utf-8",
        case_sensitive=False
    )
    
    @model_validator(mode="after")
    def _default_season_start(self) -> "Settings":
        if self.season_start is None:
            self.season_start = date(self.season_id - 1, 10, 22)
        return self

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]


settings = Settings()
