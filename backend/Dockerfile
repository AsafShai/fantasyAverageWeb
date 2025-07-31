FROM python:3.12-slim

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app
RUN pip install uv

# Copy dependency files first (better layer caching)
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen

# Copy application code
COPY config.py ./
COPY app/ ./app/

ENV PORT=8000

ENV ESPN_STANDINGS_URL=""
ENV ESPN_PLAYERS_URL=""

# Change ownership to non-root user
RUN chown -R appuser:appuser /app
USER appuser

CMD ["uv", "run", "python", "-m", "app.main"]