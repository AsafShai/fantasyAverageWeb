from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.rankings import router as rankings_router
from app.api.stats import router as stats_router
from dotenv import load_dotenv
from config import PORT

app = FastAPI(title="Fantasy League Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rankings_router, prefix="/api")
app.include_router(stats_router, prefix="/api")

@app.get("/")
async def root():
    return {"message": "Fantasy League Dashboard API"}

load_dotenv()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
