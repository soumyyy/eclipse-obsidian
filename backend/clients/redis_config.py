"""
Redis configuration and connection management for Eclipse.
"""

import os
import ast
import redis
from typing import Optional
import json
import orjson

try:
    from upstash_redis import Redis as UpstashRedis
    UPSTASH_AVAILABLE = True
except ImportError:
    UPSTASH_AVAILABLE = False
    print("Warning: upstash-redis not installed. Install with: pip install upstash-redis")

# Redis connection configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")
REDIS_URL = os.getenv("REDIS_URL")

# Upstash Redis configuration
UPSTASH_REDIS_REST_URL = os.getenv("UPSTASH_REDIS_REST_URL")
UPSTASH_REDIS_REST_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN")

# TTLs and defaults
SESSION_TTL_SECONDS = 3600
CHAT_HISTORY_TTL_SECONDS = 86400 * 7
CHAT_CACHE_TTL_SECONDS = 120

def _json_dumps(obj) -> str:
    # orjson returns bytes; ensure str for redis client using decode_responses
    return orjson.dumps(obj, option=orjson.OPT_NON_STR_KEYS).decode()

def _json_loads(data: str):
    return orjson.loads(data)

def _safe_parse_legacy(data: str):
    try:
        return json.loads(data)
    except Exception:
        pass
    try:
        return ast.literal_eval(data)
    except Exception:
        return None

# Redis client singleton (can be Redis or UpstashRedis)
_redis_client: Optional[redis.Redis | UpstashRedis] = None

def get_redis_client() -> redis.Redis | UpstashRedis:
    global _redis_client
    if _redis_client is None:
        if UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN and UPSTASH_AVAILABLE:
            _redis_client = UpstashRedis(
                url=UPSTASH_REDIS_REST_URL,
                token=UPSTASH_REDIS_REST_TOKEN
            )
        elif REDIS_URL:
            _redis_client = redis.from_url(REDIS_URL)
        else:
            _redis_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                password=REDIS_PASSWORD,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True
            )
        try:
            _redis_client.ping()
        except Exception as e:
            _redis_client = None
            raise
    return _redis_client

def close_redis_client():
    global _redis_client
    if _redis_client:
        _redis_client.close()
        _redis_client = None

class RedisKeys:
    SESSION_PREFIX = "eclipse:session:"
    USER_SESSIONS = "eclipse:user_sessions:"
    CHAT_HISTORY_PREFIX = "eclipse:chat:"
    CHAT_STREAM_PREFIX = "eclipse:stream:"
    EPHEMERAL_FILES_PREFIX = "eclipse:files:"
    MEMORY_QUEUE = "eclipse:memory:queue"
    ACTIVE_USERS = "eclipse:active_users"
    USER_STATUS = "eclipse:status:"
    @staticmethod
    def session_key(session_id: str) -> str:
        return f"{RedisKeys.SESSION_PREFIX}{session_id}"
    @staticmethod
    def chat_history_key(user_id: str, session_id: str) -> str:
        return f"{RedisKeys.CHAT_HISTORY_PREFIX}{user_id}:{session_id}"
    @staticmethod
    def ephemeral_files_key(session_id: str) -> str:
        return f"{RedisKeys.EPHEMERAL_FILES_PREFIX}{session_id}"
    @staticmethod
    def user_status_key(user_id: str) -> str:
        return f"{RedisKeys.USER_STATUS}{user_id}"

