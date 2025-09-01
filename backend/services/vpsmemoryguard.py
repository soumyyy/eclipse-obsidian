import os
import time
import gc
from datetime import datetime
from typing import Dict

import psutil


MEMORY_LIMIT_MB = int(os.getenv("MEMORY_LIMIT_MB", "1400"))
MEMORY_WARNING_MB = int(os.getenv("MEMORY_WARNING_MB", "1200"))
MEMORY_CRITICAL_MB = int(os.getenv("MEMORY_CRITICAL_MB", "1600"))

_last_memory_alert = 0.0
_memory_alert_count = 0


def get_memory_usage_mb() -> float:
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024


def get_system_memory() -> Dict:
    memory = psutil.virtual_memory()
    return {
        "total": memory.total / 1024 / 1024,
        "available": memory.available / 1024 / 1024,
        "percent": memory.percent,
        "free": memory.free / 1024 / 1024,
    }


def force_gc() -> int:
    return gc.collect()


def _send_memory_alert(level: str, memory_mb: float):
    global _last_memory_alert, _memory_alert_count
    now = time.time()
    if now - _last_memory_alert < 60:
        return
    _last_memory_alert = now
    _memory_alert_count += 1
    system_mem = get_system_memory()
    print(
        f"\n🚨 MEMORY ALERT [{level}]\n"
        f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Process Memory: {memory_mb:.1f}MB\n"
        f"System: {system_mem['percent']:.1f}% used ({system_mem['available']:.1f}MB avail)\n"
        f"Alert Count: {_memory_alert_count}\n"
        f"Action: {'REJECTING NEW REQUESTS' if memory_mb >= MEMORY_LIMIT_MB else 'MONITORING'}\n"
    )


def check_memory_and_alert(current_memory: float | None = None) -> Dict:
    if current_memory is None:
        current_memory = get_memory_usage_mb()
    status = "healthy"
    should_reject = False
    if current_memory >= MEMORY_CRITICAL_MB:
        status = "critical"
        should_reject = True
        _send_memory_alert("CRITICAL", current_memory)
    elif current_memory >= MEMORY_LIMIT_MB:
        status = "overloaded"
        should_reject = True
        _send_memory_alert("OVERLOAD", current_memory)
    elif current_memory >= MEMORY_WARNING_MB:
        status = "warning"
        _send_memory_alert("WARNING", current_memory)
    return {
        "status": status,
        "current_mb": current_memory,
        "should_reject": should_reject,
        "system_memory": get_system_memory(),
        "alerts": _memory_alert_count,
    }


