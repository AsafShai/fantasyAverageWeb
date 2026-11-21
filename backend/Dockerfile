FROM python:3.12-slim

# Create non-root user for security with home directory
RUN groupadd -r appuser && useradd -r -g appuser -m appuser

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Runtime image already has exactly the deps it needs baked in;
# `uv run` must not try to reconcile against default-groups as non-root appuser.
ENV UV_NO_SYNC=1
# Precompile .pyc at install time. The venv is root-owned and the server runs as
# appuser, so without this every start recompiled pandas/sklearn/scipy from
# source and threw the bytecode away (measured at 0.15 CPU: app import 25s ->
# 9s, model load 24s -> 8.5s).
ENV UV_COMPILE_BYTECODE=1
# Render gives this container 0.15 CPU, but sklearn's OpenMP and numpy/scipy's
# OpenBLAS size their thread pools by the host's core count. Extra threads can't
# run in parallel on a fraction of one core; they only add start-up/spin overhead
# and per-thread memory. Predictions are identical with one thread (measured at
# 0.15 CPU: first page visit after a start 18-21 s -> 11-12 s).
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
# Polars sizes its thread pool by the host's core count too; on 0.15 CPU the
# extra threads only cost memory and scheduling (benchmarks ran single-threaded).
ENV POLARS_MAX_THREADS=1
# Heavy frame/model work runs in asyncio.to_thread workers, and glibc gives
# each worker thread its own malloc arena (up to 8 per *host* core, which a
# 0.15 CPU slice cannot use). Each arena keeps its own freed-but-fragmented
# pages, so retained memory climbs step by step through the day. Two arenas is
# plenty for a fraction of a core (measured, threaded pandas jobs + malloc_trim:
# held 228-249 MB -> 155-167 MB, peak ~50 MB lower, same run time).
ENV MALLOC_ARENA_MAX=2

# Install dependencies as root, then switch to appuser
COPY pyproject.toml uv.lock ./
# No "training" group: the app serves NumPy-compiled models and never imports
# scikit-learn/SciPy (~78 MB RSS measured), see model_stats_inference/serving/compiled_model.py.
# No "offline" group: the app runs on Polars and never imports pandas/pyarrow.
RUN pip install uv && uv sync --frozen --no-group test --no-group ml-research --no-group training --no-group offline

# Copy application code and set ownership
COPY --chown=appuser:appuser app/ ./app/
COPY --chown=appuser:appuser model_stats_inference/ ./model_stats_inference/

# Same for our own code, so a fresh container doesn't compile it on first import.
RUN /app/.venv/bin/python -m compileall -q app model_stats_inference \
    && chown -R appuser:appuser app model_stats_inference

# Give appuser ownership of the working directory for log files
RUN chown appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Exec the venv's python directly: `uv run` stays resident as the parent
# process (~25 MB RSS) for the container's whole life, counted against the
# 512 MiB limit. Same interpreter, same venv, same entry point.
CMD ["/app/.venv/bin/python", "-m", "app.main"]