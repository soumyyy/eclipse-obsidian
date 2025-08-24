# Backend Deployment Guide - Render

## Prerequisites
1. Render account (free tier available)
2. GitHub repository with your backend code
3. Environment variables ready

## Step 1: Prepare Your Repository

### 1.1 Commit the new deployment files:
```bash
git add .
git commit -m "Add Render deployment configuration"
git push origin main
```

### 1.2 Ensure these files are in your backend directory:
- `render.yaml` - Render service configuration
- `Dockerfile` - Container configuration
- `.dockerignore` - Docker build exclusions
- `requirements.txt` - Python dependencies

## Step 2: Deploy on Render

### 2.1 Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Verify your email

### 2.2 Connect Your Repository
1. Click "New +" → "Web Service"
2. Connect your GitHub repository
3. Select the repository containing your backend

### 2.3 Configure the Service
1. **Name**: `eclipse-obsidian-backend`
2. **Environment**: `Python`
3. **Region**: Choose closest to your users
4. **Branch**: `main`
5. **Build Command**: `pip install -r requirements.txt`
6. **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`

### 2.4 Set Environment Variables
Click "Environment" tab and add:

**Required (set these):**
- `BACKEND_API_KEY`: Generate a secure random string
- `ADMIN_API_KEY`: Generate a secure random string
- `CEREBRAS_API_KEY`: Your Cerebras API key
- `OPENAI_API_KEY`: Your OpenAI API key (if using)
- `REDIS_URL`: Your Redis connection string

**Optional (defaults provided):**
- `ASSISTANT_NAME`: "Eclipse"
- `VERCEL_SITE`: Your frontend URL (update after Vercel deployment)
- `AUTO_MEMORY`: "false"

### 2.5 Deploy
1. Click "Create Web Service"
2. Wait for build to complete (5-10 minutes)
3. Your service will be available at: `https://your-service-name.onrender.com`

## Step 3: Test Your Deployment

### 3.1 Health Check
```bash
curl https://your-service-name.onrender.com/health
```

### 3.2 Test API Endpoint
```bash
curl -X POST https://your-service-name.onrender.com/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-backend-api-key" \
  -d '{"user_id": "test", "message": "Hello"}'
```

## Step 4: Update Frontend Configuration

After successful deployment, update your frontend environment variables:
```env
NEXT_PUBLIC_BACKEND_URL=https://your-service-name.onrender.com
NEXT_PUBLIC_BACKEND_API_KEY=your-backend-api-key
```

## Troubleshooting

### Build Failures
- Check Render logs for specific error messages
- Ensure all dependencies are in `requirements.txt`
- Verify Python version compatibility

### Runtime Errors
- Check environment variables are set correctly
- Verify API keys are valid
- Check Render logs for application errors

### Performance Issues
- Consider upgrading to paid plan for better performance
- Optimize your code for production (remove debug prints, etc.)

## Next Steps
1. Deploy frontend to Vercel
2. Update `VERCEL_SITE` environment variable
3. Test end-to-end functionality
4. Set up monitoring and logging
