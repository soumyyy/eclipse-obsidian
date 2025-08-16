#!/usr/bin/env bash
set -e
export PYTHONDONTWRITEBYTECODE=1

# Prevent reload loop by excluding venvs, site-packages, cache, and data artifacts
uvicorn app:app \
  --reload \
  --host 127.0.0.1 \
  --port 8000 \
  --reload-dir . \
  --reload-exclude "**/.venv/**" \
  --reload-exclude "**/venv/**" \
  --reload-exclude "**/site-packages/**" \
  --reload-exclude "**/__pycache__/**" \
  --reload-exclude "data/**" \
  --reload-exclude ".env"


# export WATCHFILES_IGNORE=".venv/**,**/site-packages/**,data/**,__pycache__/**"
# uvicorn app:app --reload --host 127.0.0.1 --port 8000