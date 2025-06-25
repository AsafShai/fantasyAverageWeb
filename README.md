# Fantasy League Dashboard

A React TypeScript frontend with FastAPI backend for displaying ESPN Fantasy Basketball league statistics.

## Features

- **Team Rankings**: Sortable table showing team performance across multiple categories
- **Data Visualizations**: Charts and heatmaps for league analysis
- **Team Details**: Individual team statistics and performance metrics
- **Real-time Data**: Live ESPN Fantasy API integration

## Tech Stack

### Backend
- **FastAPI** with Python
- **uv** for dependency management
- **pandas** for data processing
- **Pydantic** for data validation

### Frontend
- **React 19** with TypeScript
- **Redux Toolkit** with RTK Query
- **Tailwind CSS 3.x** for styling
- **React Router** for navigation
- **Recharts** for data visualization

## Setup

### Prerequisites
- Python 3.8+
- Node.js 18+
- uv (Python package manager)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd fantasyAverageWeb
   ```

2. **Backend Setup**
   ```bash
   cd backend
   uv sync
   ```

3. **Frontend Setup**
   ```bash
   cd frontend1
   npm install
   ```

## Running the Application

### Development Mode

1. **Set Up the Backend Environment (First Time Only)**
   ```powershell
   cd backend
   uv venv           # Create the virtual environment (only once)
   .venv\Scripts\Activate  # Activate the virtual environment (every new terminal)
   uv sync           # Install dependencies from lock file
   ```

2. **Start the Backend**
   ```powershell
   uv run python main.py
   ```
   Backend will run on http://localhost:8000

2. **Start the Frontend**
   ```bash
   cd frontend
   npm run dev
   ```
   Frontend will run on http://localhost:5173

### API Endpoints

- `GET /api/rankings` - Team rankings with sorting
- `GET /api/teams/{team_name}` - Individual team details
- `GET /api/league/summary` - League overview statistics
- `GET /api/charts/heatmap` - Heatmap visualization data
- `GET /api/raw-data` - Raw ESPN API data

## Development

### Backend Commands
```bash
cd backend
uv add <package>        # Add new dependency
uv sync --upgrade       # Upgrade dependencies
uv run python main.py   # Start development server
```

### Frontend Commands
```bash
cd frontend
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run ESLint
npm run preview  # Preview production build
```

## Data Sources

The application fetches data from ESPN Fantasy Basketball API and processes it to provide:
- Per-game averages for all statistical categories
- Team rankings based on category performance
- Total points calculation from ranking positions

## Project Structure

```
fantasyAverageWeb/
├── backend/
│   ├── app/
│   │   ├── models/fantasy.py      # Pydantic data models
│   │   └── services/data_processor.py  # ESPN API integration
│   ├── main.py                    # FastAPI application
│   └── pyproject.toml            # Python dependencies
└── frontend/
    ├── src/
    │   ├── components/           # React components
    │   ├── pages/               # Page components
    │   ├── store/               # Redux store and API
    │   └── types/               # TypeScript definitions
    ├── package.json             # Node dependencies
    └── tailwind.config.js       # Tailwind configuration
```

### Backend Environment Configuration

You can configure the backend server port by creating a `.env` file in the `backend` directory:

```env
PORT=8000
```

If not set, the default port is 8000.