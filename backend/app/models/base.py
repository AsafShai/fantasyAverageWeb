from pydantic import BaseModel

class Team(BaseModel):
    team_id: int
    team_name: str 