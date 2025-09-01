#!/bin/bash
# VPS Diagnostic Script - Run this on your VPS to identify the crash issue

echo "=== ECLIPSE BACKEND DIAGNOSTIC ==="
echo "Timestamp: $(date)"
echo "Server: $(hostname)"
echo

echo "=== 1. SYSTEM MEMORY STATUS ==="
free -h
echo
echo "Memory details:"
cat /proc/meminfo | grep -E "(MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree)"
echo

echo "=== 2. PROCESS MEMORY USAGE ==="
echo "Top memory consumers:"
ps aux --sort=-%mem | head -10
echo

echo "=== 3. BACKEND PROCESS STATUS ==="
echo "Python/Uvicorn processes:"
ps aux | grep -E "(python|uvicorn)" | grep -v grep
echo

echo "=== 4. PORT 8000 STATUS ==="
echo "What's listening on port 8000:"
lsof -i :8000
echo

echo "=== 5. NGINX STATUS ==="
echo "Nginx process status:"
systemctl status nginx --no-pager
echo
echo "Nginx configuration test:"
nginx -t
echo

echo "=== 6. SCREEN SESSIONS ==="
echo "Active screen sessions:"
screen -list
echo

echo "=== 7. BACKEND LOGS (Last 50 lines) ==="
echo "Recent backend output:"
if screen -list | grep -q "eclipse-backend"; then
    screen -S eclipse-backend -X hardcopy /tmp/backend_log.txt
    tail -50 /tmp/backend_log.txt 2>/dev/null || echo "No backend log found in screen"
else
    echo "No eclipse-backend screen session found"
fi
echo

echo "=== 8. NGINX ERROR LOGS (Last 20 lines) ==="
tail -20 /var/log/nginx/error.log 2>/dev/null || echo "No nginx error log found"
echo

echo "=== 9. SYSTEM LOGS (OOM Killer) ==="
echo "Recent Out of Memory kills:"
dmesg | grep -i "killed process" | tail -10
echo

echo "=== 10. DISK SPACE ==="
df -h
echo

echo "=== 11. BACKEND FILES STATUS ==="
echo "Backend directory contents:"
ls -la ~/eclipse-backend/ 2>/dev/null || echo "Backend directory not found"
echo
echo "Data directory:"
ls -la ~/eclipse-backend/data/ 2>/dev/null || echo "Data directory not found"
echo

echo "=== 12. PYTHON PACKAGES ==="
echo "Installed Python packages:"
cd ~/eclipse-backend && python3 -m pip list | grep -E "(sentence|faiss|torch|cerebras)" 2>/dev/null || echo "Could not check packages"
echo

echo "=== 13. NETWORK CONNECTIONS ==="
echo "Active connections to backend:"
netstat -an | grep :8000
echo

echo "=== 14. SYSTEM LOAD ==="
uptime
echo

echo "=== DIAGNOSTIC COMPLETE ==="
echo "Save this output and share with developer for analysis"
