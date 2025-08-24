# Troubleshooting Guide

## Common Build Issues

### 1. PyTorch Installation Failures

**Problem**: `ERROR: Could not find a version that satisfies the requirement torch==2.3.1+cpu`

**Solution**: We've created `requirements-prod.txt` with a compatible PyTorch version. Make sure to use:
```yaml
buildCommand: pip install -r requirements-prod.txt
```

**Alternative**: If you still have issues, try using the latest stable PyTorch:
```txt
torch>=2.0.0
```

### 2. Memory Issues During Build

**Problem**: Build fails due to insufficient memory

**Solution**: 
- Use `--no-cache-dir` flag (already in Dockerfile)
- Consider upgrading Render plan if on free tier
- Remove unnecessary dependencies temporarily

### 3. Python Version Compatibility

**Problem**: Package requires different Python version

**Solution**: Ensure you're using Python 3.11 in Render:
```yaml
envVars:
  - key: PYTHON_VERSION
    value: 3.11
```

### 4. System Dependencies Missing

**Problem**: Build fails due to missing system packages

**Solution**: The Dockerfile includes essential packages:
```dockerfile
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*
```

## Runtime Issues

### 1. Redis Connection Failures

**Problem**: Can't connect to Upstash Redis

**Solution**: 
- Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Check if Upstash database is active
- Verify region selection matches Render deployment

### 2. API Key Authentication

**Problem**: 401 Unauthorized errors

**Solution**:
- Generate new `BACKEND_API_KEY` and `ADMIN_API_KEY`
- Update frontend environment variables
- Check API key format (no spaces, special characters)

### 3. Cold Start Delays

**Problem**: Service takes 30-60 seconds to respond after inactivity

**Solution**: This is normal on Render free tier. Consider:
- Upgrading to paid plan for better performance
- Implementing health check endpoints
- Using external monitoring services

## Performance Optimization

### 1. Reduce Build Time
- Use `.dockerignore` to exclude unnecessary files
- Optimize `requirements.txt` with specific versions
- Consider multi-stage Docker builds

### 2. Reduce Memory Usage
- Use `faiss-cpu` instead of GPU versions
- Optimize model loading
- Implement lazy loading for heavy dependencies

### 3. Improve Response Time
- Cache frequently used data in Redis
- Optimize database queries
- Use connection pooling

## Monitoring and Debugging

### 1. Check Render Logs
1. Go to your service dashboard
2. Click "Logs" tab
3. Look for error messages and stack traces

### 2. Test Locally
```bash
# Test with Docker
docker build -t eclipse-backend .
docker run -p 8000:8000 eclipse-backend

# Test health endpoint
curl http://localhost:8000/health
```

### 3. Environment Variable Debugging
Add temporary logging to check environment variables:
```python
import os
print("Environment variables:")
for key in ['UPSTASH_REDIS_REST_URL', 'BACKEND_API_KEY', 'CEREBRAS_API_KEY']:
    print(f"{key}: {'SET' if os.getenv(key) else 'NOT SET'}")
```

## Getting Help

### 1. Render Support
- Check [Render documentation](https://render.com/docs)
- Use Render community forum
- Contact Render support for billing/account issues

### 2. Upstash Support
- [Upstash documentation](https://docs.upstash.com)
- [Discord community](https://discord.gg/upstash)
- Email: support@upstash.com

### 3. Common Solutions
- Restart the service after environment variable changes
- Check if dependencies are compatible with Python 3.11
- Verify all required environment variables are set
- Monitor resource usage in Render dashboard
