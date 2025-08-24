FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements-prod.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements-prod.txt

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p data

# Expose port
EXPOSE 8000

# Health check disabled for now to avoid build issues
# HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
#     CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Start the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
