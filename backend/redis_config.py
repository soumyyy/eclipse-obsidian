"""
Redis configuration and connection management for Eclipse.
This will be used in the next phase for:
- Session management
- Chat history
- Ephemeral file storage
- Real-time features
"""

import os
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

# Redis client singleton (can be Redis or UpstashRedis)
_redis_client: Optional[redis.Redis | UpstashRedis] = None

def get_redis_client() -> redis.Redis | UpstashRedis:
    """Get Redis client instance (singleton pattern)"""
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
        
        # Test connection
        try:
            _redis_client.ping()
        except Exception as e:
            _redis_client = None
            raise
    
    return _redis_client

def close_redis_client():
    """Close Redis client connection"""
    global _redis_client
    if _redis_client:
        _redis_client.close()
        _redis_client = None

# Key patterns for different data types
class RedisKeys:
    # Session management
    SESSION_PREFIX = "eclipse:session:"
    USER_SESSIONS = "eclipse:user_sessions:"
    
    # Chat history
    CHAT_HISTORY_PREFIX = "eclipse:chat:"
    CHAT_STREAM_PREFIX = "eclipse:stream:"
    
    # Ephemeral files
    EPHEMERAL_FILES_PREFIX = "eclipse:files:"
    
    # Memory consolidation queue
    MEMORY_QUEUE = "eclipse:memory:queue"
    
    # Real-time features
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

