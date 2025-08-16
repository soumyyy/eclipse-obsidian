# backend/llm_cerebras.py
import os
from typing import List, Dict, Iterable, Optional
from cerebras.cloud.sdk import Cerebras

_CLIENT: Cerebras | None = None

MODEL = os.getenv("MODEL_NAME", "gpt-oss-120b")

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
    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_completion_tokens=max_tokens,
        temperature=temperature,
        top_p=1.0,
        stream=False,
    )
    # SDK returns an object; choices[0].message.content holds the text
    return resp.choices[0].message.content

def cerebras_chat_stream(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 800) -> Iterable[str]:
    """
    Optional: generator yielding text chunks if you later add server-sent streaming.
    """
    client = _client()
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
            yield text