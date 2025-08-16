# Use slim Python image
FROM python:3.11-slim

# System deps (libgomp for faiss-cpu openmp; curl for debugging)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

# Create app dir
WORKDIR /app

# Copy requirements first to leverage Docker layer cache
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . /app

# Ensure data dir exists (Railway free = ephemeral; paid can mount /app/data)
RUN mkdir -p /app/data

# For Hugging Face cache to avoid filling layer (optional)
ENV HF_HOME=/app/.cache/huggingface

# Default command; Railway sets $PORT
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]