#!/usr/bin/env bash
set -e
export PYTHONDONTWRITEBYTECODE=1
uvicorn app:app \
  --reload \
  --reload-dir . \
  --reload-exclude ".venv/*" \
  --reload-exclude "**/site-packages/**" \
  --reload-exclude "data/*" \
  --reload-exclude ".env"