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

# Redis connection configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")
REDIS_URL = os.getenv("REDIS_URL")

# Redis client singleton
_redis_client: Optional[redis.Redis] = None

def get_redis_client() -> redis.Redis:
    """Get Redis client instance (singleton pattern)"""
    global _redis_client
    
    if _redis_client is None:
        if REDIS_URL:
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
            print("Redis connection established")
        except Exception as e:
            print(f"Redis connection failed: {e}")
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
    
    # Session management
    def set_session_data(self, session_id: str, data: dict, expire: int = 3600):
        """Set session data with expiration (default 1 hour)"""
        key = RedisKeys.session_key(session_id)
        self.client.setex(key, expire, str(data))
    
    def get_session_data(self, session_id: str) -> Optional[dict]:
        """Get session data"""
        key = RedisKeys.session_key(session_id)
        data = self.client.get(key)
        return eval(data) if data else None
    
    def delete_session(self, session_id: str):
        """Delete session data"""
        key = RedisKeys.session_key(session_id)
        self.client.delete(key)
    
    # Chat history
    def store_chat_message(self, user_id: str, session_id: str, message: dict, max_messages: int = 100):
        """Store chat message in Redis list"""
        key = RedisKeys.chat_history_key(user_id, session_id)
        self.client.lpush(key, str(message))
        self.client.ltrim(key, 0, max_messages - 1)
        self.client.expire(key, 86400 * 7)  # 7 days
    
    def get_chat_history(self, user_id: str, session_id: str, limit: int = 50) -> list:
        """Get chat history from Redis"""
        key = RedisKeys.chat_history_key(user_id, session_id)
        messages = self.client.lrange(key, 0, limit - 1)
        return [eval(msg) for msg in messages]
    
    # Ephemeral files
    def store_ephemeral_files(self, session_id: str, files_data: dict, expire: int = 3600):
        """Store ephemeral files data"""
        key = RedisKeys.ephemeral_files_key(session_id)
        self.client.setex(key, expire, str(files_data))
    
    def get_ephemeral_files(self, session_id: str) -> Optional[dict]:
        """Get ephemeral files data"""
        key = RedisKeys.ephemeral_files_key(session_id)
        data = self.client.get(key)
        return eval(data) if data else None
    
    # Memory consolidation queue
    def queue_memory_task(self, user_id: str, task_data: dict):
        """Queue memory consolidation task"""
        self.client.lpush(RedisKeys.MEMORY_QUEUE, str({"user_id": user_id, **task_data}))
    
    def get_memory_task(self) -> Optional[dict]:
        """Get next memory consolidation task"""
        task = self.client.rpop(RedisKeys.MEMORY_QUEUE)
        return eval(task) if task else None
    
    # User status
    def set_user_status(self, user_id: str, status: str, expire: int = 300):
        """Set user online status (5 min default)"""
        key = RedisKeys.user_status_key(user_id)
        self.client.setex(key, expire, status)
    
    def get_user_status(self, user_id: str) -> Optional[str]:
        """Get user online status"""
        key = RedisKeys.user_status_key(user_id)
        return self.client.get(key)
    
    def get_active_users(self) -> list:
        """Get list of active users"""
        pattern = f"{RedisKeys.USER_STATUS}*"
        keys = self.client.keys(pattern)
        return [key.replace(RedisKeys.USER_STATUS, "") for key in keys]

# Example usage (will be implemented in next phase)
if __name__ == "__main__":
    try:
        redis_ops = RedisOps()
        print("Redis operations initialized successfully")
        
        # Test basic operations
        redis_ops.set_user_status("test_user", "online")
        status = redis_ops.get_user_status("test_user")
        print(f"Test user status: {status}")
        
    except Exception as e:
        print(f"Redis test failed: {e}")
    finally:
        close_redis_client()
