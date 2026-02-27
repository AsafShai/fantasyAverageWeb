from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    port: int = Field(default=8000, alias="PORT")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    
    season_id: int = Field(alias="SEASON_ID")
    league_id: int = Field(alias="LEAGUE_ID")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    model_config = SettingsConfigDict(
        env_file=".env",             # Loads .env if it exists
        env_file_encoding="utf-8",
        case_sensitive=False
    )
    
    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]


settings = Settings()
