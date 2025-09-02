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


