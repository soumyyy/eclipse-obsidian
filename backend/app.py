# --- load .env before anything else ---
import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
# --------------------------------------

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional   # <-- ensure Optional is imported

from rag import RAG
from llm_cerebras import cerebras_chat
from memory import recall_memories, add_memory
from tools import web_search_ddg, create_note

load_dotenv()
ASSISTANT = os.getenv("ASSISTANT_NAME", "Atlas")
VERCEL_SITE = os.getenv("VERCEL_SITE", "http://localhost:3000")
BACKEND_TOKEN = os.getenv("BACKEND_TOKEN", "")

app = FastAPI(title="Obsidian RAG + Cerebras Assistant")

# CORS (lock to your UI origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[VERCEL_SITE],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Models ----------
class ChatIn(BaseModel):
    user_id: str
    message: str
    use_web: bool = False
    make_note: Optional[str] = None  # if set, save a note with this title

class ChatOut(BaseModel):
    reply: str
    sources: List[Dict] = []
    tools_used: List[str] = []

# ---------- Helpers ----------
SYSTEM_PROMPT = f"""You are {ASSISTANT}, a helpful personal assistant.
Use the provided CONTEXT and MEMORIES to answer accurately and concisely.
Cite snippets using [1], [2], etc. If unsure, say so and suggest next steps.
"""

def build_messages(user_id: str, user_msg: str, context: str, memories_text: str):
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"MEMORIES:\n{memories_text or '(none)'}"},
        {"role": "system", "content": f"CONTEXT:\n{context or '(no retrieval hits)'}"},
        {"role": "user", "content": user_msg},
    ]

_retriever: RAG | None = None
def get_retriever():
    global _retriever
    if _retriever is None:
        _retriever = RAG(top_k=5)
    return _retriever

def verify_auth(x_api_key: str | None):
    if BACKEND_TOKEN and x_api_key != BACKEND_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

# ---------- Routes ----------
@app.get("/healthz")
def healthz():
    return {"ok": True, "assistant": ASSISTANT}

@app.post("/chat", response_model=ChatOut)
def chat(payload: ChatIn, x_api_key: str | None = Header(default=None)):
    verify_auth(x_api_key)

    tools_used = []

    # Retrieval
    try:
        retriever = get_retriever()
        context, hits = retriever.build_context(payload.message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Retriever not ready: {e}. Run `python ingest.py`.") from e

    # Recall memories
    mems = recall_memories(payload.user_id, limit=6)
    memories_text = "\n".join([f"- ({k}) {c}" for k, c in mems]) if mems else ""

    # Optional tools
    tool_snippets = ""
    if payload.use_web:
        tools_used.append("web_search_ddg")
        results = web_search_ddg(payload.message, max_results=5)
        if results:
            tool_snippets = "WEB SEARCH:\n" + "\n".join(f"- {r['title']} ({r['url']})" for r in results)

    if payload.make_note:
        tools_used.append("create_note")
        note_path = create_note(payload.make_note, f"Auto-created from chat:\n\n{payload.message}")
        tool_snippets += f"\nNOTE:\n- Created {note_path}"

    if tool_snippets:
        context = context + "\n\n" + tool_snippets

    # LLM call
    messages = build_messages(payload.user_id, payload.message, context, memories_text)
    reply = cerebras_chat(messages)

    # Lightweight memory capture
    low = payload.message.lower()
    if "i prefer" in low or "my preference" in low:
        add_memory(payload.user_id, "preference", payload.message, weight=1.2)

    return ChatOut(
        reply=reply,
        sources=[{"path": h["path"], "score": h["score"]} for h in hits],
        tools_used=tools_used
    )