# Fantasy League Dashboard

A full-stack fantasy basketball application featuring AI-powered trade suggestions, real-time ESPN data integration, and comprehensive team analytics.
Link to the app: https://fantasyleagueinfo.onrender.com/

## 🏀 Features

- **Team Rankings**: Sortable rankings across all statistical categories
- **Teams Browser**: Browse all teams with detailed roster views and ESPN integration
- **Team Details**: Comprehensive team statistics with player rosters and minutes tracking
- **Players Browser**: Search and filter all players including free agents and waivers with advanced filters (position, status, team, stats)
- **AI Trade Suggestions**: GPT-powered trade recommendations with impact analysis
- **Manual Trade Analyzer**: Interactive tool to compare players between teams OR compare your players against free agents, with detailed stats and per-game/total views
- **Team Analytics**: Performance visualizations and detailed statistics
- **Player Data**: Comprehensive player statistics including minutes played
- **Real-time Data**: Live ESPN Fantasy Basketball API integration

## 📸 Screenshots

### Dashboard Overview
Main dashboard showing league overview and top team rankings.

![Dashboard](screenshots/dashboard.png)

### Team Rankings
Comprehensive team rankings with sortable categories and statistical breakdowns.

![Rankings](screenshots/rankings.png)

### Shooting Statistics
League-wide shooting statistics with sortable field goal and free throw percentages.

![Shots](screenshots/shots.png)

### Analytics & Performance Heatmap  
Advanced analytics with color-coded performance indicators across all statistical categories.

![Analytics](screenshots/analytics.png)

### AI Trade Suggestions
Intelligent trade recommendations powered by GPT-4o-mini with detailed impact analysis and statistical comparisons.

![AI Trades with Stats](screenshots/ai-trades-with-stats.png)

### Manual Trade Analyzer
Interactive trade analysis tool for comparing players between teams with comprehensive statistical breakdowns.

![Trade Analyzer](screenshots/trade-analyzer.png)

## 🛠 Tech Stack

### Backend
- **Python 3.12+** - Programming language
- **FastAPI** - Python web framework
- **LangChain + OpenAI** - AI trade suggestions
- **pandas** - Data processing
- **pytest** - Testing
- **Docker** - Containerization

### Frontend
- **React 19** - Frontend framework
- **TypeScript** - Type safety
- **Redux Toolkit** - State management
- **TanStack Query (React Query)** - Server state management
- **Recharts** - Data visualization
- **Tailwind CSS** - Styling
- **Vite** - Build tool

## Setup

### Prerequisites
- Python 3.12+
- Node.js 18+
- uv (Python package manager)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd fantasyAverageWeb
   ```

2. **Environment Setup**

   **Backend** - Create `.env` in `backend` directory:
   ```env
   SEASON_ID=your_season_id
   LEAGUE_ID=your_league_id
   OPENAI_API_KEY=your_openai_api_key
   CORS_ORIGINS=localhost:5173,others
   ENVIRONMENT=production/development
   ```
   
   **Frontend** - Create `.env` in `frontend` directory:
   ```env
   VITE_API_BASE_URL=http://localhost:8000
   ```

3. **Backend Setup**
   ```bash
   cd backend
   uv sync
   ```

4. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   ```

## 🚀 Running the Application

### Option 1: Backend Docker Setup
```bash
cd backend
docker-compose up --build
```
Backend: http://localhost:8000

*Note: Docker setup is currently available for backend only. Frontend runs locally.*

### Option 2: Local Development

**Backend:**
```bash
cd backend
uv run -m app.main
```

**Frontend:**
```bash
cd frontend
npm run dev
```

## 🧪 Testing

```bash
# Backend tests
cd backend
uv run pytest
```

## 📊 Data & AI

- **ESPN Fantasy API** - Live team and player statistics
- **OpenAI GPT-4o-mini** - AI-powered trade analysis
- **Smart Caching** - ETag-based HTTP caching for performance

## 🔌 API Endpoints

The backend provides the following REST API endpoints:

### Core Endpoints
- `GET /` - API welcome message
- `GET /health` - Health check endpoint

### Rankings
- `GET /api/rankings` - Get league rankings with optional sorting
  - Query params: `sort_by` (category), `order` (asc/desc)

### Teams
- `GET /api/teams` - Get list of all teams
- `GET /api/teams/{team_id}` - Get detailed stats for a specific team including:
  - Team statistics (totals and averages)
  - Complete roster with player stats (including minutes played)
  - ESPN team page URL for external reference
  - Shot chart stats and ranking information
- `GET /api/teams/{team_id}/players` - Get players for a specific team (lightweight endpoint)

### League
- `GET /api/league/summary` - Get league overview and summary statistics
- `GET /api/league/shots` - Get league-wide shooting statistics

### Analytics
- `GET /api/analytics/heatmap` - Get performance heatmap data for visualization

### Players
- `GET /api/players` - Get all players including rostered players, free agents, and waivers with pagination
  - Query params: 
    - `page` (integer, default: 1) - Page number
    - `limit` (integer, default: 500, range: 10-500) - Players per page
  - Returns: `PaginatedPlayers` object with:
    - `players` - Array of player objects
    - `total_count` - Total number of players
    - `page` - Current page number
    - `limit` - Players per page
    - `has_more` - Boolean indicating if more pages exist
  - Each player includes:
    - Comprehensive stats (points, rebounds, assists, steals, blocks, shooting percentages, 3PM, minutes, games played)
    - Player status (`ONTEAM`, `FREEAGENT`, or `WAIVERS`)
    - Fantasy team assignment (`team_id`)
    - NBA team and position information

**Note:** Interactive API documentation is available at `/docs` (Swagger UI) when running the backend.

## ⚙️ Environment Variables

### Backend
`.env` file in `backend/` directory:

```env
SEASON_ID=your_season_id
LEAGUE_ID=your_league_id
OPENAI_API_KEY=your_openai_api_key
CORS_ORIGINS=localhost:5173,others
ENVIRONMENT=production/development
```

### Frontend
Optional `.env` file in `frontend/` directory:

```env
# API Configuration
VITE_API_BASE_URL=http://localhost:8000
```
