#!/bin/bash

# Create data directory if it doesn't exist
mkdir -p data

# Start the FastAPI application
exec uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1
