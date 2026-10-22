# Backend image — the self-contained FastAPI project in surface-api/. Build from the repo root:
#   docker build -t v3-api .
#   docker run -p 8000:8000 --env-file .env v3-api
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# uv for fast, reproducible installs
RUN pip install --no-cache-dir uv

# Project metadata first (better layer caching).
COPY surface-api/pyproject.toml ./

# Dependencies mirror surface-api/pyproject.toml. Pin the fastapi/starlette line: an
# unpinned resolve picked fastapi 0.159 + starlette 1.9 where include_router mounts nothing.
RUN uv pip install --system --no-cache \
    "fastapi>=0.115,<0.116" \
    "starlette>=0.40,<0.42" \
    "uvicorn[standard]>=0.32" \
    "psycopg[binary]>=3.2" \
    "pyjwt>=2.9"

# Backend source only (DATABASE_URL / SUPABASE_JWT_SECRET come from the environment).
# surface-api/ is the project root, so its top-level packages (_base, sales, …) sit at /app.
COPY surface-api/ ./

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
