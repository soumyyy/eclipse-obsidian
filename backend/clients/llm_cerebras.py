# backend/clients/llm_cerebras.py
import os
from typing import List, Dict, Iterable, Optional
import time, json
from cerebras.cloud.sdk import Cerebras

_CLIENT: Cerebras | None = None

MODEL = os.getenv("MODEL_NAME", "gpt-oss-120b")
EXTRACTOR_MODEL = os.getenv("EXTRACTOR_MODEL", MODEL)

def _client() -> Cerebras:
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    api_key = os.environ.get("CEREBRAS_API_KEY")
    if not api_key:
        raise RuntimeError("Set CEREBRAS_API_KEY in your .env")
    _CLIENT = Cerebras(api_key=api_key)
    return _CLIENT

def cerebras_chat(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 800) -> str:
    """
    Non-streaming chat completion (simple for FastAPI JSON response).
    """
    client = _client()
    t0 = time.perf_counter()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_completion_tokens=max_tokens,
        temperature=temperature,
        top_p=1.0,
        stream=False,
    )
    try:
        print(json.dumps({
            "metric": "llm_api_timing",
            "mode": "nonstream",
            "ms": round((time.perf_counter() - t0) * 1000, 1),
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": len(messages)
        }))
    except Exception:
        pass
    # SDK returns an object; choices[0].message.content holds the text
    return resp.choices[0].message.content

def cerebras_chat_stream(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 800) -> Iterable[str]:
    """
    Optional: generator yielding text chunks if you later add server-sent streaming.
    """
    client = _client()
    t0 = time.perf_counter()
    first_ms = None
    chars = 0
    chunks = 0
    stream = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_completion_tokens=max_tokens,
        temperature=temperature,
        top_p=1.0,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", "")
        if text:
            if first_ms is None:
                first_ms = round((time.perf_counter() - t0) * 1000, 1)
                try:
                    print(json.dumps({
                        "metric": "llm_api_timing",
                        "mode": "stream_first_delta",
                        "ttfb_ms": first_ms,
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                        "messages": len(messages)
                    }))
                except Exception:
                    pass
            chars += len(text)
            chunks += 1
            yield text
    try:
        total_ms = round((time.perf_counter() - t0) * 1000, 1)
        print(json.dumps({
            "metric": "llm_api_timing",
            "mode": "stream_done",
            "total_ms": total_ms,
            "ttfb_ms": first_ms,
            "chunks": chunks,
            "chars": chars,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": len(messages)
        }))
    except Exception:
        pass

def cerebras_chat_with_model(messages: List[Dict], model: Optional[str] = None, temperature: float = 0.0, max_tokens: int = 512) -> str:
    client = _client()
    resp = client.chat.completions.create(
        model=(model or EXTRACTOR_MODEL),
        messages=messages,
        max_completion_tokens=max_tokens,
        temperature=temperature,
        top_p=1.0,
        stream=False,
    )
    return resp.choices[0].message.content

# ----------------- Unified Implementation -----------------

import asyncio
from concurrent.futures import ThreadPoolExecutor

# Global thread pool for LLM operations
_llm_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm")

def unified_chat_completion(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 800, stream: bool = False):
    """
    Unified function that handles both sync and async contexts automatically.
    Use this instead of separate sync/async functions.
    """
    # Detect if we're in an async context
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # We're in async context, return coroutine
            if stream:
                return _async_stream_call(messages, temperature, max_tokens)
            else:
                return _async_call(cerebras_chat, messages, temperature, max_tokens)
        else:
            # We're in sync context, call directly
            if stream:
                return cerebras_chat_stream(messages, temperature, max_tokens)
            else:
                return cerebras_chat(messages, temperature, max_tokens)
    except RuntimeError:
        # No event loop, definitely sync context
        if stream:
            return cerebras_chat_stream(messages, temperature, max_tokens)
        else:
            return cerebras_chat(messages, temperature, max_tokens)

async def _async_call(func, *args, **kwargs):
    """Helper for async calls."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_llm_executor, func, *args, **kwargs)

async def _async_stream_call(messages, temperature, max_tokens):
    """Helper for async streaming calls."""
    loop = asyncio.get_event_loop()
    sync_generator = await loop.run_in_executor(_llm_executor, cerebras_chat_stream, messages, temperature, max_tokens)

    for chunk in sync_generator:
        yield chunk
        await asyncio.sleep(0)

# Keep backward compatibility - these now use the unified approach
def cerebras_chat_async(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 800) -> str:
    """Legacy async wrapper - use unified_chat_completion instead."""
    return unified_chat_completion(messages, temperature, max_tokens, stream=False)

async def cerebras_chat_stream_async(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 800):
    """Legacy async stream wrapper - use unified_chat_completion instead."""
    async for chunk in _async_stream_call(messages, temperature, max_tokens):
        yield chunk