class RedisOps:
    def __init__(self):
        self.client = get_redis_client()
        try:
            from upstash_redis import Redis as _UpstashRedis
            self._is_upstash = isinstance(self.client, _UpstashRedis)
        except Exception:
            self._is_upstash = 'upstash' in str(getattr(self.client, 'url', '')).lower()
        self._has_pipeline = hasattr(self.client, 'pipeline') and not self._is_upstash

    def _safe_redis_operation(self, operation, *args, **kwargs):
        try:
            if hasattr(self.client, operation):
                method = getattr(self.client, operation)
                return method(*args, **kwargs)
            else:
                print(f"Warning: Operation {operation} not supported by Redis client")
                return None
        except Exception as e:
            print(f"Warning: Redis operation {operation} failed: {e}")
            return None

    # Session management
    def set_session_data(self, session_id: str, data: dict, expire: int = 3600):
        key = RedisKeys.session_key(session_id)
        self._safe_redis_operation('setex', key, expire or SESSION_TTL_SECONDS, _json_dumps(data))

    def get_session_data(self, session_id: str) -> Optional[dict]:
        key = RedisKeys.session_key(session_id)
        data = self._safe_redis_operation('get', key)
        if not data:
            return None
        try:
            return _json_loads(data)
        except (json.JSONDecodeError, TypeError):
            parsed = _safe_parse_legacy(data)
            if isinstance(parsed, dict):
                return parsed
            print(f"Warning: Could not parse session data for {session_id}")
            return None

    def delete_session(self, session_id: str):
        key = RedisKeys.session_key(session_id)
        self._safe_redis_operation('delete', key)

    # Chat history
    def store_chat_message(self, user_id: str, session_id: str, message: dict, max_messages: int = 100):
        key = RedisKeys.chat_history_key(user_id, session_id)
        if self._has_pipeline:
            with self.client.pipeline() as pipe:
                pipe.lpush(key, _json_dumps(message))
                pipe.ltrim(key, 0, max_messages - 1)
                pipe.expire(key, CHAT_HISTORY_TTL_SECONDS)
                pipe.execute()
        else:
            self._safe_redis_operation('lpush', key, _json_dumps(message))
            self._safe_redis_operation('ltrim', key, 0, max_messages - 1)
            self._safe_redis_operation('expire', key, CHAT_HISTORY_TTL_SECONDS)

    def get_chat_history(self, user_id: str, session_id: str, limit: int = 50) -> list:
        key = RedisKeys.chat_history_key(user_id, session_id)
        if self._has_pipeline:
            with self.client.pipeline() as pipe:
                pipe.lrange(key, 0, limit - 1)
                pipe.expire(key, CHAT_HISTORY_TTL_SECONDS)
                results = pipe.execute()
            messages = results[0]
        else:
            messages = self._safe_redis_operation('lrange', key, 0, limit - 1)
            self._safe_redis_operation('expire', key, CHAT_HISTORY_TTL_SECONDS)
        parsed_messages = []
        for msg in reversed(messages):
            try:
                parsed_messages.append(_json_loads(msg))
            except (json.JSONDecodeError, TypeError):
                parsed = _safe_parse_legacy(msg)
                if isinstance(parsed, dict):
                    parsed_messages.append(parsed)
                else:
                    print(f"Warning: Could not parse message in chat history for {user_id}:{session_id}")
                    continue
        return parsed_messages

    def get_chat_history_cached(self, user_id: str, session_id: str, limit: int = 50) -> list:
        cache_key = f"cache:{RedisKeys.chat_history_key(user_id, session_id)}:{limit}"
        cached = self._safe_redis_operation('get', cache_key)
        if cached:
            return _json_loads(cached)
        messages = self.get_chat_history(user_id, session_id, limit)
        self._safe_redis_operation('setex', cache_key, CHAT_CACHE_TTL_SECONDS, _json_dumps(messages))
        return messages

    # Ephemeral files
    def store_ephemeral_files(self, session_id: str, files_data: dict, expire: int = 3600):
        key = RedisKeys.ephemeral_files_key(session_id)
        self._safe_redis_operation('setex', key, expire or SESSION_TTL_SECONDS, _json_dumps(files_data))

    def get_ephemeral_files(self, session_id: str) -> Optional[dict]:
        key = RedisKeys.ephemeral_files_key(session_id)
        data = self._safe_redis_operation('get', key)
        if not data:
            return None
        try:
            return _json_loads(data)
        except (json.JSONDecodeError, TypeError):
            parsed = _safe_parse_legacy(data)
            if isinstance(parsed, dict):
                return parsed
            print(f"Warning: Could not parse ephemeral files data for {session_id}")
            return None

    # Memory queue
    def queue_memory_task(self, user_id: str, task_data: dict):
        self._safe_redis_operation('lpush', RedisKeys.MEMORY_QUEUE, _json_dumps({"user_id": user_id, **task_data}))

    def get_memory_task(self) -> Optional[dict]:
        task = self._safe_redis_operation('rpop', RedisKeys.MEMORY_QUEUE)
        if not task:
            return None
        try:
            return _json_loads(task)
        except (json.JSONDecodeError, TypeError):
            parsed = _safe_parse_legacy(task)
            if isinstance(parsed, dict):
                return parsed
            print("Warning: Could not parse memory task data")
            return None

    # User status
    def set_user_status(self, user_id: str, status: str, expire: int = 300):
        key = RedisKeys.user_status_key(user_id)
        self._safe_redis_operation('setex', key, expire or 300, status)

    def get_user_status(self, user_id: str) -> Optional[str]:
        key = RedisKeys.user_status_key(user_id)
        return self._safe_redis_operation('get', key)

    def get_active_users(self) -> list:
        pattern = f"{RedisKeys.USER_STATUS}*"
        keys = self._safe_redis_operation('keys', pattern)
        return [key.replace(RedisKeys.USER_STATUS, "") for key in keys] if keys else []


