import os
from dotenv import load_dotenv

load_dotenv()

PORT = int(os.getenv("PORT", 8000))
ESPN_URL = os.getenv("ESPN_URL")

if not ESPN_URL:
    raise ValueError("ESPN_URL is not set in environment variables")