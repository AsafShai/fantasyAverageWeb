FROM python:3.12-slim

# Create non-root user for security with home directory
RUN groupadd -r appuser && useradd -r -g appuser -m appuser

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies as root, then switch to appuser
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen

# Copy application code and set ownership
COPY --chown=appuser:appuser app/ ./app/

# Give appuser ownership of the working directory for log files
RUN chown appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uv", "run", "-m", "app.main"]