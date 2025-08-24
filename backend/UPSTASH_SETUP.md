# Upstash Redis Setup Guide

## Why Upstash?

Upstash is perfect for your Eclipse Obsidian backend because:
- **Serverless Redis**: Pay only for what you use
- **Global Edge Network**: Low latency worldwide
- **REST API**: Easy integration with any platform
- **Free Tier**: 10,000 requests/day, 256MB storage
- **TLS Security**: Built-in encryption
- **Auto-scaling**: Handles traffic spikes automatically

## Step-by-Step Setup

### 1. Create Upstash Account
1. Go to [upstash.com](https://upstash.com)
2. Click "Get Started"
3. Sign up with GitHub (recommended) or email
4. Verify your email address

### 2. Create Redis Database
1. Click "Create Database" button
2. Fill in the details:
   - **Database Name**: `eclipse-obsidian-redis`
   - **Region**: Choose closest to your Render deployment
     - **US East (N. Virginia)** for US deployments
     - **Europe (London)** for EU deployments
     - **Asia Pacific (Tokyo)** for APAC deployments
   - **Database Type**: Redis
   - **TLS**: ✅ Enabled (recommended for security)
   - **Eviction Policy**: `allkeys-lru` (good for chat sessions)
3. Click "Create"

### 3. Get Connection Details
1. Click on your newly created database
2. Go to the **"REST API"** tab
3. Copy these values:
   - **REST URL**: `https://your-db-name-your-region.upstash.io`
   - **REST Token**: `your-long-token-here`

### 4. Set Environment Variables in Render
In your Render dashboard, add these environment variables:
```
UPSTASH_REDIS_REST_URL=https://your-db-name-your-region.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-long-token-here
```

## Database Configuration

### Recommended Settings
- **Eviction Policy**: `allkeys-lru` (removes least recently used keys when memory is full)
- **Max Memory Policy**: Leave as default (auto-scaling)
- **TLS**: Always enabled for production

### Key Patterns Used
Your backend uses these Redis key patterns:
- `eclipse:session:*` - Chat sessions
- `eclipse:chat:*` - Chat history
- `eclipse:files:*` - Ephemeral file storage
- `eclipse:memory:*` - Memory consolidation

## Monitoring & Usage

### Free Tier Limits
- **Requests**: 10,000/day
- **Storage**: 256MB
- **Bandwidth**: 1GB/day

### Monitor Usage
1. Go to your database dashboard
2. Check "Usage" tab for:
   - Request count
   - Memory usage
   - Bandwidth consumption

### Upgrade When Needed
- **Pro Plan**: $20/month for higher limits
- **Pay-as-you-go**: $0.40 per 100K requests
- **Storage**: $0.25 per GB/month

## Security Best Practices

1. **Never commit tokens** to your repository
2. **Use environment variables** in Render
3. **Enable TLS** (already done in setup)
4. **Rotate tokens** periodically
5. **Monitor access logs** in Upstash dashboard

## Troubleshooting

### Common Issues
1. **Connection timeout**: Check region selection
2. **Authentication failed**: Verify REST token
3. **Rate limited**: Check free tier limits
4. **Memory full**: Review eviction policy

### Support
- **Documentation**: [docs.upstash.com](https://docs.upstash.com)
- **Discord**: [discord.gg/upstash](https://discord.gg/upstash)
- **Email**: support@upstash.com

## Next Steps
After setting up Upstash:
1. Deploy your backend to Render
2. Test Redis connectivity
3. Monitor usage and performance
4. Scale up if needed
