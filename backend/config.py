import os
from dotenv import load_dotenv

load_dotenv()

PORT = int(os.getenv("PORT", 8000))
ESPN_STANDINGS_URL = os.getenv("ESPN_STANDINGS_URL")
ESPN_PLAYERS_URL = os.getenv("ESPN_PLAYERS_URL")

if not ESPN_STANDINGS_URL:
    raise ValueError("ESPN_STANDINGS_URL is not set in environment variables")

if not ESPN_PLAYERS_URL:
    raise ValueError("ESPN_PLAYERS_URL is not set in environment variables")