# Redis operations for different features
class RedisOps:
    def __init__(self):
        self.client = get_redis_client()
        # Detect Upstash client reliably and disable pipelines for it
        try:
            from upstash_redis import Redis as _UpstashRedis
            self._is_upstash = isinstance(self.client, _UpstashRedis)
        except Exception:
            self._is_upstash = 'upstash' in str(getattr(self.client, 'url', '')).lower()
        # Only use pipeline when truly supported (not Upstash)
        self._has_pipeline = hasattr(self.client, 'pipeline') and not self._is_upstash
    
    def _safe_redis_operation(self, operation, *args, **kwargs):
        """Safely execute Redis operation with Upstash compatibility"""
        try:
            if hasattr(self.client, operation):
                method = getattr(self.client, operation)
                return method(*args, **kwargs)
            else:
                # Fallback for unsupported operations
                print(f"Warning: Operation {operation} not supported by Redis client")
                return None
        except Exception as e:
            print(f"Warning: Redis operation {operation} failed: {e}")
            return None
    
    # Session management
    def set_session_data(self, session_id: str, data: dict, expire: int = 3600):
        """Set session data with expiration (default 1 hour)"""
        key = RedisKeys.session_key(session_id)
        self._safe_redis_operation('setex', key, expire or SESSION_TTL_SECONDS, _json_dumps(data))
    
    def get_session_data(self, session_id: str) -> Optional[dict]:
        """Get session data"""
        key = RedisKeys.session_key(session_id)
        data = self._safe_redis_operation('get', key)
        if not data:
            return None
        
        try:
            return _json_loads(data)
        except (json.JSONDecodeError, TypeError):
            # Handle old data stored with str() format
            try:
                # Try to evaluate old format data
                return eval(data)
            except:
                # If all else fails, return None
                print(f"Warning: Could not parse session data for {session_id}")
                return None
    
    def delete_session(self, session_id: str):
        """Delete session data"""
        key = RedisKeys.session_key(session_id)
        self._safe_redis_operation('delete', key)
    
    # Chat history
    def store_chat_message(self, user_id: str, session_id: str, message: dict, max_messages: int = 100):
        """Store chat message in Redis list using pipeline for better performance"""
        key = RedisKeys.chat_history_key(user_id, session_id)
        
        # Use pipeline when available, otherwise sequential ops
        if self._has_pipeline:
            with self.client.pipeline() as pipe:
                pipe.lpush(key, _json_dumps(message))
                pipe.ltrim(key, 0, max_messages - 1)
                pipe.expire(key, CHAT_HISTORY_TTL_SECONDS)
                pipe.execute()
        else:
            # Fallback for Upstash Redis (no pipeline support)
            self._safe_redis_operation('lpush', key, _json_dumps(message))
            self._safe_redis_operation('ltrim', key, 0, max_messages - 1)
            self._safe_redis_operation('expire', key, CHAT_HISTORY_TTL_SECONDS)
    
    def get_chat_history(self, user_id: str, session_id: str, limit: int = 50) -> list:
        """Get chat history from Redis using pipeline for better performance"""
        key = RedisKeys.chat_history_key(user_id, session_id)
        
        # Use pipeline when available, otherwise sequential ops
        if self._has_pipeline:
            with self.client.pipeline() as pipe:
                pipe.lrange(key, 0, limit - 1)
                pipe.expire(key, CHAT_HISTORY_TTL_SECONDS)
                results = pipe.execute()
            messages = results[0]
        else:
            # Fallback for Upstash Redis (no pipeline support)
            messages = self._safe_redis_operation('lrange', key, 0, limit - 1)
            self._safe_redis_operation('expire', key, CHAT_HISTORY_TTL_SECONDS)
        
        # Reverse to get correct chronological order (user message first, then assistant)
        parsed_messages = []
        for msg in reversed(messages):
            try:
                parsed_messages.append(_json_loads(msg))
            except (json.JSONDecodeError, TypeError):
                # Handle old data stored with str() format
                try:
                    parsed_messages.append(eval(msg))
                except:
                    print(f"Warning: Could not parse message in chat history for {user_id}:{session_id}")
                    continue
        
        return parsed_messages
    
    def get_chat_history_cached(self, user_id: str, session_id: str, limit: int = 50) -> list:
        """Get chat history with Redis caching for ultra-fast access"""
        cache_key = f"cache:{RedisKeys.chat_history_key(user_id, session_id)}:{limit}"
        
        # Try cache first (short TTL for chat history cache)
        cached = self._safe_redis_operation('get', cache_key)
        if cached:
            return _json_loads(cached)
        
        # Fetch from Redis if not cached
        messages = self.get_chat_history(user_id, session_id, limit)
        
        # Cache the result briefly to smooth bursts
        self._safe_redis_operation('setex', cache_key, CHAT_CACHE_TTL_SECONDS, _json_dumps(messages))
        return messages
    
    # Ephemeral files
    def store_ephemeral_files(self, session_id: str, files_data: dict, expire: int = 3600):
        """Store ephemeral files data"""
        key = RedisKeys.ephemeral_files_key(session_id)
        self._safe_redis_operation('setex', key, expire or SESSION_TTL_SECONDS, _json_dumps(files_data))
    
    def get_ephemeral_files(self, session_id: str) -> Optional[dict]:
        """Get ephemeral files data"""
        key = RedisKeys.ephemeral_files_key(session_id)
        data = self._safe_redis_operation('get', key)
        if not data:
            return None
        
        try:
            return _json_loads(data)
        except (json.JSONDecodeError, TypeError):
            # Handle old data stored with str() format
            try:
                return eval(data)
            except:
                print(f"Warning: Could not parse ephemeral files data for {session_id}")
                return None
    
    # Memory consolidation queue
    def queue_memory_task(self, user_id: str, task_data: dict):
        """Queue memory consolidation task"""
        self._safe_redis_operation('lpush', RedisKeys.MEMORY_QUEUE, _json_dumps({"user_id": user_id, **task_data}))
    
    def get_memory_task(self) -> Optional[dict]:
        """Get next memory consolidation task"""
        task = self._safe_redis_operation('rpop', RedisKeys.MEMORY_QUEUE)
        if not task:
            return None
        
        try:
            return _json_loads(task)
        except (json.JSONDecodeError, TypeError):
            # Handle old data stored with str() format
            try:
                return eval(task)
            except:
                print(f"Warning: Could not parse memory task data")
                return None
    
    # User status
    def set_user_status(self, user_id: str, status: str, expire: int = 300):
        """Set user online status (5 min default)"""
        key = RedisKeys.user_status_key(user_id)
        self._safe_redis_operation('setex', key, expire or 300, status)
    
    def get_user_status(self, user_id: str) -> Optional[str]:
        """Get user online status"""
        key = RedisKeys.user_status_key(user_id)
        return self._safe_redis_operation('get', key)
    
    def get_active_users(self) -> list:
        """Get list of active users"""
        pattern = f"{RedisKeys.USER_STATUS}*"
        keys = self._safe_redis_operation('keys', pattern)
        return [key.replace(RedisKeys.USER_STATUS, "") for key in keys] if keys else []
    
    def migrate_old_data_to_json(self, user_id: str = None):
        """Migrate old data stored with str() format to JSON format"""
        try:
            if user_id:
                # Migrate specific user's data
                session_pattern = f"{RedisKeys.SESSION_PREFIX}*"
                chat_pattern = f"{RedisKeys.CHAT_HISTORY_PREFIX}{user_id}:*"
                
                # Migrate sessions
                session_keys = self._safe_redis_operation('keys', session_pattern)
                if session_keys:
                    for key in session_keys:
                        try:
                            data = self._safe_redis_operation('get', key)
                            if data and not data.startswith('{'):
                                # Old format data, convert to JSON
                                parsed_data = eval(data)
                                self._safe_redis_operation('setex', key, 3600, _json_dumps(parsed_data))
                                print(f"Migrated session data: {key}")
                        except:
                            continue
                
                # Migrate chat history
                chat_keys = self._safe_redis_operation('keys', chat_pattern)
                if chat_keys:
                    for key in chat_keys:
                        try:
                            messages = self._safe_redis_operation('lrange', key, 0, -1)
                            if messages and not messages[0].startswith('{'):
                                # Old format messages, convert to JSON
                                if self._has_pipeline:
                                    with self.client.pipeline() as pipe:
                                        pipe.delete(key)
                                        for msg in messages:
                                            try:
                                                parsed_msg = eval(msg)
                                                pipe.lpush(key, _json_dumps(parsed_msg))
                                            except:
                                                continue
                                        pipe.expire(key, CHAT_HISTORY_TTL_SECONDS)
                                        pipe.execute()
                                else:
                                    # Fallback for Upstash Redis
                                    self._safe_redis_operation('delete', key)
                                    for msg in messages:
                                        try:
                                            parsed_msg = eval(msg)
                                            self._safe_redis_operation('lpush', key, _json_dumps(parsed_msg))
                                        except:
                                            continue
                                    self._safe_redis_operation('expire', key, CHAT_HISTORY_TTL_SECONDS)
                                print(f"Migrated chat history: {key}")
                        except:
                            continue
            else:
                print("Migration completed for specified user")
                
        except Exception as e:
            print(f"Migration error: {e}")


