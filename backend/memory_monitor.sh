#!/bin/bash
# Memory monitoring script for Eclipse Backend
# Run this on your VPS to monitor memory usage in real-time

echo "🔍 Eclipse Backend Memory Monitor"
echo "=================================="
echo "Press Ctrl+C to stop monitoring"
echo

while true; do
    clear
    echo "🔍 Eclipse Backend Memory Monitor - $(date)"
    echo "=============================================="
    echo
    
    # System memory
    echo "📊 SYSTEM MEMORY:"
    free -h | grep -E "(Mem:|Swap:)"
    echo
    
    # Backend process
    echo "🐍 BACKEND PROCESS:"
    if pgrep -f "uvicorn app:app" > /dev/null; then
        ps aux | grep "uvicorn app:app" | grep -v grep | while read line; do
            echo "  ✅ $line"
        done
        echo
        
        # Memory status from backend API
        echo "🎯 BACKEND MEMORY STATUS:"
        curl -s http://127.0.0.1:8000/memory 2>/dev/null | python3 -m json.tool 2>/dev/null | grep -E "(status|process_memory_mb|percent|alert_count)" | sed 's/^/  /'
        echo
        
        # Recent nginx errors
        echo "⚠️  RECENT NGINX ERRORS (last 5):"
        tail -5 /var/log/nginx/error.log 2>/dev/null | grep -E "(upstream|connection|timeout)" | sed 's/^/  /' || echo "  No recent errors"
        
    else
        echo "  ❌ Backend not running!"
        echo
        echo "🔄 RESTART BACKEND:"
        echo "  cd /app/backend && python3 -m uvicorn app:app --host 0.0.0.0 --port 8000"
    fi
    
    echo
    echo "📈 MEMORY THRESHOLDS:"
    echo "  🟢 Healthy: < 1200MB"
    echo "  🟡 Warning: 1200-1400MB (alerts sent)"
    echo "  🟠 Overload: 1400-1600MB (requests rejected)"
    echo "  🔴 Critical: > 1600MB (all requests rejected)"
    echo
    echo "Press Ctrl+C to stop..."
    
    sleep 5
done
